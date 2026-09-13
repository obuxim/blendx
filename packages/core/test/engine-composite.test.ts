/**
 * P16.16b (D33): a table whose primary key spans several columns. Its member routes carry one
 * segment per key column, the engine loads and saves the row by every column, and the index
 * and the has-many tiebreak order by the whole key.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  order_items as itemsTable,
  models as kitchen,
  orders as ordersTable,
  users as usersTable,
} from '../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('kitchen-sink'));
  const { db } = database;
  await db.insert(usersTable).values({ email: 'ada@example.com', password: 'a' });
  await db.insert(ordersTable).values([
    { user_id: 1, total: '10.00' },
    { user_id: 1, total: '20.00' },
  ]);
  await db.insert(itemsTable).values([
    { order_id: 1, line: 2, sku: 'B' },
    { order_id: 1, line: 1, sku: 'A' },
    { order_id: 2, line: 1, sku: 'C' },
  ]);
}, 60_000);
afterAll(() => database.close());

const app = defineApp({});

function endpoint(resource: Resource, action: string) {
  const found = toEndpoints(resource).find((e) => e.action === action);
  if (!found) throw new Error(`no ${action}`);
  return resolveEndpoint(found, { app, defaults: defaultEffects(found) });
}

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  params: {},
  query: {},
  body: undefined,
  auth: null,
  ...overrides,
});

type Item = { order_id: number; line: number; sku: string };
const keys = (rows: unknown) => (rows as Item[]).map((row) => [row.order_id, row.line]);

const items = blend(kitchen.order_items, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store(),
    a.show(),
    a.update(),
    a.destroy(),
    a.member('relabel', {
      rules: () => z.object({ sku: z.string() }),
      calculate: ({ input }) => ({ sku: input.sku }),
    }),
  ],
});

const orders = blend(kitchen.orders, {
  policy: allow.public,
  includes: { items: { blend: items, limit: 10 } },
  actions: (a) => [a.show()],
});

describe('routes of a composite key', () => {
  test('a composite key gives one path segment per column, in the key order', () => {
    expect(toEndpoints(items).map((e) => `${e.method.toUpperCase()} ${e.path}`)).toEqual([
      'GET /order_items',
      'POST /order_items',
      'GET /order_items/:order_id/:line',
      'PATCH /order_items/:order_id/:line',
      'DELETE /order_items/:order_id/:line',
      'POST /order_items/:order_id/:line/relabel',
    ]);
  });

  test('a single-column key keeps :id whatever the column is called', () => {
    expect(toEndpoints(orders).map((e) => e.path)).toEqual(['/orders/:id']);
  });
});

describe('loads by a composite key', () => {
  test('show loads the row both segments name', async () => {
    const shown = await execute(
      endpoint(items, 'show'),
      request({ params: { order_id: '1', line: '2' } }),
      database,
    );
    expect(shown.status).toBe(200);
    expect(shown.body).toEqual({ order_id: 1, line: 2, sku: 'B' });
  });

  test('a pair of segments that names no row is 404', async () => {
    const missing = await execute(
      endpoint(items, 'show'),
      request({ params: { order_id: '1', line: '9' } }),
      database,
    );
    expect(missing.status).toBe(404);
  });

  test("a segment that cannot be its column's type is 404", async () => {
    const wrong = await execute(
      endpoint(items, 'show'),
      request({ params: { order_id: '1', line: 'x' } }),
      database,
    );
    expect(wrong.status).toBe(404);
  });

  test('the index sorts by every key column in order', async () => {
    const page = await execute(endpoint(items, 'index'), request(), database);
    expect(keys((page.body as { data: unknown }).data)).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
  });

  test('a sort on one key column breaks ties by the rest of the key', async () => {
    const page = await execute(
      endpoint(items, 'index'),
      request({ query: { sort: '-line' } }),
      database,
    );
    expect(keys((page.body as { data: unknown }).data)).toEqual([
      [1, 2],
      [1, 1],
      [2, 1],
    ]);
  });

  test('a has-many include of a composite-key table orders its rows by the whole key', async () => {
    const shown = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: '1' }, query: { include: 'items' } }),
      database,
    );
    expect(shown.status).toBe(200);
    expect(keys((shown.body as { items: unknown }).items)).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });
});

describe('saves by a composite key', () => {
  test('update saves the row the segments name and no other', async () => {
    const updated = await execute(
      endpoint(items, 'update'),
      request({ params: { order_id: '1', line: '1' }, body: { sku: 'A2' } }),
      database,
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ order_id: 1, line: 1, sku: 'A2' });
    const rows = await database.db.select().from(itemsTable).where(eq(itemsTable.order_id, 1));
    expect(rows.map((row) => row.sku).sort()).toEqual(['A2', 'B']);
  });

  test('a custom member action loads and saves by every key column', async () => {
    const relabeled = await execute(
      endpoint(items, 'relabel'),
      request({ params: { order_id: '2', line: '1' }, body: { sku: 'C2' } }),
      database,
    );
    expect(relabeled.status).toBe(200);
    expect(relabeled.body).toEqual({ order_id: 2, line: 1, sku: 'C2' });
  });

  test('store takes the key columns as input', async () => {
    const stored = await execute(
      endpoint(items, 'store'),
      request({ body: { order_id: 2, line: 2, sku: 'D' } }),
      database,
    );
    expect(stored.status).toBe(201);
    expect(stored.body).toEqual({ order_id: 2, line: 2, sku: 'D' });
  });

  test('a second row with the same key answers 409 on the key', async () => {
    const twice = await execute(
      endpoint(items, 'store'),
      request({ body: { order_id: 2, line: 2, sku: 'E' } }),
      database,
    );
    expect(twice.status).toBe(409);
  });

  test('destroy deletes the row the segments name and no other', async () => {
    const gone = await execute(
      endpoint(items, 'destroy'),
      request({ params: { order_id: '1', line: '2' } }),
      database,
    );
    expect(gone.status).toBe(204);
    const rows = await database.db.select().from(itemsTable).where(eq(itemsTable.order_id, 1));
    expect(keys(rows)).toEqual([[1, 1]]);
  });
});
