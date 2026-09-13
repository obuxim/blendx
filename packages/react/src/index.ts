/**
 * @blendx/react: TanStack Query options for every action of a blendx app, reached by table
 * and action name (D25). The map comes from the app's generated client.gen.ts and the calls
 * go through the app's hc client, whose types give each action its input and data:
 *
 *   const api = createBlendxClient(hc<AppType>('/api'), tables);
 *   useQuery(api.orders.show.queryOptions({ param: { id: '1' } }));
 *   useMutation(api.orders.store.mutationOptions());
 *
 * A GET action gives queryOptions, any other method mutationOptions, and index also gives
 * infiniteQueryOptions, the same listing page by page (N.9). All resolve to the body of the
 * action's success reply (null for a 204), and reject with a ProblemDetailsError for any
 * other reply. A mutation that succeeds invalidates every query of its table, and of
 * the tables it names (D25 note, N.2), and the queries of other tables that included one of
 * those (N.8). Every action's fieldErrors(error) turns a refusal into the first problem with
 * each field of its input, for a form to show (N.3).
 */
import {
  infiniteQueryOptions,
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from '@tanstack/react-query';
import type { ProblemDetails } from 'blendx';
import type { InferResponseType } from 'blendx/client';

/**
 * The shape of client.gen.ts's `tables`: each table's actions, as `METHOD /path`, its
 * includes, each the table the relation points to (N.8), and its primary key (D30).
 */
export type Tables = {
  readonly [table: string]: {
    readonly actions: { readonly [action: string]: string };
    readonly includes: { readonly [name: string]: string };
    readonly key: { readonly column: string; readonly type: 'number' | 'string' };
  };
};

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

/** True when a part of an input (its query, json or param) has no key that must be given. */
type Optional<Part> = Record<never, never> extends Part ? true : false;

/** True when no part of an input has a key that must be given. */
type NothingRequired<R> = {
  [K in keyof R]-?: Optional<R[K]> extends true ? never : K;
}[keyof R] extends never
  ? true
  : false;

/**
 * hc's input, with its query made optional when nothing in it is required: hc makes index
 * take `{ query: {} }` and a show with includes take `query: { include?: string }`, and the
 * adapter lets both be left out. Any other input is hc's as it is.
 */
type Loosened<A> = A extends { query: infer Q }
  ? Optional<Q> extends true
    ? { [K in keyof A as K extends 'query' ? never : K]: A[K] } & { query?: Q } extends infer L
      ? { [K in keyof L]: L[K] }
      : never
    : A
  : A;

/**
 * hc's input parameter. It is optional where hc's is, and also where nothing in it is
 * required, so index takes nothing.
 */
type InputArgs<F> = F extends (...args: infer P) => unknown
  ? P extends [infer A, ...unknown[]]
    ? NothingRequired<A> extends true
      ? [input?: Loosened<A>]
      : [input: Loosened<A>]
    : P extends [(infer A)?, ...unknown[]]
      ? [input?: Loosened<A>]
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
  | (I extends { query?: infer Q } ? keyof NonNullable<Q> & string : never);

/** The first problem with each field of the action's input. */
export type FieldErrors<F> = { [K in Fields<Input<F>>]?: string };

/** A query's key: its table, its action and its input. */
type Key<T extends string, A extends string> = readonly [
  table: T,
  action: A,
  input: Record<string, unknown>,
];

/** The key of an infinite index query: the plain query's, marked, so the two never share one (N.9). */
type InfiniteKey<T extends string> = readonly [
  table: T,
  action: 'index',
  input: Record<string, unknown>,
  mode: 'infinite',
];

/** What every index page carries, which decides whether there is a next one. */
interface IndexPage {
  meta: { page: number; per_page: number; total: number };
}

/** An index input without `page`: the pages come from fetchNextPage (N.9). */
type Unpaged<A> = A extends { query?: infer Q }
  ? { [K in keyof A as K extends 'query' ? never : K]: A[K] } & {
      query?: Omit<NonNullable<Q>, 'page'> & { page?: never };
    } extends infer L
    ? { [K in keyof L]: L[K] }
    : never
  : A;

type UnpagedArgs<F> = InputArgs<F> extends [(infer A)?] ? [input?: Unpaged<NonNullable<A>>] : [];

const toQueryOptions = <K extends QueryKey, D>(
  queryKey: K,
  queryFn: (context: { signal: AbortSignal }) => Promise<D>,
) => queryOptions({ queryKey, queryFn });

/** Page 1 first, then the next while the pages seen so far do not reach the total. */
const toInfiniteQueryOptions = <K extends QueryKey, P extends IndexPage>(
  queryKey: K,
  fetchPage: (page: number, signal: AbortSignal) => Promise<P>,
) =>
  infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: ({ meta }) =>
      meta.page * meta.per_page < meta.total ? meta.page + 1 : undefined,
  });

const toMutationOptions = <V, D>(
  mutationKey: readonly [table: string, action: string],
  mutationFn: (variables: V, context: { client: QueryClient }) => Promise<D>,
) => mutationOptions({ mutationKey, mutationFn });

/** What a mutation adds to its defaults. */
export interface MutationSettings<Table extends string, Optimistic = never> {
  /** Other tables whose queries it changes: the ones its hooks write. Its own table always is. */
  invalidates?: readonly Table[];
  /**
   * Change the cached rows before the request is sent (D30): `true` on update (merge the
   * body in), destroy and purge (remove the row); a function of the cached row and the input
   * on any other member action. A failure invalidates the table's queries.
   */
  optimistic?: Optimistic;
}

/**
 * The cached row of a table, as its show replies, or a row of its index; a table with
 * neither has rows of unknown shape. What an optimistic function receives and returns (D30).
 */
type RowOf<Client, E extends Tables, T extends keyof E> = E[T]['actions'] extends {
  show: infer S;
}
  ? Data<Call<Client, S>>
  : E[T]['actions'] extends { index: infer I }
    ? Data<Call<Client, I>> extends { data: (infer R)[] }
      ? R
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * What `optimistic` takes on an action (D30): `true` on update, destroy and purge; on store,
 * `true` or a function of the input giving what the new row holds besides it; a function of
 * the cached row and the input on any other member action; nothing on a collection action.
 */
type OptimisticOf<Client, E extends Tables, T extends keyof E, A, Route, F> = A extends
  | 'update'
  | 'destroy'
  | 'purge'
  ? true
  : A extends 'store'
    ? true | ((input: Variables<F>) => Partial<RowOf<Client, E, T>>)
    : Route extends `${string} /${string}/:id${string}`
      ? (row: RowOf<Client, E, T>, input: Variables<F>) => RowOf<Client, E, T>
      : never;

/** A GET action. */
export interface QueryAction<K extends QueryKey, F> {
  queryOptions(...input: InputArgs<F>): ReturnType<typeof toQueryOptions<K, Data<F>>>;
  /** The first problem with each field of a refused input; `{}` for any other error. */
  fieldErrors(error: unknown): FieldErrors<F>;
}

/** index: a query, and the same listing page by page for infinite scroll (N.9). */
export interface IndexAction<K extends QueryKey, IK extends QueryKey, F> extends QueryAction<K, F> {
  /** `page` is left out of the input: `fetchNextPage` asks for the next while there is one. */
  infiniteQueryOptions(
    ...input: UnpagedArgs<F>
  ): ReturnType<typeof toInfiniteQueryOptions<IK, Data<F> extends IndexPage ? Data<F> : never>>;
}

/** An action of any other method. `Tables` are the app's tables, which it may invalidate. */
export interface MutationAction<F, Tables extends string, Optimistic = never> {
  mutationOptions(
    options?: MutationSettings<Tables, Optimistic>,
  ): ReturnType<typeof toMutationOptions<Variables<F>, Data<F>>>;
  /** The first problem with each field of a refused input; `{}` for any other error. */
  fieldErrors(error: unknown): FieldErrors<F>;
}

/** Every action of the map, by table and name, typed by the hc client's route for it. */
export type Api<Client, E extends Tables> = {
  readonly [T in keyof E & string]: {
    readonly [A in keyof E[T]['actions'] & string]: E[T]['actions'][A] extends `GET ${string}`
      ? A extends 'index'
        ? IndexAction<Key<T, A>, InfiniteKey<T>, Call<Client, E[T]['actions'][A]>>
        : QueryAction<Key<T, A>, Call<Client, E[T]['actions'][A]>>
      : MutationAction<
          Call<Client, E[T]['actions'][A]>,
          keyof E & string,
          OptimisticOf<Client, E, T, A, E[T]['actions'][A], Call<Client, E[T]['actions'][A]>>
        >;
  };
};

/** An app's optimistic function, as stored: the cached row and the input to the new row (D30). */
type RowFunction = (row: Record<string, unknown>, input: unknown) => Record<string, unknown>;

/** An app's optimistic function on store, as stored: what the new row holds besides the input. */
type RowMaker = (input: unknown) => Record<string, unknown>;

/** An optimistic change to one cached row: its replacement, or null to remove it (D30). */
type RowChange = (row: Record<string, unknown>) => Record<string, unknown> | null;

const isRow = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A page with the change applied to its rows; a removed row lowers the total. */
function changePage(page: unknown, change: RowChange): unknown {
  if (!isRow(page) || !Array.isArray(page.data)) return page;
  const data = page.data
    .map((row) => (isRow(row) ? change(row) : row))
    .filter((row) => row !== null);
  const removed = page.data.length - data.length;
  const meta = isRow(page.meta) ? page.meta : {};
  const total = typeof meta.total === 'number' ? meta.total - removed : meta.total;
  return { ...page, data, meta: { ...meta, total } };
}

/**
 * Applies a change to the row with the given key in every cached copy (D30): the show
 * queries for it, and the rows of every index page, plain or infinite. A show query is
 * left as it is when the change removes the row: the refetch after the reply 404s. The
 * table's running queries are cancelled first, so an earlier refetch cannot land on top.
 */
async function changeRows(
  client: QueryClient,
  table: string,
  key: Tables[string]['key'],
  id: unknown,
  change: (row: Record<string, unknown>) => Record<string, unknown> | null,
) {
  await client.cancelQueries({ queryKey: [table] });
  const matching: RowChange = (row) => (String(row[key.column]) === String(id) ? change(row) : row);
  for (const [queryKey, data] of client.getQueriesData({ queryKey: [table] })) {
    const action = queryKey[1];
    if (action === 'show' && isRow(data)) {
      const changed = matching(data);
      if (changed !== null) client.setQueryData(queryKey, changed);
    } else if (action === 'index' && isRow(data) && Array.isArray(data.pages)) {
      client.setQueryData(queryKey, {
        ...data,
        pages: data.pages.map((page) => changePage(page, matching)),
      });
    } else if (action === 'index') {
      client.setQueryData(queryKey, changePage(data, matching));
    }
  }
}

/** The change a mutation makes to its row before the reply, from its `optimistic` setting. */
/** Index query keys that are not column filters (the engine's INDEX_CONTROLS). */
const INDEX_CONTROLS = new Set(['page', 'per_page', 'sort', 'trashed', 'include']);

/** The query of a cached index, from its key. */
const queryOf = (queryKey: readonly unknown[]): Record<string, unknown> => {
  const input = queryKey[2];
  return isRow(input) && isRow(input.query) ? input.query : {};
};

/**
 * Whether a new row belongs in a cached list (D30): every filter of the list matches the
 * input by string equality, and none names a column the input leaves out; a list of trashed
 * rows never holds a new one.
 */
function listTakes(query: Record<string, unknown>, json: Record<string, unknown>): boolean {
  if (query.trashed === 'only') return false;
  return Object.entries(query).every(
    ([column, value]) =>
      INDEX_CONTROLS.has(column) || (column in json && String(json[column]) === String(value)),
  );
}

/** The page with the row added: at the top when the list sorts descending, else at the end. */
function addToPage(page: unknown, row: Record<string, unknown>, descending: boolean): unknown {
  if (!isRow(page) || !Array.isArray(page.data)) return page;
  const meta = isRow(page.meta) ? page.meta : {};
  const total = typeof meta.total === 'number' ? meta.total + 1 : meta.total;
  return {
    ...page,
    data: descending ? [row, ...page.data] : [...page.data, row],
    meta: { ...meta, total },
  };
}

/** Every page's total grown by one, for the pages of an infinite query the row is not on. */
const countOnPage = (page: unknown): unknown => {
  if (!isRow(page) || !isRow(page.meta) || typeof page.meta.total !== 'number') return page;
  return { ...page, meta: { ...page.meta, total: page.meta.total + 1 } };
};

const hasNext = (page: unknown) =>
  isRow(page) &&
  isRow(page.meta) &&
  typeof page.meta.page === 'number' &&
  typeof page.meta.per_page === 'number' &&
  typeof page.meta.total === 'number' &&
  page.meta.page * page.meta.per_page < page.meta.total;

/**
 * Puts a new row into the cached lists of its table (D30): those whose filters the input
 * matches, in the first page of a plain query and the last loaded page of an infinite one
 * when it has no next page, at the top when the list sorts descending, else at the end.
 */
async function addRow(
  client: QueryClient,
  table: string,
  row: Record<string, unknown>,
  json: Record<string, unknown>,
) {
  await client.cancelQueries({ queryKey: [table] });
  for (const [queryKey, data] of client.getQueriesData({ queryKey: [table] })) {
    if (queryKey[1] !== 'index' || !isRow(data)) continue;
    const query = queryOf(queryKey);
    if (!listTakes(query, json)) continue;
    const descending = typeof query.sort === 'string' && query.sort.startsWith('-');
    if (Array.isArray(data.pages)) {
      const last = data.pages.length - 1;
      if (last < 0 || hasNext(data.pages[last])) continue;
      const pages = data.pages.map((page, index) =>
        index === last ? addToPage(page, row, descending) : countOnPage(page),
      );
      client.setQueryData(queryKey, { ...data, pages });
    } else if (query.page === undefined || query.page === '1') {
      client.setQueryData(queryKey, addToPage(data, row, descending));
    }
  }
}

/** Temporary keys for optimistic rows: negative, so they never meet a real one (D30). */
let nextTemporaryKey = -1;

const temporaryKey = (key: Tables[string]['key']) =>
  key.type === 'number' ? nextTemporaryKey-- : crypto.randomUUID();

function changeOf(action: string, input: unknown, optimistic: true | RowFunction): RowChange {
  if (typeof optimistic === 'function') return (row) => optimistic(row, input);
  if (action === 'update') {
    const json = isRow(input) && isRow(input.json) ? input.json : {};
    return (row) => ({ ...row, ...json });
  }
  return () => null;
}

/** The paths a query's input asked `?include=` for: comma-separated, as the server takes them. */
function includesAsked(queryKey: readonly unknown[]): string[] {
  const input = queryKey[2] as { query?: { include?: unknown } } | undefined;
  const include = input?.query?.include;
  const parts = Array.isArray(include) ? include : [include];
  return parts
    .flatMap((part) => (typeof part === 'string' ? part.split(',') : []))
    .map((path) => path.trim())
    .filter(Boolean);
}

/**
 * The tables a path holds, walking the include map from the query's table (D32): `notes.author`
 * on orders gives order_notes, then users. It stops at a segment the map does not know.
 */
function tablesOnPath(tables: Tables, table: string, path: string): string[] {
  const held: string[] = [];
  let current = table;
  for (const segment of path.split('.')) {
    const next = tables[current]?.includes[segment];
    if (!next) break;
    held.push(next);
    current = next;
  }
  return held;
}

/** Every table a table's includes reach, at any depth. */
function reachableFrom(tables: Tables, table: string): Set<string> {
  const seen = new Set<string>();
  const queue = [table];
  for (let at = 0; at < queue.length; at++) {
    const from = queue[at];
    for (const target of Object.values(from ? (tables[from]?.includes ?? {}) : {})) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

/**
 * Invalidates the queries a write to `written` may have changed (N.2, N.8, D32): every query
 * of those tables, and, in each table whose includes reach one of them, the queries whose
 * input asked for a path that holds it.
 */
async function invalidate(client: QueryClient, tables: Tables, written: Iterable<string>) {
  const changed = new Set(written);
  const own = [...changed].map((table) => client.invalidateQueries({ queryKey: [table] }));
  const including = Object.keys(tables).flatMap((table) => {
    if (changed.has(table)) return [];
    const reaches = reachableFrom(tables, table);
    if (![...changed].some((target) => reaches.has(target))) return [];
    return [
      client.invalidateQueries({
        queryKey: [table],
        predicate: (query) =>
          includesAsked(query.queryKey).some((path) =>
            tablesOnPath(tables, table, path).some((held) => changed.has(held)),
          ),
      }),
    ];
  });
  await Promise.all([...own, ...including]);
}

/** TanStack Query options for every action in `tables`, called through `client`. */
export function createBlendxClient<Client, E extends Tables>(
  client: Client,
  tables: E,
): Api<Client, E> {
  const api: Record<string, Record<string, object>> = {};
  for (const [table, { actions, key }] of Object.entries(tables)) {
    api[table] = {};
    for (const [action, route] of Object.entries(actions)) {
      const [method = '', path = ''] = route.split(' ');
      const call = (input: unknown, signal?: AbortSignal) =>
        request(client, method, path, input, signal);
      // index: the same listing page by page (N.9). Its key keeps the input at the same place,
      // so the includes it asked for are read the same way when invalidating (N.8).
      const infinite =
        action === 'index'
          ? {
              infiniteQueryOptions: (input?: { query?: Record<string, unknown> }) =>
                toInfiniteQueryOptions(
                  [table, action, input ?? {}, 'infinite'],
                  (page, signal) =>
                    call(
                      { ...input, query: { ...input?.query, page: String(page) } },
                      signal,
                    ) as Promise<IndexPage>,
                ),
            }
          : {};
      api[table][action] =
        method === 'GET'
          ? {
              queryOptions: (input?: Record<string, unknown>) =>
                // TanStack aborts the signal when it cancels the query (N.7).
                toQueryOptions([table, action, input ?? {}], ({ signal }) => call(input, signal)),
              ...infinite,
              fieldErrors,
            }
          : {
              // Invalidating inside the mutation function, not in onSuccess, lets an app spread
              // its own onSuccess over the options without losing it.
              mutationOptions: (
                options?: MutationSettings<string, true | RowFunction | RowMaker>,
              ) =>
                toMutationOptions([table, action], async (input, { client: queryClient }) => {
                  // D30: the rows change before the request; a failure refetches the truth.
                  const { optimistic } = options ?? {};
                  let temporary: unknown;
                  if (optimistic && action === 'store') {
                    // A new row: the input, what the function adds, and a temporary key.
                    const json = isRow(input) && isRow(input.json) ? input.json : {};
                    const extra =
                      typeof optimistic === 'function' ? (optimistic as RowMaker)(input) : {};
                    temporary = temporaryKey(key);
                    await addRow(
                      queryClient,
                      table,
                      { ...json, ...extra, [key.column]: temporary },
                      json,
                    );
                  } else if (optimistic) {
                    const id = isRow(input) && isRow(input.param) ? input.param.id : undefined;
                    await changeRows(
                      queryClient,
                      table,
                      key,
                      id,
                      changeOf(action, input, optimistic as true | RowFunction),
                    );
                  }
                  let data: unknown;
                  try {
                    data = await call(input);
                  } catch (error) {
                    if (temporary !== undefined) {
                      await changeRows(queryClient, table, key, temporary, () => null);
                    }
                    if (optimistic) await invalidate(queryClient, tables, [table]);
                    throw error;
                  }
                  // The server's row takes the temporary one's place, until the refetch.
                  if (temporary !== undefined && isRow(data)) {
                    const saved = data;
                    await changeRows(queryClient, table, key, temporary, () => saved);
                  }
                  await invalidate(queryClient, tables, [table, ...(options?.invalidates ?? [])]);
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
