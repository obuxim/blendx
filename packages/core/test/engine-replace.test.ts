/**
 * P16.17a (D34): replace, PUT /<table>/:id. Its body is the store rules without the key
 * columns; a writable, visible column it leaves out is reset, to its schema default or to
 * null; hidden columns are left alone; the row is loaded, saved and answered as update does.
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
import {
  order_items as itemsTable,
  models as kitchen,
  orders as ordersTable,
  users as usersTable,
} from '../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
const past = '2020-01-01 00:00:00';

beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('kitchen-sink'));
  const { db } = database;
  await db
    .insert(usersTable)
    .values({ email: 'ada@example.com', password: 'a', display_name: 'Ada', is_active: false });
  await db.insert(ordersTable).values([
    { user_id: 1, total: '10.00', quantity: 5, status: 'paid', tags: ['a'], meta: { a: 1 } },
    { user_id: 1, total: '20.00', quantity: 3 },
  ]);
  await db.update(ordersTable).set({ created_at: past, updated_at: past });
  await db.insert(itemsTable).values([
    { order_id: 1, line: 1, sku: 'A' },
    { order_id: 1, line: 2, sku: 'B' },
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

const pointers = (body: unknown) =>
  ((body as { errors?: { pointer: string }[] }).errors ?? []).map((error) => error.pointer);

const orders = blend(kitchen.orders, {
  policy: allow.public,
  actions: (a) => [a.show(), a.update(), a.replace(), a.destroy()],
});

const users = blend(kitchen.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.replace()],
});

const items = blend(kitchen.order_items, {
  policy: allow.public,
  actions: (a) => [a.replace()],
});

let seen: unknown;
const calculating = blend(kitchen.orders, {
  policy: allow.public,
  actions: (a) => [
    a.replace({
      calculate: ({ prev }) => {
        seen = prev;
        return { ...prev, quantity: 7 };
      },
    }),
  ],
});

describe('replace (D34)', () => {
  test('replace is PUT /<table>/:id, between update and destroy', () => {
    expect(toEndpoints(orders).map((e) => `${e.method.toUpperCase()} ${e.path}`)).toEqual([
      'GET /orders/:id',
      'PATCH /orders/:id',
      'PUT /orders/:id',
      'DELETE /orders/:id',
    ]);
  });

  test('DR-REPLACE-RESET: a column the body leaves out goes to its default, or to null without one', async () => {
    const [before] = await database.db.select().from(ordersTable).where(eq(ordersTable.id, 1));
    const replaced = await execute(
      endpoint(orders, 'replace'),
      request({ params: { id: '1' }, body: { user_id: 1, total: '9.00' } }),
      database,
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({
      id: 1,
      user_id: 1,
      total: '9.00',
      quantity: 1,
      status: 'pending',
      tags: null,
      meta: null,
      deleted_at: null,
    });
    const after = replaced.body as { public_id: string; updated_at: string; created_at: string };
    // A defaulted column is reset to a fresh default, even a generated one.
    expect(after.public_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(after.public_id).not.toBe(before?.public_id);
    expect(after.updated_at).not.toBe(past);
    expect(after.created_at).toBe(past);
  });

  test('a hidden column is left as it is, unless the body carries it', async () => {
    const replaced = await execute(
      endpoint(users, 'replace'),
      request({ params: { id: '1' }, body: { email: 'ada@example.com' } }),
      database,
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({ id: 1, display_name: null, is_active: true });
    expect(replaced.body).not.toHaveProperty('password');
    const [kept] = await database.db.select().from(usersTable).where(eq(usersTable.id, 1));
    expect(kept?.password).toBe('a');

    await execute(
      endpoint(users, 'replace'),
      request({ params: { id: '1' }, body: { email: 'ada@example.com', password: 'b' } }),
      database,
    );
    const [changed] = await database.db.select().from(usersTable).where(eq(usersTable.id, 1));
    expect(changed?.password).toBe('b');
  });

  test('DR-REPLACE-BODY: a required column left out is 422, naming it', async () => {
    const refused = await execute(
      endpoint(orders, 'replace'),
      request({ params: { id: '1' }, body: { quantity: 1 } }),
      database,
    );
    expect(refused.status).toBe(422);
    expect(pointers(refused.body)).toEqual(['/user_id', '/total']);
  });

  test('a key column in the body is 422: the path names the row', async () => {
    const refused = await execute(
      endpoint(items, 'replace'),
      request({ params: { order_id: '1', line: '2' }, body: { order_id: 1, sku: 'x' } }),
      database,
    );
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('order_id');
  });

  test('calculate sees the nulls in prev, and what it sets is not reset', async () => {
    const replaced = await execute(
      endpoint(calculating, 'replace'),
      request({ params: { id: '2' }, body: { user_id: 1, total: '9.00' } }),
      database,
    );
    expect(replaced.status).toBe(200);
    expect(seen).toEqual({ user_id: 1, total: '9.00', tags: null, meta: null });
    expect(replaced.body).toMatchObject({ id: 2, quantity: 7, status: 'pending', tags: null });
  });

  test('a row that does not exist is 404, never created', async () => {
    const missing = await execute(
      endpoint(orders, 'replace'),
      request({ params: { id: '999' }, body: { user_id: 1, total: '1.00' } }),
      database,
    );
    expect(missing.status).toBe(404);
    expect(await database.db.$count(ordersTable)).toBe(2);
  });

  test('a composite key: the row every segment names is replaced, and no other', async () => {
    const replaced = await execute(
      endpoint(items, 'replace'),
      request({ params: { order_id: '1', line: '2' }, body: { sku: 'Z' } }),
      database,
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body).toEqual({ order_id: 1, line: 2, sku: 'Z' });
    const rows = await database.db.select().from(itemsTable).where(eq(itemsTable.order_id, 1));
    expect(rows.map((row) => row.sku).sort()).toEqual(['A', 'Z']);
  });
});
