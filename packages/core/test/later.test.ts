/**
 * P16.3 (D27): later hooks write outbox entries. An action that writes gets one entry per
 * level with a later hook, holding the hook's context as JSON, in the action's transaction:
 * a write that fails leaves none, and a context JSON cannot hold fails the write. The hooks
 * themselves run later, from the worker (P16.4).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type App,
  allow,
  BlendxDefinitionError,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  HttpProblem,
  outbox,
  problem,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { asc, eq } from 'drizzle-orm';
import {
  orders as ordersTable,
  models as shop,
  users as usersTable,
} from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(join(import.meta.dir, 'support', 'outbox-shop.schema.ts'));
  await database.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
  await database.db.insert(ordersTable).values([{ user_id: 1, total: '10.00' }]);
}, 60_000);
afterAll(() => database.close());
beforeEach(async () => {
  await database.db.delete(outbox);
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

const entries = () => database.db.select().from(outbox).orderBy(asc(outbox.id));

describe('later (D27)', () => {
  test("a write leaves one outbox entry per level, with the hook's context as JSON", async () => {
    const ran: string[] = [];
    const app = defineApp({ hooks: { later: () => ran.push('app') } });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: { later: () => ran.push('resource') },
      actions: (a) => [a.update({ later: () => ran.push('action') })],
    });
    const reply = await execute(
      endpoint(orders, 'update', app),
      request({ params: { id: '1' }, body: { quantity: 4 }, auth: { id: 1 } }),
      database,
    );
    expect(reply.status).toBe(200);
    // Nothing ran in the request: the worker runs the entries.
    expect(ran).toEqual([]);
    const written = await entries();
    expect(written.map((entry) => entry.level)).toEqual(['app', 'resource', 'action']);
    for (const entry of written) {
      expect(entry).toMatchObject({
        resource: 'orders',
        action: 'update',
        attempts: 0,
        failed_at: null,
        last_error: null,
        payload: {
          saved: { id: 1, quantity: 4 },
          record: { id: 1, quantity: 1 },
          input: { quantity: 4 },
          auth: { id: 1 },
        },
      });
    }
  });

  test('store: the entry has no loaded row', async () => {
    const users = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [a.store({ later: () => {} })],
    });
    await execute(
      endpoint(users, 'store'),
      request({ body: { email: 'bob@example.com', password: 'hunter2' } }),
      database,
    );
    const [entry] = await entries();
    expect(entry?.payload).toEqual({
      saved: expect.objectContaining({ email: 'bob@example.com', password: 'hunter2' }),
      input: { email: 'bob@example.com', password: 'hunter2' },
      auth: null,
    });
  });

  test('purge: the entry holds the deleted row as saved (D29)', async () => {
    const [row] = await database.db
      .insert(ordersTable)
      .values({ user_id: 1, total: '3.00' })
      .returning();
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.purge({ later: () => {} })],
    });
    const reply = await execute(
      endpoint(orders, 'purge'),
      request({ params: { id: String(row?.id) } }),
      database,
    );
    expect(reply.status).toBe(204);
    const [entry] = await entries();
    expect(entry).toMatchObject({
      action: 'purge',
      payload: { saved: { id: row?.id, total: '3.00' }, record: { id: row?.id } },
    });
    expect(await database.db.$count(ordersTable, eq(ordersTable.id, row?.id ?? 0))).toBe(0);
  });

  test('a write that fails leaves no entry', async () => {
    const later = () => {};
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({ authorize: () => false, later }),
        a.member('ship', {
          save: async () => {
            throw new HttpProblem(problem(409, { detail: 'carrier unavailable' }));
          },
          later,
        }),
      ],
    });
    const statuses = [
      await execute(
        endpoint(orders, 'update'),
        request({ params: { id: '1' }, body: { quantity: 2 } }),
        database,
      ),
      await execute(endpoint(orders, 'ship'), request({ params: { id: '1' } }), database),
    ].map((reply) => reply.status);
    expect(statuses).toEqual([403, 409]);
    expect(await entries()).toEqual([]);
  });

  test('the entry is written in the transaction: without the outbox table, the write rolls back', async () => {
    // An app whose migrations lack the table, as before its first later hook was migrated.
    const plain = await migratedDatabase(goldenSchema('shop'));
    try {
      await plain.db.insert(usersTable).values([{ email: 'ada@example.com', password: 'a' }]);
      await plain.db.insert(ordersTable).values([{ user_id: 1, total: '10.00' }]);
      const orders = blend(shop.orders, {
        policy: allow.public,
        actions: (a) => [a.update({ later: () => {} })],
      });
      await expect(
        execute(
          endpoint(orders, 'update'),
          request({ params: { id: '1' }, body: { quantity: 9 } }),
          plain,
        ),
      ).rejects.toThrow('blendx_outbox');
      const [order] = await plain.db.select().from(ordersTable).where(eq(ordersTable.id, 1));
      expect(order?.quantity).toBe(1);
    } finally {
      await plain.close();
    }
  }, 60_000);

  test('reads write no entry, even with app and resource later hooks', async () => {
    const app = defineApp({ hooks: { later: () => {} } });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: { later: () => {} },
      actions: (a) => [
        a.index(),
        a.show(),
        a.collection('quote', { method: 'get', calculate: () => ({ total: 1 }) }),
      ],
    });
    await execute(endpoint(orders, 'index', app), request(), database);
    await execute(endpoint(orders, 'show', app), request({ params: { id: '1' } }), database);
    await execute(endpoint(orders, 'quote', app), request(), database);
    expect(await entries()).toEqual([]);
  });

  test('provenance: later counts app and resource hooks only on actions that write', () => {
    const app = defineApp({ hooks: { later: () => {} } });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: { later: () => {} },
      actions: (a) => [a.show(), a.update({ later: () => {} })],
    });
    expect(endpoint(orders, 'update', app).provenance.later).toEqual([
      'schema',
      'app',
      'resource',
      'action',
    ]);
    expect(endpoint(orders, 'show', app).provenance.later).toEqual(['schema']);
  });

  test('blend() refuses later on an action that writes nothing', () => {
    // The types refuse it too (later.types.test.ts); this is for JavaScript and casts.
    const hook = { later: () => {} } as never;
    const show = () => blend(shop.orders, { policy: allow.public, actions: (a) => [a.show(hook)] });
    expect(show).toThrow(BlendxDefinitionError);
    expect(show).toThrow('show writes nothing, so it has no later');
  });
});
