/**
 * P5.6: a mutation's load, authorize, calculate and save run in one transaction, with its
 * member row locked FOR UPDATE; respond runs after the commit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  HttpProblem,
  problem,
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

const log: string[] = [];
let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'), { log });
  await database.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await database.db.insert(ordersTable).values([{ user_id: 1, total: '10.00' }]);
}, 60_000);
afterAll(() => database.close());
beforeEach(() => {
  log.length = 0;
});

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

const firstOrder = async () => {
  const [row] = await database.db.select().from(ordersTable).where(eq(ordersTable.id, 1));
  return row;
};

describe('transactions', () => {
  test('a failing save rolls back what the action had already written', async () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.store({
          save: async ({ runDefault }) => {
            await runDefault();
            throw new Error('payment declined');
          },
        }),
      ],
    });
    const before = await database.db.$count(ordersTable);
    await expect(
      execute(
        endpoint(orders, 'store'),
        request({ body: { user_id: 1, total: '5.00' } }),
        database,
      ),
    ).rejects.toThrow('payment declined');
    expect(await database.db.$count(ordersTable)).toBe(before);
  });

  test('a problem raised during save rolls back and answers with that problem', async () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('ship', {
          save: async ({ tx, runDefault }) => {
            await tx.insert(notesTable).values({ order_id: 1, body: 'shipping' });
            await runDefault({ status: 'paid' });
            throw new HttpProblem(problem(409, { detail: 'carrier unavailable' }));
          },
        }),
      ],
    });
    const answered = await execute(
      endpoint(orders, 'ship'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(answered.status).toBe(409);
    expect(answered.body).toMatchObject({ detail: 'carrier unavailable' });
    expect(await database.db.$count(notesTable)).toBe(0);
    expect((await firstOrder())?.status).toBe('pending');
  });

  test('member mutations load their row FOR UPDATE; reads take no lock', async () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.update(), a.show()],
    });
    await execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 2 } }),
      database,
    );
    expect(log.some((query) => query.startsWith('select') && query.endsWith('for update'))).toBe(
      true,
    );

    log.length = 0;
    await execute(endpoint(orders, 'show'), request({ params: { id: '1' } }), database);
    expect(log.some((query) => query.includes('for update'))).toBe(false);
  });

  test('a load hook is told to lock, and runs inside the transaction', async () => {
    const seen: boolean[] = [];
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          load: async ({ runDefault, lock }) => {
            seen.push(lock);
            return runDefault();
          },
        }),
      ],
    });
    await execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 3 } }),
      database,
    );
    expect(seen).toEqual([true]);
  });

  test('respond runs after the commit: a failing respond leaves the saved row', async () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          respond: () => {
            throw new Error('mailer down');
          },
        }),
      ],
    });
    await expect(
      execute(
        endpoint(orders, 'update'),
        request({ params: { id: '1' }, body: { quantity: 7 } }),
        database,
      ),
    ).rejects.toThrow('mailer down');
    expect((await firstOrder())?.quantity).toBe(7);
  });
});
