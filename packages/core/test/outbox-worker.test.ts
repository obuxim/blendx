/**
 * P16.4 (D27): the outbox worker. drainOutbox runs every due entry: its level's later hook gets
 * the stored context, the database, the entry's id and the attempt. An entry that succeeds is
 * deleted; one that fails runs again after a delay, and is kept as failed after the last
 * attempt. A claimed entry is held for a lease. startOutbox drains on an interval.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type App,
  allow,
  blend,
  type Db,
  defaultEffects,
  defineApp,
  drainOutbox,
  execute,
  outbox,
  type Resource,
  resolveEndpoint,
  startOutbox,
  toEndpoints,
} from '@blendx/core';
import { asc, eq, sql } from 'drizzle-orm';
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

type Context = Record<string, unknown>;

/** An app and an orders resource whose update has the given app and action later hooks. */
function laterApp(hooks: {
  app?: (context: Context) => unknown;
  action?: (context: Context) => unknown;
}) {
  const app = defineApp(
    hooks.app ? { hooks: { later: (context) => hooks.app?.(context as unknown as Context) } } : {},
  );
  const orders = blend(shop.orders, {
    policy: allow.public,
    actions: (a) => [
      a.update(
        hooks.action ? { later: (context) => hooks.action?.(context as unknown as Context) } : {},
      ),
    ],
  });
  return { app, orders };
}

/** PATCH /orders/1 as user 1, which writes the update's outbox entries. */
async function update(app: App, orders: Resource, quantity: number) {
  const found = toEndpoints(orders).find((e) => e.action === 'update');
  if (!found) throw new Error('no update');
  const endpoint = resolveEndpoint(found, { app, defaults: defaultEffects(found) });
  const reply = await execute(
    endpoint,
    { params: { id: '1' }, query: {}, body: { quantity }, auth: { id: 1 } },
    database,
  );
  expect(reply.status).toBe(200);
}

const entries = () => database.db.select().from(outbox).orderBy(asc(outbox.id));
const none = { ran: 0, retried: 0, failed: 0 };

describe('drainOutbox (D27)', () => {
  test("each level's entry runs with its stored context, the database, its id and attempt 1, then is deleted", async () => {
    const seen: Context[] = [];
    const { app, orders } = laterApp({
      app: (context) => seen.push({ level: 'app', ...context }),
      action: (context) => seen.push({ level: 'action', ...context }),
    });
    await update(app, orders, 4);
    const ids = (await entries()).map((entry) => entry.id);

    const result = await drainOutbox({ app, db: database.db, resources: [orders] });
    expect(result).toEqual({ ran: 2, retried: 0, failed: 0 });
    expect(seen.map((context) => context.level)).toEqual(['app', 'action']);
    expect(seen.map((context) => context.id)).toEqual(ids);
    for (const context of seen) {
      expect(context).toMatchObject({
        saved: { id: 1, quantity: 4 },
        record: { id: 1 },
        input: { quantity: 4 },
        auth: { id: 1 },
        attempt: 1,
      });
      expect(context.db).toBe(database.db);
    }
    expect(seen[0]).toMatchObject({ action: 'update' });
    expect(seen[0]?.model).toBe(shop.orders);
    expect(await entries()).toEqual([]);
  });

  test('claiming an entry starts an attempt and holds it for the lease', async () => {
    const held: unknown[] = [];
    const { app, orders } = laterApp({
      action: async (context) => {
        const db = context.db as Db;
        const [row] = await db
          .select({
            attempts: outbox.attempts,
            held: sql<boolean>`${outbox.run_at} > now() + interval '4 minutes'`,
          })
          .from(outbox)
          .where(eq(outbox.id, context.id as number));
        held.push(row);
      },
    });
    await update(app, orders, 5);
    await drainOutbox({ app, db: database.db, resources: [orders] });
    expect(held).toEqual([{ attempts: 1, held: true }]);
  });

  test('a failing entry is reported, keeps its last error, and runs again once its delay has passed', async () => {
    const errors: unknown[] = [];
    const attempts: unknown[] = [];
    const { app, orders } = laterApp({
      action: (context) => {
        attempts.push(context.attempt);
        if (context.attempt === 1) throw new Error('webhook down');
      },
    });
    await update(app, orders, 6);
    const options = {
      app,
      db: database.db,
      resources: [orders],
      onError: (error: unknown) => errors.push(error),
    };

    expect(await drainOutbox(options)).toEqual({ ran: 0, retried: 1, failed: 0 });
    const [entry] = await entries();
    expect(entry).toMatchObject({ attempts: 1, last_error: 'webhook down', failed_at: null });
    expect((errors[0] as Error).message).toBe('webhook down');

    // Not due yet: the first retry waits two seconds.
    expect(await drainOutbox(options)).toEqual(none);
    await database.db.update(outbox).set({ run_at: sql`now()` });
    expect(await drainOutbox(options)).toEqual({ ran: 1, retried: 0, failed: 0 });
    expect(attempts).toEqual([1, 2]);
    expect(await entries()).toEqual([]);
  });

  test('after the last attempt, the entry is kept as failed and no longer run', async () => {
    const { app, orders } = laterApp({
      action: () => {
        throw new Error('gone for good');
      },
    });
    await update(app, orders, 7);
    const options = {
      app,
      db: database.db,
      resources: [orders],
      onError: () => {},
      attempts: 2,
      retryDelay: () => 0,
    };
    expect(await drainOutbox(options)).toEqual({ ran: 0, retried: 1, failed: 1 });
    const [entry] = await entries();
    expect(entry).toMatchObject({ attempts: 2, last_error: 'gone for good' });
    expect(entry?.failed_at).not.toBeNull();
    expect(await drainOutbox(options)).toEqual(none);
  });

  test('an entry a stopped worker held runs again once its lease ends', async () => {
    const attempts: unknown[] = [];
    const { app, orders } = laterApp({ action: (context) => attempts.push(context.attempt) });
    await update(app, orders, 8);
    // What a worker that claimed the entry and then stopped leaves behind.
    await database.db
      .update(outbox)
      .set({ attempts: 1, run_at: sql`now() + interval '5 minutes'` });
    const options = { app, db: database.db, resources: [orders] };

    expect(await drainOutbox(options)).toEqual(none);
    await database.db.update(outbox).set({ run_at: sql`now() - interval '1 second'` });
    expect(await drainOutbox(options)).toEqual({ ran: 1, retried: 0, failed: 0 });
    expect(attempts).toEqual([2]);
  });

  test('an entry whose hook is gone is kept as failed at once, and reported', async () => {
    const errors: unknown[] = [];
    const { app, orders } = laterApp({ action: () => {} });
    await database.db.insert(outbox).values({
      resource: 'orders',
      action: 'update',
      level: 'resource',
      payload: { saved: {}, input: {}, auth: null },
    });
    const result = await drainOutbox({
      app,
      db: database.db,
      resources: [orders],
      onError: (error) => errors.push(error),
    });
    expect(result).toEqual({ ran: 0, retried: 0, failed: 1 });
    const message = 'orders.update has no later hook at the resource level';
    const [entry] = await entries();
    expect(entry).toMatchObject({ attempts: 1, last_error: message });
    expect(entry?.failed_at).not.toBeNull();
    expect((errors[0] as Error).message).toBe(message);
  });

  test('without later hooks, the worker does nothing, and never touches the table', async () => {
    // A database without the outbox table: any query of it would fail.
    const plain = await migratedDatabase(goldenSchema('shop'));
    try {
      const app = defineApp({});
      const orders = blend(shop.orders, { policy: allow.public, actions: (a) => [a.update()] });
      const options = {
        app,
        db: plain.db,
        resources: [orders],
        onError: (error: unknown) => {
          throw error;
        },
      };
      expect(await drainOutbox(options)).toEqual(none);
      await startOutbox(options).stop();
    } finally {
      await plain.close();
    }
  }, 60_000);
});

describe('startOutbox (D27)', () => {
  test('it drains on an interval until it is stopped', async () => {
    const seen: unknown[] = [];
    const { app, orders } = laterApp({ action: (context) => seen.push(context.id) });
    await update(app, orders, 9);
    const worker = startOutbox({ app, db: database.db, resources: [orders], every: 0.01 });
    try {
      for (let wait = 0; wait < 200 && seen.length === 0; wait += 1) await Bun.sleep(5);
      expect(seen).toHaveLength(1);
    } finally {
      await worker.stop();
    }
    await update(app, orders, 10);
    await Bun.sleep(50);
    expect(seen).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
  });
});
