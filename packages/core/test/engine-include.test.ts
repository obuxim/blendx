/**
 * P16.8 (D28): ?include= on index and show. Each named relation's rows are loaded in one query
 * for the whole page, go through the target blend's show (its policy and authorize hooks, row
 * by row) with its hidden columns removed, and are nested under the relation's name, or null.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  type App,
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
import { eq, sql } from 'drizzle-orm';
import {
  order_notes as notesTable,
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

const log: string[] = [];
let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'), { log });
  await database.db.insert(usersTable).values([
    { email: 'ada@example.com', password: 'a', display_name: 'Ada' },
    { email: 'bob@example.com', password: 'b', display_name: 'Bob' },
  ]);
  await database.db.insert(ordersTable).values([
    { user_id: 1, total: '10.00' },
    { user_id: 2, total: '20.00' },
    { user_id: 1, total: '30.00' },
    { user_id: 2, total: '40.00' },
  ]);
  await database.db.insert(notesTable).values([
    { order_id: 1, body: 'first' },
    { order_id: 2, body: 'second' },
  ]);
  await database.db
    .update(ordersTable)
    .set({ deleted_at: sql`now()` })
    .where(eq(ordersTable.id, 2));
}, 60_000);
afterAll(() => database.close());

// A user sees only their own record: the rule every include of a user goes through.
const users = blend(shop.users, {
  policy: allow.owner('id'),
  hidden: ['password'],
  actions: (a) => [a.show()],
});
const orders = blend(shop.orders, {
  policy: allow.public,
  includes: { user: users },
  actions: (a) => [a.index(), a.show()],
});
const plainOrders = blend(shop.orders, { policy: allow.public, actions: (a) => [a.show()] });
const notes = blend(shop.order_notes, {
  policy: allow.public,
  includes: { order: plainOrders },
  actions: (a) => [a.index()],
});

function endpoint(resource: Resource, action: string, app: App = defineApp({})) {
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

const ada = { id: 1 };
type Row = Record<string, unknown>;
const rowsOf = (body: unknown) => (body as { data: Row[] }).data;
const idOf = (row: unknown) => (row as { id: number } | null)?.id ?? null;

describe('?include= (D28)', () => {
  test('show nests the row its foreign key points to, without its hidden columns', async () => {
    const reply = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: '1' }, query: { include: 'user' }, auth: ada }),
      database,
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      id: 1,
      user_id: 1,
      user: { id: 1, email: 'ada@example.com', display_name: 'Ada' },
    });
    expect((reply.body as { user: object }).user).not.toHaveProperty('password');
  });

  test("each included row goes through the target's show: a row it refuses is null", async () => {
    const signedIn = await execute(
      endpoint(orders, 'index'),
      request({ query: { include: 'user' }, auth: ada }),
      database,
    );
    expect(rowsOf(signedIn.body).map((order) => [order.id, idOf(order.user)])).toEqual([
      [1, 1],
      [3, 1],
      [4, null],
    ]);
    const anonymous = await execute(
      endpoint(orders, 'index'),
      request({ query: { include: 'user' } }),
      database,
    );
    expect(rowsOf(anonymous.body).map((order) => order.user)).toEqual([null, null, null]);
  });

  test("the target show's authorize hooks decide too", async () => {
    const guarded = blend(shop.users, {
      policy: allow.public,
      actions: (a) => [
        a.show({ authorize: ({ prev, record }) => prev && record.display_name !== 'Bob' }),
      ],
    });
    const listed = blend(shop.orders, {
      policy: allow.public,
      includes: { user: guarded },
      actions: (a) => [a.index()],
    });
    const reply = await execute(
      endpoint(listed, 'index'),
      request({ query: { include: 'user' } }),
      database,
    );
    expect(rowsOf(reply.body).map((order) => idOf(order.user))).toEqual([1, 1, null]);
  });

  test('a row that show would not find, such as a soft-deleted one, is null', async () => {
    const reply = await execute(
      endpoint(notes, 'index'),
      request({ query: { include: 'order' } }),
      database,
    );
    expect(rowsOf(reply.body).map((note) => [note.body, idOf(note.order)])).toEqual([
      ['first', 1],
      ['second', null],
    ]);
  });

  test('one query per relation, for the whole page', async () => {
    log.length = 0;
    await execute(
      endpoint(orders, 'index'),
      request({ query: { include: 'user' }, auth: ada }),
      database,
    );
    const lookups = log.filter((query) => query.startsWith('select') && query.includes('"users"'));
    expect(lookups).toHaveLength(1);
  });

  test('without include nothing is nested; a hidden foreign key still includes, and stays hidden', async () => {
    const plain = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: '1' }, auth: ada }),
      database,
    );
    expect(plain.body).not.toHaveProperty('user');

    const hiding = blend(shop.orders, {
      policy: allow.public,
      hidden: ['user_id'],
      includes: { user: users },
      actions: (a) => [a.show()],
    });
    const reply = await execute(
      endpoint(hiding, 'show'),
      request({ params: { id: '1' }, query: { include: 'user' }, auth: ada }),
      database,
    );
    expect(reply.body).not.toHaveProperty('user_id');
    expect(reply.body).toMatchObject({ user: { id: 1 } });
  });

  test('an unknown name answers 422 naming the parameter, as include does where nothing is includable', async () => {
    const unknown = await execute(
      endpoint(orders, 'index'),
      request({ query: { include: 'customer' } }),
      database,
    );
    expect(unknown.status).toBe(422);
    expect(unknown.body).toMatchObject({ errors: [{ parameter: 'include' }] });

    const none = await execute(
      endpoint(plainOrders, 'show'),
      request({ params: { id: '1' }, query: { include: 'user' } }),
      database,
    );
    expect(none.status).toBe(422);
    expect(none.body).toMatchObject({ errors: [{ parameter: 'include' }] });
  });

  test('respond receives the record with its includes', async () => {
    const shaped = blend(shop.orders, {
      policy: allow.public,
      includes: { user: users },
      actions: (a) => [
        a.show({
          respond: ({ prev, record }) => ({
            ...prev,
            body: { who: record.user?.display_name ?? null },
          }),
        }),
      ],
    });
    const reply = await execute(
      endpoint(shaped, 'show'),
      request({ params: { id: '1' }, query: { include: 'user' }, auth: ada }),
      database,
    );
    expect(reply.body).toEqual({ who: 'Ada' });
  });
});
