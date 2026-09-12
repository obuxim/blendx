/**
 * P5.6 on real PostgreSQL: while one request holds its row lock, another writer cannot
 * take it. Runs only with BLENDX_TEST_DB=pg and DATABASE_URL (a scratch database); PGlite
 * has a single connection, so the lock cannot be contended there.
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
import type { Pool } from 'pg';
import {
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

let database: (TestDatabase & { pool: Pool }) | undefined;

beforeAll(async () => {
  if (!realPostgres) return;
  database = await postgresDatabase(goldenSchema('shop'));
  await database.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await database.db.insert(ordersTable).values([{ user_id: 1, total: '10.00' }]);
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

describe.skipIf(!realPostgres)('row locks on real PostgreSQL', () => {
  test('a concurrent writer cannot lock the row while an update holds it', async () => {
    if (!database) throw new Error('no database');
    const { pool } = database;

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = () => {};
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });

    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          save: async ({ runDefault }) => {
            holding();
            await gate;
            return runDefault();
          },
        }),
      ],
    });

    const first = execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 5 } }),
      database,
    );
    await held;

    const other = await pool.connect();
    try {
      const error = await other.query('select id from orders where id = 1 for update nowait').then(
        () => undefined,
        (e: unknown) => e,
      );
      expect((error as { code?: string } | undefined)?.code).toBe('55P03');
    } finally {
      other.release();
    }

    release();
    expect((await first).status).toBe(200);
    const after = await pool.query('select quantity from orders where id = 1');
    expect(after.rows[0]?.quantity).toBe(5);
  });
});
