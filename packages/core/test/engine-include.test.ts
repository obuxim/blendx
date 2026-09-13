/**
 * P16.8 (D28): ?include= on index and show. Each named relation's rows are loaded in one query
 * for the whole page, go through the target blend's show (its policy and authorize hooks, row
 * by row) with its hidden columns removed, and are nested under the relation's name, or null.
 * P16.12 (D31): a has-many include nests the rows that point at each row, at most its limit
 * per row, in its order, as an array; a row the target's show refuses is dropped.
 * P16.14 (D32): a dotted path follows the includes of the included blends, level by level,
 * each level through its own show, one query per path for the whole reply.
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

describe('has-many includes (D31)', () => {
  beforeAll(async () => {
    // Order 1 gets three more notes (ids 3 to 5); orders 3 and 4 have none.
    await database.db.insert(notesTable).values([
      { order_id: 1, body: 'third' },
      { order_id: 1, body: 'fourth' },
      { order_id: 1, body: 'fifth' },
    ]);
  });

  const noteRows = blend(shop.order_notes, {
    policy: allow.public,
    hidden: ['created_at'],
    actions: (a) => [a.show()],
  });
  const withNotes = blend(shop.orders, {
    policy: allow.public,
    includes: { user: users, notes: { blend: noteRows, limit: 2, sort: '-id' } },
    actions: (a) => [a.index(), a.show()],
  });
  const notesOf = (row: unknown) =>
    ((row as { notes: Row[] }).notes ?? []).map((note) => note.id as number);

  test('show nests the rows that point at it, at most its limit, in its order, without their hidden columns', async () => {
    const reply = await execute(
      endpoint(withNotes, 'show'),
      request({ params: { id: '1' }, query: { include: 'notes' } }),
      database,
    );
    expect(reply.status).toBe(200);
    expect(notesOf(reply.body)).toEqual([5, 4]);
    const [first] = (reply.body as { notes: Row[] }).notes;
    expect(first).toEqual({ id: 5, order_id: 1, body: 'fifth' });
    expect(first).not.toHaveProperty('created_at');
    expect(first).not.toHaveProperty('rn');
  });

  test('a row with none gets an empty array, never null', async () => {
    const reply = await execute(
      endpoint(withNotes, 'show'),
      request({ params: { id: '3' }, query: { include: 'notes' } }),
      database,
    );
    expect((reply.body as { notes: unknown }).notes).toEqual([]);
  });

  test('every row of an index page gets its own rows, and a belongs-to beside it', async () => {
    const reply = await execute(
      endpoint(withNotes, 'index'),
      request({ query: { include: 'notes,user' }, auth: ada }),
      database,
    );
    expect(rowsOf(reply.body).map((order) => [order.id, notesOf(order), idOf(order.user)])).toEqual(
      [
        [1, [5, 4], 1],
        [3, [], 1],
        [4, [], null],
      ],
    );
  });

  test("without a sort, the rows come in the order of the target's primary key", async () => {
    const ascending = blend(shop.orders, {
      policy: allow.public,
      includes: { notes: { blend: noteRows, limit: 10 } },
      actions: (a) => [a.show()],
    });
    const reply = await execute(
      endpoint(ascending, 'show'),
      request({ params: { id: '1' }, query: { include: 'notes' } }),
      database,
    );
    expect(notesOf(reply.body)).toEqual([1, 3, 4, 5]);
  });

  test("a row the target's show refuses is dropped, and still counts against the limit", async () => {
    const guarded = blend(shop.order_notes, {
      policy: allow.public,
      actions: (a) => [
        a.show({ authorize: ({ prev, record }) => prev && record.body !== 'fifth' }),
      ],
    });
    const listed = blend(shop.orders, {
      policy: allow.public,
      includes: { notes: { blend: guarded, limit: 2, sort: '-id' } },
      actions: (a) => [a.show()],
    });
    const reply = await execute(
      endpoint(listed, 'show'),
      request({ params: { id: '1' }, query: { include: 'notes' } }),
      database,
    );
    expect(notesOf(reply.body)).toEqual([4]);
  });

  test("the target's policy decides each row: anonymous sees none, an owner theirs", async () => {
    // A user's orders, through a show only the order's owner may see.
    const ownOrders = blend(shop.orders, {
      policy: allow.owner('user_id'),
      actions: (a) => [a.show()],
    });
    const withOrders = blend(shop.users, {
      policy: allow.public,
      includes: { orders: { blend: ownOrders, limit: 10 } },
      actions: (a) => [a.show()],
    });
    const ordersOf = (body: unknown) =>
      (body as { orders: Row[] }).orders.map((order) => order.id as number);
    const anonymous = await execute(
      endpoint(withOrders, 'show'),
      request({ params: { id: '1' }, query: { include: 'orders' } }),
      database,
    );
    expect(ordersOf(anonymous.body)).toEqual([]);
    const own = await execute(
      endpoint(withOrders, 'show'),
      request({ params: { id: '1' }, query: { include: 'orders' }, auth: ada }),
      database,
    );
    expect(ordersOf(own.body)).toEqual([1, 3]);
  });

  test('soft-deleted rows are left out', async () => {
    const withOrders = blend(shop.users, {
      policy: allow.public,
      includes: { orders: { blend: plainOrders, limit: 10 } },
      actions: (a) => [a.show()],
    });
    const reply = await execute(
      endpoint(withOrders, 'show'),
      request({ params: { id: '2' }, query: { include: 'orders' } }),
      database,
    );
    // Order 2 is soft-deleted; user 2 also has order 4.
    expect((reply.body as { orders: Row[] }).orders.map((order) => order.id)).toEqual([4]);
  });

  test('one query per relation, for the whole page', async () => {
    log.length = 0;
    await execute(endpoint(withNotes, 'index'), request({ query: { include: 'notes' } }), database);
    const lookups = log.filter(
      (query) => query.startsWith('select') && query.includes('"order_notes"'),
    );
    expect(lookups).toHaveLength(1);
  });

  test('respond receives the record with its rows', async () => {
    const shaped = blend(shop.orders, {
      policy: allow.public,
      includes: { notes: { blend: noteRows, limit: 10 } },
      actions: (a) => [
        a.show({
          respond: ({ prev, record }) => ({
            ...prev,
            body: { bodies: (record.notes ?? []).map((note) => note.body) },
          }),
        }),
      ],
    });
    const reply = await execute(
      endpoint(shaped, 'show'),
      request({ params: { id: '1' }, query: { include: 'notes' } }),
      database,
    );
    expect(reply.body).toEqual({ bodies: ['first', 'third', 'fourth', 'fifth'] });
  });
});

describe('nested includes (D32)', () => {
  // notes -> orders -> users: each note's order, and the order's user, through `orders` above.
  const notesWithOrder = blend(shop.order_notes, {
    policy: allow.public,
    includes: { order: orders },
    actions: (a) => [a.index(), a.show()],
  });
  // orders -> notes (has-many) -> order -> user: three levels down from an order.
  const ordersNested = blend(shop.orders, {
    policy: allow.public,
    includes: { notes: { blend: notesWithOrder, limit: 2, sort: '-id' } },
    actions: (a) => [a.index(), a.show()],
  });
  // users -> orders (has-many) -> notes (has-many): a limit at each level.
  const ordersWithNotes = blend(shop.orders, {
    policy: allow.public,
    includes: { notes: { blend: notesWithOrder, limit: 2, sort: '-id' } },
    actions: (a) => [a.show()],
  });
  const usersWithOrders = blend(shop.users, {
    policy: allow.public,
    includes: { orders: { blend: ordersWithNotes, limit: 2 } },
    actions: (a) => [a.show()],
  });
  const orderOf = (row: unknown) => (row as { order: Row | null }).order;
  const notesOf = (row: unknown) => ((row as { notes: Row[] }).notes ?? []).map((note) => note.id);

  test('a dotted path nests the include of an included row, and asks its prefixes', async () => {
    const reply = await execute(
      endpoint(notesWithOrder, 'show'),
      request({ params: { id: '1' }, query: { include: 'order.user' }, auth: ada }),
      database,
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      id: 1,
      order: { id: 1, user_id: 1, user: { id: 1, display_name: 'Ada' } },
    });
    expect((orderOf(reply.body) as { user: object }).user).not.toHaveProperty('password');
  });

  test('a refused or missing belongs-to nests nothing below it', async () => {
    // Note 2 points at order 2, which is soft-deleted: null, and no query for its user.
    log.length = 0;
    const missing = await execute(
      endpoint(notesWithOrder, 'show'),
      request({ params: { id: '2' }, query: { include: 'order.user' }, auth: ada }),
      database,
    );
    expect(orderOf(missing.body)).toBeNull();
    expect(log.filter((query) => query.startsWith('select') && query.includes('"users"'))).toEqual(
      [],
    );
    // Anonymous: the order is public, its user is not.
    const refused = await execute(
      endpoint(notesWithOrder, 'show'),
      request({ params: { id: '1' }, query: { include: 'order.user' } }),
      database,
    );
    expect(orderOf(refused.body)).toMatchObject({ id: 1, user: null });
  });

  test("a has-many's rows nest their own includes, at most its limit", async () => {
    const reply = await execute(
      endpoint(ordersNested, 'show'),
      request({ params: { id: '1' }, query: { include: 'notes.order.user' }, auth: ada }),
      database,
    );
    expect(notesOf(reply.body)).toEqual([5, 4]);
    const [first] = (reply.body as { notes: Row[] }).notes;
    expect(first).toMatchObject({ id: 5, order: { id: 1, user: { id: 1, display_name: 'Ada' } } });
  });

  test('a has-many under a has-many is bounded at each level', async () => {
    const reply = await execute(
      endpoint(usersWithOrders, 'show'),
      request({ params: { id: '1' }, query: { include: 'orders.notes' } }),
      database,
    );
    const orders = (reply.body as { orders: Row[] }).orders;
    expect(orders.map((order) => [order.id, notesOf(order)])).toEqual([
      [1, [5, 4]],
      [3, []],
    ]);
  });

  test('one query per path, for the whole page', async () => {
    log.length = 0;
    await execute(endpoint(ordersNested, 'index'), request({ query: {} }), database);
    const selects = () => log.filter((query) => query.startsWith('select'));
    const plain = selects().length;
    log.length = 0;
    await execute(
      endpoint(ordersNested, 'index'),
      request({ query: { include: 'notes.order.user' }, auth: ada }),
      database,
    );
    // Three paths, three more queries: notes, notes.order and notes.order.user.
    expect(selects()).toHaveLength(plain + 3);
    expect(selects().filter((query) => query.includes('"users"'))).toHaveLength(1);
    expect(selects().filter((query) => query.includes('"order_notes"'))).toHaveLength(1);
  });

  test('a nested row goes through its own show, and loses its hidden columns', async () => {
    const guardedUsers = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [
        a.show({ authorize: ({ prev, record }) => prev && record.display_name !== 'Bob' }),
      ],
    });
    const ordersWithGuarded = blend(shop.orders, {
      policy: allow.public,
      includes: { user: guardedUsers },
      actions: (a) => [a.show()],
    });
    const listed = blend(shop.order_notes, {
      policy: allow.public,
      includes: { order: ordersWithGuarded },
      actions: (a) => [a.index()],
    });
    // Order 1 is Ada's, order 2 is Bob's but soft-deleted; so add a note on order 4, Bob's.
    await database.db.insert(notesTable).values([{ order_id: 4, body: 'sixth' }]);
    const reply = await execute(
      endpoint(listed, 'index'),
      request({ query: { include: 'order.user', sort: 'id' } }),
      database,
    );
    const users = rowsOf(reply.body).map((note) => {
      const order = orderOf(note);
      return [note.id, order?.id ?? null, idOf(order?.user)];
    });
    expect(users).toEqual([
      [1, 1, 1],
      [2, null, null],
      [3, 1, 1],
      [4, 1, 1],
      [5, 1, 1],
      [6, 4, null],
    ]);
    const first = orderOf(rowsOf(reply.body)[0]) as { user: object };
    expect(first.user).not.toHaveProperty('password');
  });

  test('a hidden foreign key still nests a path', async () => {
    const hiding = blend(shop.order_notes, {
      policy: allow.public,
      hidden: ['order_id'],
      includes: { order: orders },
      actions: (a) => [a.show()],
    });
    const reply = await execute(
      endpoint(hiding, 'show'),
      request({ params: { id: '1' }, query: { include: 'order.user' }, auth: ada }),
      database,
    );
    expect(reply.body).not.toHaveProperty('order_id');
    expect(reply.body).toMatchObject({ order: { id: 1, user: { id: 1 } } });
  });

  test('an unknown segment answers 422 naming the parameter', async () => {
    for (const include of ['order.customer', 'customer.user', 'order.user.team']) {
      const reply = await execute(
        endpoint(notesWithOrder, 'index'),
        request({ query: { include } }),
        database,
      );
      expect(reply.status).toBe(422);
      expect(reply.body).toMatchObject({ errors: [{ parameter: 'include' }] });
    }
  });

  test('respond receives the record with its nested includes', async () => {
    const shaped = blend(shop.order_notes, {
      policy: allow.public,
      includes: { order: orders },
      actions: (a) => [
        a.show({
          respond: ({ prev, record }) => ({
            ...prev,
            body: { who: record.order?.user?.display_name ?? null },
          }),
        }),
      ],
    });
    const reply = await execute(
      endpoint(shaped, 'show'),
      request({ params: { id: '1' }, query: { include: 'order.user' }, auth: ada }),
      database,
    );
    expect(reply.body).toEqual({ who: 'Ada' });
  });
});
