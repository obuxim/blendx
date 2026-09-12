/**
 * P5.8: custom action defaults. Member actions load their record (404 when it is missing),
 * start from empty strict rules, save what calculate returns (by default the input's
 * writable columns) and reply 200 with the record. Collection actions load and save
 * nothing and reply 200 with calculate's result; GET ones validate the query.
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

const orders = blend(shop.orders, {
  policy: allow.public,
  actions: (a) => [
    a.member('touch'),
    a.member('set_quantity', { rules: () => z.object({ quantity: z.number().int() }) }),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string().regex(/^\d+$/) }),
      calculate: ({ input }) => ({ total: (Number(input.quantity) * 2.5).toFixed(2) }),
    }),
    a.collection('preview', {
      rules: () => z.object({ quantity: z.number() }),
      calculate: ({ input }) => ({ quantity: input.quantity, status: 'pending' }),
    }),
  ],
});

describe('custom member actions', () => {
  test('with no spec: load the record, accept only an empty body, reply with the record', async () => {
    const touched = await execute(
      endpoint(orders, 'touch'),
      request({ params: { id: '1' }, body: {} }),
      database,
    );
    expect(touched.status).toBe(200);
    expect(touched.body).toMatchObject({ id: 1, total: '10.00' });

    const extra = await execute(
      endpoint(orders, 'touch'),
      request({ params: { id: '1' }, body: { note: 'x' } }),
      database,
    );
    expect(extra.status).toBe(422);
    expect(extra.body).toMatchObject({ errors: [{ pointer: '/note' }] });

    const missing = await execute(
      endpoint(orders, 'touch'),
      request({ params: { id: '99' } }),
      database,
    );
    expect(missing.status).toBe(404);
  });

  test("without calculate, the input's writable columns are saved", async () => {
    const set = await execute(
      endpoint(orders, 'set_quantity'),
      request({ params: { id: '1' }, body: { quantity: 4 } }),
      database,
    );
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ id: 1, quantity: 4 });
    const [row] = await database.db.select().from(ordersTable).where(eq(ordersTable.id, 1));
    expect(row?.quantity).toBe(4);
  });
});

describe('custom collection actions', () => {
  test("GET validates the query and replies 200 with calculate's result", async () => {
    const quoted = await execute(
      endpoint(orders, 'quote'),
      request({ query: { quantity: '4' } }),
      database,
    );
    expect(quoted).toEqual({ status: 200, body: { total: '10.00' }, headers: {} });

    const invalid = await execute(
      endpoint(orders, 'quote'),
      request({ query: { quantity: 'x', coupon: 'y' } }),
      database,
    );
    expect(invalid.status).toBe(422);
    const errors = (invalid.body as { errors: { parameter: string }[] }).errors;
    expect(errors.map((error) => error.parameter)).toEqual(['quantity', 'coupon']);
  });

  test('POST validates the body and saves nothing', async () => {
    const before = await database.db.$count(ordersTable);
    const previewed = await execute(
      endpoint(orders, 'preview'),
      request({ body: { quantity: 3 } }),
      database,
    );
    expect(previewed).toEqual({
      status: 200,
      body: { quantity: 3, status: 'pending' },
      headers: {},
    });
    expect(await database.db.$count(ordersTable)).toBe(before);
  });

  test('an owner policy refuses collection actions, which have no record', async () => {
    const owned = blend(shop.orders, {
      policy: allow.owner('user_id'),
      actions: (a) => [a.collection('summary', { method: 'get', calculate: () => ({ count: 1 }) })],
    });
    const refused = await execute(
      endpoint(owned, 'summary'),
      request({ auth: { id: 1 } }),
      database,
    );
    expect(refused.status).toBe(403);
  });
});
