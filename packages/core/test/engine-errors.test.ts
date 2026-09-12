/**
 * P5.7: constraint violations become Problem Details. The model meta maps each Postgres
 * constraint name to its columns, so the problem points at the offending field. Other
 * database errors are not hidden.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  PROBLEM_CONTENT_TYPE,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { eq } from 'drizzle-orm';
import {
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'));
  await database.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await database.db.insert(ordersTable).values([{ user_id: 1, total: '10.00' }]);
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

const users = blend(shop.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [
    a.store(),
    a.destroy(),
    a.member('rename_long', { calculate: () => ({ display_name: 'x'.repeat(81) }) }),
  ],
});

const orders = blend(shop.orders, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store(),
    a.show(),
    a.member('clear_total', { calculate: () => ({ total: null }) as never }),
  ],
});

describe('constraint violations', () => {
  test('23505: a duplicate unique value answers 409, pointing at the column', async () => {
    const duplicate = await execute(
      endpoint(users, 'store'),
      request({ body: { email: 'ada@example.com', password: 'x' } }),
      database,
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(duplicate.body).toMatchObject({
      title: 'Conflict',
      errors: [{ pointer: '/email', detail: 'is already taken' }],
    });
  });

  test('23503: a reference to a missing row answers 422, pointing at the foreign key', async () => {
    const orphan = await execute(
      endpoint(orders, 'store'),
      request({ body: { user_id: 999, total: '1.00' } }),
      database,
    );
    expect(orphan.status).toBe(422);
    expect(orphan.body).toMatchObject({
      errors: [{ pointer: '/user_id', detail: 'refers to a record that does not exist' }],
    });
  });

  test('23503 on destroy: a row other rows still reference answers 409 and stays', async () => {
    const referenced = await execute(
      endpoint(users, 'destroy'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(referenced.status).toBe(409);
    expect(referenced.body).toMatchObject({
      detail: 'users is still referenced by other records.',
    });
    expect(await database.db.$count(usersTable, eq(usersTable.id, 1))).toBe(1);
  });

  test('23502: a hook writing null into a NOT NULL column answers 422', async () => {
    const cleared = await execute(
      endpoint(orders, 'clear_total'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(cleared.status).toBe(422);
    expect(cleared.body).toMatchObject({ errors: [{ pointer: '/total', detail: 'is required' }] });
  });

  test('22001: a hook writing past varchar(n) answers 422', async () => {
    const tooLong = await execute(
      endpoint(users, 'rename_long'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(tooLong.status).toBe(422);
    expect(tooLong.body).toMatchObject({ detail: 'A value is too long for its column.' });
  });
});

describe('invalid values', () => {
  test('an id that cannot be a primary key names no record: 404', async () => {
    const shown = await execute(
      endpoint(orders, 'show'),
      request({ params: { id: 'abc' } }),
      database,
    );
    expect(shown.status).toBe(404);
  });

  test('22P02 elsewhere, like a filter value outside an enum, answers 422', async () => {
    const listed = await execute(
      endpoint(orders, 'index'),
      request({ query: { status: 'shipped' } }),
      database,
    );
    expect(listed.status).toBe(422);
    expect(listed.body).toMatchObject({ detail: 'A value is not valid for its column.' });
  });
});
