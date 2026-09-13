/**
 * @blendx/react: TanStack Query options for every action of a blendx app, reached by table
 * and action name (D25). The map comes from the app's generated client.gen.ts and the calls
 * go through the app's hc client, whose types give each action its input and data:
 *
 *   const api = createBlendxClient(hc<AppType>('/api'), endpoints);
 *   useQuery(api.orders.show.queryOptions({ param: { id: '1' } }));
 *   useMutation(api.orders.store.mutationOptions());
 *
 * A GET action gives queryOptions, any other method mutationOptions. Both resolve to the
 * body of the action's success reply (null for a 204), and reject with a ProblemDetailsError
 * for any other reply. A mutation that succeeds invalidates every query of its table, and of
 * the tables it names (D25 note, N.2). Every action's fieldErrors(error) turns a refusal into
 * the first problem with each field of its input, for a form to show (N.3).
 */
import {
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from '@tanstack/react-query';
import type { ProblemDetails } from 'blendx';
import type { InferResponseType } from 'blendx/client';

/** The shape of client.gen.ts's `endpoints`: each table's actions, as `METHOD /path`. */
export type Endpoints = { readonly [table: string]: { readonly [action: string]: string } };

/** A reply's Problem Details (RFC 9457). Any status: a proxy in front of the app can answer too. */
export type Problem = Omit<ProblemDetails, 'status'> & { status: number };

/** What a query or mutation rejects with when the reply is not a success. */
export class ProblemDetailsError extends Error {
  readonly status: number;
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ProblemDetailsError';
    this.status = problem.status;
    this.problem = problem;
  }
}

/** The 2xx statuses, as hono types them. */
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

/** The hc client's node at a path, one segment at a time: `orders/:id` is client.orders[':id']. */
type At<Node, Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends keyof Node
    ? At<Node[Head], Rest>
    : never
  : Path extends keyof Node
    ? Node[Path]
    : never;

/** The hc function of a route: `POST /orders/:id/refund` is client.orders[':id'].refund.$post. */
type Call<Client, Route> = Route extends `${infer Method} /${infer Path}`
  ? At<Client, Path> extends infer Node
    ? Node[`$${Lowercase<Method>}` & keyof Node]
    : never
  : never;

/** True when no part of an input (its query, json or param) has a key that must be given. */
type NothingRequired<R> = {
  [K in keyof R]-?: Record<never, never> extends R[K] ? never : K;
}[keyof R] extends never
  ? true
  : false;

/**
 * hc's input parameter. It is optional where hc's is, and also where nothing in it is
 * required: hc makes index take `{ query: {} }`, and the adapter lets it take nothing.
 */
type InputArgs<F> = F extends (...args: infer P) => unknown
  ? P extends [infer A, ...unknown[]]
    ? NothingRequired<A> extends true
      ? [input?: A]
      : [input: A]
    : P extends [(infer A)?, ...unknown[]]
      ? [input?: A]
      : []
  : never;

/** A mutation's variables: its input, which mutate() may leave out when it is optional. */
type Variables<F> =
  InputArgs<F> extends [infer A]
    ? A
    : InputArgs<F> extends [(infer A)?]
      ? // biome-ignore lint/suspicious/noConfusingVoidType: mutate() takes no argument only when its variables type includes void
        A | void
      : // biome-ignore lint/suspicious/noConfusingVoidType: as above, for an action that takes no input
        void;

/** The body of the action's success reply. */
type Data<F> = InferResponseType<F, SuccessStatus>;

/** The action's input, when it takes one. */
type Input<F> = InputArgs<F> extends [(infer A)?] ? NonNullable<A> : never;

/** A body's field names, and the paths below a field that holds an object or an array. */
type Paths<J> = {
  [K in keyof J & string]: K | (NonNullable<J[K]> extends object ? `${K}.${string}` : never);
}[keyof J & string];

/** The fields a refusal can name: a body field by its path, a query parameter by its name. */
type Fields<I> =
  | (I extends { json: infer J } ? Paths<J> : never)
  | (I extends { query: infer Q } ? keyof Q & string : never);

/** The first problem with each field of the action's input. */
export type FieldErrors<F> = { [K in Fields<Input<F>>]?: string };

/** A query's key: its table, its action and its input. */
type Key<T extends string, A extends string> = readonly [
  table: T,
  action: A,
  input: Record<string, unknown>,
];

const toQueryOptions = <K extends QueryKey, D>(
  queryKey: K,
  queryFn: (context: { signal: AbortSignal }) => Promise<D>,
) => queryOptions({ queryKey, queryFn });

const toMutationOptions = <V, D>(
  mutationKey: readonly [table: string, action: string],
  mutationFn: (variables: V, context: { client: QueryClient }) => Promise<D>,
) => mutationOptions({ mutationKey, mutationFn });

/** What a mutation adds to its defaults. */
export interface MutationSettings<Table extends string> {
  /** Other tables whose queries it changes: the ones its hooks write. Its own table always is. */
  invalidates?: readonly Table[];
}

/** A GET action. */
export interface QueryAction<K extends QueryKey, F> {
  queryOptions(...input: InputArgs<F>): ReturnType<typeof toQueryOptions<K, Data<F>>>;
  /** The first problem with each field of a refused input; `{}` for any other error. */
  fieldErrors(error: unknown): FieldErrors<F>;
}

/** An action of any other method. `Tables` are the app's tables, which it may invalidate. */
export interface MutationAction<F, Tables extends string> {
  mutationOptions(
    options?: MutationSettings<Tables>,
  ): ReturnType<typeof toMutationOptions<Variables<F>, Data<F>>>;
  /** The first problem with each field of a refused input; `{}` for any other error. */
  fieldErrors(error: unknown): FieldErrors<F>;
}

/** Every action of the map, by table and name, typed by the hc client's route for it. */
export type Api<Client, E extends Endpoints> = {
  readonly [T in keyof E & string]: {
    readonly [A in keyof E[T] & string]: E[T][A] extends `GET ${string}`
      ? QueryAction<Key<T, A>, Call<Client, E[T][A]>>
      : MutationAction<Call<Client, E[T][A]>, keyof E & string>;
  };
};

/** TanStack Query options for every action in `endpoints`, called through `client`. */
export function createBlendxClient<Client, E extends Endpoints>(
  client: Client,
  endpoints: E,
): Api<Client, E> {
  const api: Record<string, Record<string, object>> = {};
  for (const [table, actions] of Object.entries(endpoints)) {
    api[table] = {};
    for (const [action, route] of Object.entries(actions)) {
      const [method = '', path = ''] = route.split(' ');
      const call = (input: unknown, signal?: AbortSignal) =>
        request(client, method, path, input, signal);
      api[table][action] =
        method === 'GET'
          ? {
              queryOptions: (input?: Record<string, unknown>) =>
                // TanStack aborts the signal when it cancels the query (N.7).
                toQueryOptions([table, action, input ?? {}], ({ signal }) => call(input, signal)),
              fieldErrors,
            }
          : {
              // Invalidating inside the mutation function, not in onSuccess, lets an app spread
              // its own onSuccess over the options without losing it.
              mutationOptions: (options?: MutationSettings<string>) =>
                toMutationOptions([table, action], async (input, { client: queryClient }) => {
                  const data = await call(input);
                  const tables = new Set([table, ...(options?.invalidates ?? [])]);
                  await Promise.all(
                    [...tables].map((name) => queryClient.invalidateQueries({ queryKey: [name] })),
                  );
                  return data;
                }),
              fieldErrors,
            };
    }
  }
  return api as Api<Client, E>;
}

type HcCall = (input: unknown, options?: { init: RequestInit }) => Promise<Response>;

/**
 * Calls the route's hc function, then reads the reply. A signal goes in the call's `init`,
 * which hc merges into the client's own `init` key by key.
 */
async function request(
  client: unknown,
  method: string,
  path: string,
  input: unknown,
  signal?: AbortSignal,
) {
  let node = client as Record<string, unknown>;
  for (const segment of path.split('/').filter(Boolean)) {
    node = node[segment] as Record<string, unknown>;
  }
  const call = node[`$${method.toLowerCase()}`] as HcCall;
  const response = await call(input, signal ? { init: { signal } } : undefined);
  if (response.ok) return response.status === 204 ? null : ((await response.json()) as unknown);
  throw new ProblemDetailsError(await problemOf(response));
}

/** The reply's Problem Details, or ones made from its status when it has none. */
async function problemOf(response: Response): Promise<Problem> {
  const body: unknown = await response.json().catch(() => undefined);
  const problem = body as Partial<Problem> | undefined;
  if (typeof problem?.status === 'number' && typeof problem.title === 'string') {
    return problem as Problem;
  }
  return {
    type: 'about:blank',
    title: response.statusText || `HTTP ${response.status}`,
    status: response.status,
  };
}

/** The first problem with each field: a body field by its pointer's path, a query parameter by name. */
function fieldErrors(error: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!(error instanceof ProblemDetailsError)) return fields;
  for (const { pointer, parameter, detail } of error.problem.errors ?? []) {
    const field = pointer === undefined ? parameter : fieldOf(pointer);
    if (field !== undefined && !Object.hasOwn(fields, field)) fields[field] = detail;
  }
  return fields;
}

/** A JSON pointer as a field path: `/items/0/name` is items.0.name (RFC 6901: ~1 is /, ~0 is ~). */
const fieldOf = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
