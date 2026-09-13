/**
 * N.1b: @blendx/react against the conformance shop fixture, served in-process on PGlite. Each
 * action's options run through a QueryClient the way useQuery and useMutation run them. The
 * fixture's identity is the x-user-id header; seed.sql gives users 1 and 2, and order 1 of user 1.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { createDatabase, createServer, type Database } from 'blendx';
import { hc } from 'blendx/client';
import { sql } from 'blendx/drizzle';
import app from '../../conformance/fixtures/shop/src/app.ts';
import { endpoints } from '../../conformance/fixtures/shop/src/generated/client.gen.ts';
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
  return createBlendxClient(hc<AppType>('http://localhost', { fetch, headers }), endpoints);
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
    expect(Object.keys(api)).toEqual(Object.keys(endpoints));
    expect(Object.keys(api.orders)).toEqual(Object.keys(endpoints.orders));
    expect(Object.keys(api.orders.index)).toEqual(['queryOptions']);
    expect(Object.keys(api.orders.quote)).toEqual(['queryOptions']);
    expect(Object.keys(api.orders.store)).toEqual(['mutationOptions']);
    expect(Object.keys(api.orders.refund)).toEqual(['mutationOptions']);
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

describe('a reply that is not Problem Details', () => {
  test('rejects with Problem Details made from its status', async () => {
    const fetch = (async () =>
      new Response('upstream is down', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as unknown as typeof globalThis.fetch;
    const api = createBlendxClient(hc<AppType>('http://localhost', { fetch }), endpoints);
    const failed = await rejection(queryClient().fetchQuery(api.orders.index.queryOptions()));
    expect(failed).toBeInstanceOf(ProblemDetailsError);
    expect((failed as ProblemDetailsError).problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
    });
  });
});
