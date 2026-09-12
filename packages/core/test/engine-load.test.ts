/**
 * P5.3: default loads. Member actions load by primary key and never see soft-deleted
 * rows (restore loads only those). index loads a filtered, sorted page with its total.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  allow,
  BlendxDefinitionError,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { eq, sql } from 'drizzle-orm';
import {
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'));
  const { db } = database;
  await db.insert(usersTable).values([
    { email: 'ada@example.com', password: 'a' },
    { email: 'bob@example.com', password: 'b' },
  ]);
  await db.insert(ordersTable).values([
    { user_id: 1, total: '10.00' },
    { user_id: 1, total: '20.00' },
    { user_id: 1, total: '30.00' },
    { user_id: 2, total: '40.00' },
    { user_id: 2, total: '50.00' },
  ]);
  await db.update(ordersTable).set({ deleted_at: sql`now()` }).where(eq(ordersTable.id, 2));
}, 60_000);
afterAll(() => database.close());

const app = defineApp({});

function endpoint(resource: Resource, action: string, perPage?: number) {
  const found = toEndpoints(resource).find((e) => e.action === action);
  if (!found) throw new Error(`no ${action}`);
  return resolveEndpoint(found, { app, defaults: defaultEffects(found, { perPage }) });
}

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  params: {},
  query: {},
  body: undefined,
  auth: null,
  ...overrides,
});

const ids = (body: unknown) => (body as { data: { id: number }[] }).data.map((row) => row.id);
const meta = (body: unknown) => (body as { meta: unknown }).meta;

const orders = blend(shop.orders, {
  policy: allow.public,
  actions: (a) => [a.index(), a.show(), a.restore()],
});

describe('member loads', () => {
  test('show loads a row by primary key', async () => {
    const shown = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ id: 1, user_id: 1, total: '10.00' });
  });

  test('a soft-deleted row is not found', async () => {
    const trashed = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: '2' } }),
      database,
    );
    expect(trashed.status).toBe(404);
  });

  test('restore loads only trashed rows', async () => {
    const restore = endpoint(orders, 'restore');
    const context = { db: database.db, query: {}, input: {}, auth: null };
    expect(await restore.load({ ...context, params: { id: '2' } })).toMatchObject({ id: 2 });
    expect(await restore.load({ ...context, params: { id: '1' } })).toBeUndefined();
  });
});

describe('index loads', () => {
  const list = async (
    query: Record<string, string>,
    resource: Resource = orders,
    perPage?: number,
  ) => execute(endpoint(resource, 'index', perPage), request({ query }), database);

  test('live rows sorted by primary key, with the page meta', async () => {
    const listed = await list({});
    expect(listed.status).toBe(200);
    expect(ids(listed.body)).toEqual([1, 3, 4, 5]);
    expect(meta(listed.body)).toEqual({ page: 1, per_page: 25, total: 4 });
  });

  test('exact filters narrow the rows and the total', async () => {
    const mine = await list({ user_id: '1' });
    expect(ids(mine.body)).toEqual([1, 3]);
    expect(meta(mine.body)).toEqual({ page: 1, per_page: 25, total: 2 });
  });

  test('a minus sorts descending', async () => {
    expect(ids((await list({ sort: '-id' })).body)).toEqual([5, 4, 3, 1]);
  });

  test('pages', async () => {
    const second = await list({ per_page: '2', page: '2' });
    expect(ids(second.body)).toEqual([4, 5]);
    expect(meta(second.body)).toEqual({ page: 2, per_page: 2, total: 4 });
  });

  test("the app's perPage applies when the request does not ask", async () => {
    const listed = await list({}, orders, 3);
    expect(ids(listed.body)).toEqual([1, 3, 4]);
    expect(meta(listed.body)).toMatchObject({ per_page: 3 });
  });

  test('?trashed works only where the resource enables it', async () => {
    const withTrashed = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.index({ trashed: true })],
    });
    expect(ids((await list({ trashed: 'with' }, withTrashed)).body)).toEqual([1, 2, 3, 4, 5]);
    expect(ids((await list({ trashed: 'only' }, withTrashed)).body)).toEqual([2]);
    expect((await list({ trashed: 'with' })).status).toBe(422);
  });

  test('hidden columns never leave, row by row', async () => {
    const users = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [a.index()],
    });
    const listed = await list({}, users);
    const rows = (listed.body as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !('password' in row) && 'email' in row)).toBe(true);
  });

  test('a load hook can scope the listing to the requester', async () => {
    const scoped = blend(shop.orders, {
      policy: allow.authenticated,
      actions: (a) => [
        a.index({
          load: async ({ runDefault, auth }) => {
            const page = await runDefault();
            const mine = page.data.filter((row) => row.user_id === (auth as { id: number }).id);
            return { data: mine, meta: { ...page.meta, total: mine.length } };
          },
        }),
      ],
    });
    const listed = await execute(endpoint(scoped, 'index'), request({ auth: { id: 2 } }), database);
    expect(ids(listed.body)).toEqual([4, 5]);
  });

  test('trashed needs a soft-delete table', () => {
    expect(() =>
      blend(shop.users, { policy: allow.public, actions: (a) => [a.index({ trashed: true })] }),
    ).toThrow(
      new BlendxDefinitionError(
        'users',
        'trashed needs a soft-delete table (a nullable deleted_at timestamp)',
      ),
    );
  });
});
