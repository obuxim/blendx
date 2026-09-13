/**
 * P16.12 (D31) on real PostgreSQL: a has-many include's rows come from one query with a
 * window function, at most the limit per row, in the declared order. Runs only with
 * BLENDX_TEST_DB=pg and DATABASE_URL (a scratch database).
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
import {
  order_notes as notesTable,
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import {
  goldenSchema,
  postgresDatabase,
  realPostgres,
  type TestDatabase,
} from './support/database.ts';

let database: TestDatabase | undefined;

beforeAll(async () => {
  if (!realPostgres) return;
  database = await postgresDatabase(goldenSchema('shop'));
  await database.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await database.db.insert(ordersTable).values([
    { user_id: 1, total: '10.00' },
    { user_id: 1, total: '20.00' },
  ]);
  await database.db.insert(notesTable).values([
    { order_id: 1, body: 'one' },
    { order_id: 2, body: 'two' },
    { order_id: 1, body: 'three' },
    { order_id: 1, body: 'four' },
  ]);
}, 60_000);
afterAll(() => database?.close());

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

const notes = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.show()] });
const orders = blend(shop.orders, {
  policy: allow.public,
  includes: { notes: { blend: notes, limit: 2, sort: '-id' } },
  actions: (a) => [a.index()],
});

describe.skipIf(!realPostgres)('has-many includes on real PostgreSQL (D31)', () => {
  test('each row gets at most the limit, in the declared order', async () => {
    if (!database) throw new Error('no database');
    const reply = await execute(
      endpoint(orders, 'index'),
      request({ query: { include: 'notes' } }),
      database,
    );
    expect(reply.status).toBe(200);
    const rows = (reply.body as { data: { id: number; notes: { body: string }[] }[] }).data;
    expect(rows.map((order) => [order.id, order.notes.map((note) => note.body)])).toEqual([
      [1, ['four', 'three']],
      [2, ['two']],
    ]);
  });
});
