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
 * for any other reply.
 */
import { mutationOptions, type QueryKey, queryOptions } from '@tanstack/react-query';
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

/** A query's key: its table, its action and its input. */
type Key<T extends string, A extends string> = readonly [
  table: T,
  action: A,
  input: Record<string, unknown>,
];

const toQueryOptions = <K extends QueryKey, D>(queryKey: K, queryFn: () => Promise<D>) =>
  queryOptions({ queryKey, queryFn });

const toMutationOptions = <V, D>(
  mutationKey: readonly [table: string, action: string],
  mutationFn: (variables: V) => Promise<D>,
) => mutationOptions({ mutationKey, mutationFn });

/** A GET action. */
export interface QueryAction<K extends QueryKey, F> {
  queryOptions(...input: InputArgs<F>): ReturnType<typeof toQueryOptions<K, Data<F>>>;
}

/** An action of any other method. */
export interface MutationAction<F> {
  mutationOptions(): ReturnType<typeof toMutationOptions<Variables<F>, Data<F>>>;
}

/** Every action of the map, by table and name, typed by the hc client's route for it. */
export type Api<Client, E extends Endpoints> = {
  readonly [T in keyof E & string]: {
    readonly [A in keyof E[T] & string]: E[T][A] extends `GET ${string}`
      ? QueryAction<Key<T, A>, Call<Client, E[T][A]>>
      : MutationAction<Call<Client, E[T][A]>>;
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
      const call = (input: unknown) => request(client, method, path, input);
      api[table][action] =
        method === 'GET'
          ? {
              queryOptions: (input?: Record<string, unknown>) =>
                toQueryOptions([table, action, input ?? {}], () => call(input)),
            }
          : { mutationOptions: () => toMutationOptions([table, action], call) };
    }
  }
  return api as Api<Client, E>;
}

type HcCall = (input: unknown) => Promise<Response>;

/** Calls the route's hc function, then reads the reply. */
async function request(client: unknown, method: string, path: string, input: unknown) {
  let node = client as Record<string, unknown>;
  for (const segment of path.split('/').filter(Boolean)) {
    node = node[segment] as Record<string, unknown>;
  }
  const response = await (node[`$${method.toLowerCase()}`] as HcCall)(input);
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
