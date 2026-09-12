/**
 * P5.4: default saves. store inserts, update and custom member actions update and touch
 * updated_at, destroy soft-deletes (or deletes on tables without deleted_at), restore
 * clears deleted_at. calculate may only write the model's writable columns.
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
  order_notes as notesTable,
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
const past = '2020-01-01 00:00:00';

beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'));
  const { db } = database;
  await db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await db.insert(ordersTable).values([
    { user_id: 1, total: '10.00' },
    { user_id: 1, total: '20.00' },
    { user_id: 1, total: '30.00' },
  ]);
  await db.update(ordersTable).set({ created_at: past, updated_at: past });
  await db.insert(notesTable).values([{ order_id: 1, body: 'ring twice' }]);
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

const orders = blend(shop.orders, {
  policy: allow.public,
  actions: (a) => [
    a.store(),
    a.show(),
    a.update(),
    a.destroy(),
    a.restore(),
    a.member('mark_paid', { calculate: () => ({ status: 'paid' as const }) }),
    a.member('noop', { calculate: () => ({}) }),
  ],
});

const rowOf = async (id: number) => {
  const [row] = await database.db.select().from(ordersTable).where(eq(ordersTable.id, id));
  return row;
};

describe('default saves', () => {
  test('store inserts, fills defaults and sets both timestamps', async () => {
    const created = await execute(
      endpoint(orders, 'store'),
      request({ body: { user_id: 1, total: '5.00' } }),
      database,
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 4, status: 'pending', quantity: 1, deleted_at: null });
    const body = created.body as { created_at: string; updated_at: string };
    expect(body.updated_at).toBe(body.created_at);
  });

  test('update writes the input and touches updated_at', async () => {
    const updated = await execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 3 } }),
      database,
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: 1, quantity: 3, created_at: past });
    expect((updated.body as { updated_at: string }).updated_at).not.toBe(past);
  });

  test('a custom member action saves what calculate returns', async () => {
    const paid = await execute(
      endpoint(orders, 'mark_paid'),
      request({ params: { id: '3' } }),
      database,
    );
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ id: 3, status: 'paid' });
  });

  test('with nothing to write, the record comes back unchanged', async () => {
    const before = await rowOf(2);
    const unchanged = await execute(
      endpoint(orders, 'noop'),
      request({ params: { id: '2' } }),
      database,
    );
    expect(unchanged.body).toEqual(before);
    expect((await rowOf(2))?.updated_at).toBe(past);
  });

  test('destroy soft-deletes: 204, the row stays with deleted_at set, show no longer finds it', async () => {
    const destroyed = await execute(
      endpoint(orders, 'destroy'),
      request({ params: { id: '2' } }),
      database,
    );
    expect(destroyed).toEqual({ status: 204, body: null, headers: {} });
    expect((await rowOf(2))?.deleted_at).toBeString();
    expect(
      (await execute(endpoint(orders, 'show'), request({ params: { id: '2' } }), database)).status,
    ).toBe(404);
  });

  test('restore clears deleted_at', async () => {
    const restored = await execute(
      endpoint(orders, 'restore'),
      request({ params: { id: '2' } }),
      database,
    );
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id: 2, deleted_at: null });
    expect(
      (await execute(endpoint(orders, 'show'), request({ params: { id: '2' } }), database)).status,
    ).toBe(200);
  });

  test('destroy deletes the row on a table without deleted_at', async () => {
    const notes = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.destroy()] });
    const destroyed = await execute(
      endpoint(notes, 'destroy'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(destroyed.status).toBe(204);
    expect(await database.db.$count(notesTable)).toBe(0);
  });
});

describe('the writable-column guard', () => {
  test('calculate writing a generated or unknown column fails loudly instead of being dropped', async () => {
    const broken = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('bad_id', { calculate: () => ({ id: 99 }) as never }),
        a.member('bad_shape', { calculate: () => 'paid' as never }),
      ],
    });
    await expect(
      execute(endpoint(broken, 'bad_id'), request({ params: { id: '1' } }), database),
    ).rejects.toThrow('orders.bad_id: calculate returned "id", not writable columns');
    await expect(
      execute(endpoint(broken, 'bad_shape'), request({ params: { id: '1' } }), database),
    ).rejects.toThrow('orders.bad_shape: calculate must return an object of column values');
    expect((await rowOf(1))?.id).toBe(1);
  });
});
