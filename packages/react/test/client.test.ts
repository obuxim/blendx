/**
 * N.1b: @blendx/react against the conformance shop fixture, served in-process on PGlite. Each
 * action's options run through a QueryClient the way useQuery and useMutation run them. The
 * fixture's identity is the x-user-id header; seed.sql gives users 1 and 2, and order 1 of user 1.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { createDatabase, createServer, type Database } from 'blendx';
import { hc } from 'blendx/client';
import { sql } from 'blendx/drizzle';
import app from '../../conformance/fixtures/shop/src/app.ts';
import { tables } from '../../conformance/fixtures/shop/src/generated/client.gen.ts';
import { type AppType, routes } from '../../conformance/fixtures/shop/src/generated/routes.gen.ts';
import { createBlendxClient, ProblemDetailsError } from '../src/index.ts';

const fixture = join(import.meta.dir, '..', '..', 'conformance', 'fixtures', 'shop');

let database: Database;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  await database.migrate(join(fixture, 'drizzle'));
  const seed = await readFile(join(fixture, 'seed.sql'), 'utf8');
  for (const statement of seed.split(/;\s*\n/).map((part) => part.trim())) {
    if (statement) await database.db.execute(sql.raw(statement));
  }
  server = createServer({ app, db: database.db, routes });
}, 30_000);
afterAll(() => database.close());

/** The fixture's actions, as the given user when there is one. */
function apiFor(userId?: number) {
  // hc's fetch option is typed as typeof fetch, which in Bun has extra members.
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    server.request(input, init)) as typeof globalThis.fetch;
  const headers: Record<string, string> = userId ? { 'x-user-id': String(userId) } : {};
  return createBlendxClient(hc<AppType>('http://localhost', { fetch, headers }), tables);
}

/** A client without retries, so a refusal fails the first time. */
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** What a promise rejects with. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

describe('createBlendxClient', () => {
  test('every table and action of the map, a GET action as a query and any other as a mutation', () => {
    const api = apiFor();
    expect(Object.keys(api)).toEqual(Object.keys(tables));
    expect(Object.keys(api.orders)).toEqual(Object.keys(tables.orders.actions));
    expect(Object.keys(api.orders.index)).toEqual(['queryOptions', 'fieldErrors']);
    expect(Object.keys(api.orders.quote)).toEqual(['queryOptions', 'fieldErrors']);
    expect(Object.keys(api.orders.store)).toEqual(['mutationOptions', 'fieldErrors']);
    expect(Object.keys(api.orders.refund)).toEqual(['mutationOptions', 'fieldErrors']);
  });

  test('a query key is [table, action, input], and no input is {}', () => {
    const api = apiFor();
    // Spread: the key's type carries TanStack's data tag, which a plain array literal lacks.
    expect([...api.orders.index.queryOptions().queryKey]).toEqual(['orders', 'index', {}]);
    expect([...api.orders.show.queryOptions({ param: { id: '1' } }).queryKey]).toEqual([
      'orders',
      'show',
      { param: { id: '1' } },
    ]);
  });

  test('a mutation key is [table, action]', () => {
    expect(apiFor().orders.store.mutationOptions().mutationKey).toEqual(['orders', 'store']);
  });
});

describe('queries', () => {
  test('index resolves to the page', async () => {
    const page = await queryClient().fetchQuery(apiFor().orders.index.queryOptions());
    expect(page.meta.total).toBe(1);
    expect(page.data[0]).toMatchObject({ id: 1, user_id: 1, status: 'paid' });
  });

  test('show resolves to the record', async () => {
    const options = apiFor(1).orders.show.queryOptions({ param: { id: '1' } });
    const client = queryClient();
    expect(await client.fetchQuery(options)).toMatchObject({ id: 1, total: '19.00' });
    expect(client.getQueryData(options.queryKey)).toMatchObject({ id: 1 });
  });

  test('a custom GET collection action is a query, with its input as the query string', async () => {
    const options = apiFor().orders.quote.queryOptions({ query: { quantity: '2' } });
    expect(await queryClient().fetchQuery(options)).toEqual({ total: '19.00' });
  });

  test('a refusal rejects with its Problem Details', async () => {
    const api = apiFor(2);
    const forbidden = await rejection(
      queryClient().fetchQuery(api.orders.show.queryOptions({ param: { id: '1' } })),
    );
    expect(forbidden).toBeInstanceOf(ProblemDetailsError);
    expect(forbidden).toMatchObject({
      status: 403,
      message: 'Forbidden',
      problem: { type: 'about:blank', title: 'Forbidden', status: 403 },
    });

    const missing = await rejection(
      queryClient().fetchQuery(api.orders.show.queryOptions({ param: { id: '99' } })),
    );
    expect(missing).toMatchObject({ status: 404, problem: { title: 'Not Found' } });
  });
});

describe('mutations', () => {
  test('store resolves to the created record', async () => {
    const store = new MutationObserver(queryClient(), apiFor(2).orders.store.mutationOptions());
    const order = await store.mutate({ json: { user_id: 2, total: '5.00' } });
    expect(order).toMatchObject({ user_id: 2, total: '5.00', status: 'pending', quantity: 1 });
  });

  test('a custom member action takes the id and its body', async () => {
    const refund = new MutationObserver(queryClient(), apiFor(1).orders.refund.mutationOptions());
    const order = await refund.mutate({ param: { id: '1' }, json: { reason: 'damaged' } });
    expect(order).toMatchObject({ id: 1, status: 'refunded' });
  });

  test('destroy replies 204 and resolves to null', async () => {
    const client = queryClient();
    const api = apiFor(2);
    const created = await new MutationObserver(client, api.orders.store.mutationOptions()).mutate({
      json: { user_id: 2, total: '1.00' },
    });
    const destroy = new MutationObserver(client, api.orders.destroy.mutationOptions());
    expect(await destroy.mutate({ param: { id: String(created.id) } })).toBeNull();
  });

  test('invalid input rejects with every failing field', async () => {
    const refund = new MutationObserver(queryClient(), apiFor(1).orders.refund.mutationOptions());
    const invalid = await rejection(refund.mutate({ param: { id: '1' }, json: { reason: 'no' } }));
    expect(invalid).toBeInstanceOf(ProblemDetailsError);
    expect(invalid).toMatchObject({
      status: 422,
      problem: { status: 422, errors: [{ pointer: '/reason' }] },
    });
  });

  test('without an identity, a write the policy guards rejects with 401', async () => {
    const store = new MutationObserver(queryClient(), apiFor().orders.store.mutationOptions());
    const refused = await rejection(store.mutate({ json: { user_id: 1, total: '5.00' } }));
    expect(refused).toMatchObject({ status: 401, problem: { title: 'Unauthorized' } });
  });
});

describe('invalidation (N.2)', () => {
  /** Data stays fresh until invalidated, so only invalidation refetches it. */
  const freshClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
  const invalidated = (client: QueryClient, queryKey: readonly unknown[]) =>
    client.getQueryState(queryKey)?.isInvalidated;

  test('a mutation refetches the active queries of its table before it resolves', async () => {
    const client = freshClient();
    const api = apiFor(2);
    const index = api.orders.index.queryOptions();
    const before = await client.fetchQuery(index);
    const observer = new QueryObserver(client, index);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await new MutationObserver(client, api.orders.store.mutationOptions()).mutate({
        json: { user_id: 2, total: '3.00' },
      });
      expect(observer.getCurrentResult().data?.meta.total).toBe(before.meta.total + 1);
    } finally {
      unsubscribe();
    }
  });

  test('every query of its table is invalidated; other tables only when the mutation names them', async () => {
    const client = freshClient();
    const api = apiFor(1);
    const order = api.orders.show.queryOptions({ param: { id: '1' } });
    const quote = api.orders.quote.queryOptions({ query: { quantity: '1' } });
    const user = api.users.show.queryOptions({ param: { id: '1' } });
    const notes = api.order_notes.index.queryOptions();
    await client.fetchQuery(order);
    await client.fetchQuery(quote);
    await client.fetchQuery(user);
    await client.fetchQuery(notes);
    const refund = { param: { id: '1' }, json: { reason: 'damaged' } };

    await new MutationObserver(client, api.orders.refund.mutationOptions()).mutate(refund);
    expect(invalidated(client, order.queryKey)).toBe(true);
    expect(invalidated(client, quote.queryKey)).toBe(true);
    expect(invalidated(client, user.queryKey)).toBe(false);

    const naming = api.orders.refund.mutationOptions({ invalidates: ['users'] });
    await new MutationObserver(client, naming).mutate(refund);
    expect(invalidated(client, user.queryKey)).toBe(true);
    expect(invalidated(client, notes.queryKey)).toBe(false);
  });

  test('a write to an included table refetches the queries that include it, and leaves the others (N.8)', async () => {
    const client = freshClient();
    const api = apiFor(1);
    const withUser = api.orders.index.queryOptions({ query: { include: 'user' } });
    const shownWithUser = api.orders.show.queryOptions({
      param: { id: '1' },
      query: { include: 'user' },
    });
    const plain = api.orders.index.queryOptions();
    const notes = api.order_notes.index.queryOptions();
    const before = await client.fetchQuery(withUser);
    expect(before.data[0]?.user).toMatchObject({ id: 1 });
    await client.fetchQuery(shownWithUser);
    await client.fetchQuery(plain);
    await client.fetchQuery(notes);
    const observer = new QueryObserver(client, withUser);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await new MutationObserver(client, api.users.update.mutationOptions()).mutate({
        param: { id: '1' },
        json: { display_name: 'Ada L.' },
      });
      // The active query refetched before the mutation resolved, and holds the new user.
      expect(observer.getCurrentResult().data?.data[0]?.user?.display_name).toBe('Ada L.');
      expect(invalidated(client, shownWithUser.queryKey)).toBe(true);
      expect(invalidated(client, plain.queryKey)).toBe(false);
      expect(invalidated(client, notes.queryKey)).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  test('a table a mutation names is followed to the queries that include it too', async () => {
    const client = freshClient();
    const api = apiFor(1);
    const withUser = api.orders.index.queryOptions({ query: { include: 'user' } });
    const plain = api.orders.index.queryOptions();
    await client.fetchQuery(withUser);
    await client.fetchQuery(plain);
    // A write to order_notes says it changes users: orders including user refetch, plain orders do not.
    await new MutationObserver(
      client,
      api.order_notes.store.mutationOptions({ invalidates: ['users'] }),
    ).mutate({ json: { order_id: 1, body: 'ring twice' } });
    expect(invalidated(client, withUser.queryKey)).toBe(true);
    expect(invalidated(client, plain.queryKey)).toBe(false);
  });

  test('a failed mutation invalidates nothing', async () => {
    const client = freshClient();
    const api = apiFor(1);
    const index = api.orders.index.queryOptions();
    await client.fetchQuery(index);
    const refund = new MutationObserver(client, api.orders.refund.mutationOptions());
    await rejection(refund.mutate({ param: { id: '1' }, json: { reason: 'no' } }));
    expect(invalidated(client, index.queryKey)).toBe(false);
  });

  test("the app's own onSuccess, spread over the options, keeps the invalidation", async () => {
    const client = freshClient();
    const api = apiFor(1);
    const index = api.orders.index.queryOptions();
    await client.fetchQuery(index);
    let succeeded = false;
    const options = {
      ...api.orders.refund.mutationOptions(),
      onSuccess: () => {
        succeeded = true;
      },
    };
    await new MutationObserver(client, options).mutate({
      param: { id: '1' },
      json: { reason: 'damaged' },
    });
    expect(succeeded).toBe(true);
    expect(invalidated(client, index.queryKey)).toBe(true);
  });
});

describe('fieldErrors (N.3)', () => {
  const problem = (errors: { detail: string; pointer?: string; parameter?: string }[]) =>
    new ProblemDetailsError({
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      errors,
    });

  test('a refused body: the first problem of each field, by its path', async () => {
    const api = apiFor(2);
    const store = new MutationObserver(queryClient(), api.orders.store.mutationOptions());
    // What the types already refuse: no total, and a number among the tags.
    const refused = await rejection(store.mutate({ json: { user_id: 2, tags: [1] } } as never));
    const errors = api.orders.store.fieldErrors(refused);
    expect(Object.keys(errors).sort()).toEqual(['tags.0', 'total']);
    expect(errors.total).toBeString();
  });

  test('a refused query: each parameter by its name', async () => {
    const api = apiFor();
    const options = api.orders.quote.queryOptions({ query: { quantity: 'many' } });
    const refused = await rejection(queryClient().fetchQuery(options));
    expect(Object.keys(api.orders.quote.fieldErrors(refused))).toEqual(['quantity']);
  });

  test('a database refusal names the columns of its constraint', async () => {
    const api = apiFor();
    const store = new MutationObserver(queryClient(), api.users.store.mutationOptions());
    const taken = await rejection(
      store.mutate({ json: { email: 'ada@example.com', password: 'secret' } }),
    );
    expect(taken).toMatchObject({ status: 409 });
    expect(Object.keys(api.users.store.fieldErrors(taken))).toEqual(['email']);
  });

  test('pointer segments are unescaped and joined with dots; the first detail wins', () => {
    const errors = apiFor().orders.refund.fieldErrors(
      problem([
        { pointer: '/reason', detail: 'first' },
        { pointer: '/reason', detail: 'second' },
        { pointer: '/a~1b/0/c~0d', detail: 'nested' },
      ]),
    ) as Record<string, string>;
    expect(errors).toEqual({ reason: 'first', 'a/b.0.c~d': 'nested' });
  });

  test('anything that is not a refusal with errors gives no field errors', () => {
    const { refund } = apiFor().orders;
    expect(refund.fieldErrors(null)).toEqual({});
    expect(refund.fieldErrors(new Error('offline'))).toEqual({});
    expect(refund.fieldErrors(problem([]))).toEqual({});
    const forbidden = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
    });
    expect(refund.fieldErrors(forbidden)).toEqual({});
  });
});

describe('a reply that is not Problem Details', () => {
  test('rejects with Problem Details made from its status', async () => {
    const fetch = (async () =>
      new Response('upstream is down', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as unknown as typeof globalThis.fetch;
    const api = createBlendxClient(hc<AppType>('http://localhost', { fetch }), tables);
    const failed = await rejection(queryClient().fetchQuery(api.orders.index.queryOptions()));
    expect(failed).toBeInstanceOf(ProblemDetailsError);
    expect((failed as ProblemDetailsError).problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
    });
  });
});

describe('cancellation (N.7)', () => {
  test("cancelling a query aborts its request, and the client's own init still applies", async () => {
    const sent: { init?: RequestInit } = {};
    // A request that records what it was sent with, and settles only when it is aborted.
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      sent.init = init;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof globalThis.fetch;
    const client = hc<AppType>('http://localhost', { fetch, init: { credentials: 'include' } });
    const api = createBlendxClient(client, tables);
    const queries = queryClient();
    const options = api.orders.index.queryOptions();

    const cancelled = rejection(queries.fetchQuery(options));
    while (!sent.init) await Bun.sleep(1);
    expect(sent.init.credentials).toBe('include');
    expect(sent.init.signal?.aborted).toBe(false);

    await queries.cancelQueries({ queryKey: options.queryKey });
    expect(sent.init.signal?.aborted).toBe(true);
    await cancelled;
  });
});
