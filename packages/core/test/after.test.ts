/**
 * P16.1 (D26): the after stage. It runs once a write has committed and before respond, at the
 * app, resource and action levels in that order, with the saved row, the row as loaded, the
 * input, the identity and the database. A failure is reported and leaves the reply. Reads
 * and failed writes never run it.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
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
  problem,
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

describe('after (D26)', () => {
  test('after runs once the write has committed, with the saved row, the loaded row and the input', async () => {
    const seen: unknown[] = [];
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          after: async ({ saved, record, input, db }) => {
            const [stored] = await db
              .select()
              .from(ordersTable)
              .where(eq(ordersTable.id, saved.id));
            seen.push({
              before: record.quantity,
              after: saved.quantity,
              input,
              stored: stored?.quantity,
            });
          },
        }),
      ],
    });
    const reply = await execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 4 } }),
      database,
    );
    expect(reply.status).toBe(200);
    expect(seen).toEqual([{ before: 1, after: 4, input: { quantity: 4 }, stored: 4 }]);
  });

  test('store has no loaded row, and the saved row keeps its hidden columns', async () => {
    const seen: unknown[] = [];
    const users = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [
        a.store({
          after: ({ saved, record }) => {
            seen.push({ record, password: saved.password });
          },
        }),
      ],
    });
    const reply = await execute(
      endpoint(users, 'store'),
      request({ body: { email: 'bob@example.com', password: 'hunter2' } }),
      database,
    );
    expect(reply.status).toBe(201);
    expect(reply.body).not.toHaveProperty('password');
    expect(seen).toEqual([{ record: undefined, password: 'hunter2' }]);
  });

  test('destroy: saved is the soft-deleted row, record the row before', async () => {
    const [row] = await database.db
      .insert(ordersTable)
      .values({ user_id: 1, total: '1.00' })
      .returning();
    const seen: unknown[] = [];
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.destroy({
          after: ({ saved, record }) => {
            seen.push({ before: record.deleted_at, deleted: saved.deleted_at !== null });
          },
        }),
      ],
    });
    const reply = await execute(
      endpoint(orders, 'destroy'),
      request({ params: { id: String(row?.id) } }),
      database,
    );
    expect(reply.status).toBe(204);
    expect(seen).toEqual([{ before: null, deleted: true }]);
  });

  test('after runs before respond', async () => {
    const order: string[] = [];
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          after: () => {
            order.push('after');
          },
          respond: ({ prev }) => {
            order.push('respond');
            return prev;
          },
        }),
      ],
    });
    await execute(
      endpoint(orders, 'update'),
      request({ params: { id: '1' }, body: { quantity: 2 } }),
      database,
    );
    expect(order).toEqual(['after', 'respond']);
  });

  test('app, resource and action after run in that order, none replacing another', async () => {
    const order: string[] = [];
    const app = defineApp({
      hooks: {
        after: ({ model, action }) => {
          order.push(`app ${model.name}.${action}`);
        },
      },
    });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: {
        after: ({ action }) => {
          order.push(`resource ${action}`);
        },
      },
      actions: (a) => [
        a.update({
          after: () => {
            order.push('action');
          },
        }),
      ],
    });
    await execute(
      endpoint(orders, 'update', app),
      request({ params: { id: '1' }, body: { quantity: 5 } }),
      database,
    );
    expect(order).toEqual(['app orders.update', 'resource update', 'action']);
  });

  test('a failing after is reported, the other levels still run, and the reply stands', async () => {
    const errors: unknown[] = [];
    const ran: string[] = [];
    const app = defineApp({
      hooks: {
        after: () => {
          throw new Error('audit log down');
        },
      },
    });
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          after: () => {
            ran.push('action');
          },
        }),
      ],
    });
    const reply = await execute(
      endpoint(orders, 'update', app),
      request({ params: { id: '1' }, body: { quantity: 6 } }),
      { db: database.db, onError: (error) => errors.push(error) },
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ quantity: 6 });
    expect(ran).toEqual(['action']);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('audit log down');
  });

  test('without onError, a failing after goes to console.error', async () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const orders = blend(shop.orders, {
        policy: allow.public,
        actions: (a) => [
          a.update({
            after: () => {
              throw new Error('mailer down');
            },
          }),
        ],
      });
      const reply = await execute(
        endpoint(orders, 'update'),
        request({ params: { id: '1' }, body: { quantity: 3 } }),
        database,
      );
      expect(reply.status).toBe(200);
      expect(logged).toHaveBeenCalledTimes(1);
      const [first] = logged.mock.calls;
      expect((first?.[0] as Error | undefined)?.message).toBe('mailer down');
    } finally {
      logged.mockRestore();
    }
  });

  test('a write that fails runs no after', async () => {
    const ran: string[] = [];
    const after = () => {
      ran.push('after');
    };
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({ authorize: () => false, after }),
        a.member('ship', {
          save: async () => {
            throw new HttpProblem(problem(409, { detail: 'carrier unavailable' }));
          },
          after,
        }),
      ],
    });
    const update = endpoint(orders, 'update');
    const statuses = [
      await execute(update, request({ params: { id: '1' }, body: { quantity: 'x' } }), database),
      await execute(update, request({ params: { id: '99' }, body: { quantity: 2 } }), database),
      await execute(update, request({ params: { id: '1' }, body: { quantity: 2 } }), database),
      await execute(endpoint(orders, 'ship'), request({ params: { id: '1' } }), database),
    ].map((reply) => reply.status);
    expect(statuses).toEqual([422, 404, 403, 409]);
    expect(ran).toEqual([]);
  });

  test('reads never run after: index, show and collection actions skip app and resource hooks', async () => {
    const ran: string[] = [];
    const app = defineApp({
      hooks: {
        after: ({ action }) => {
          ran.push(`app ${action}`);
        },
      },
    });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: {
        after: ({ action }) => {
          ran.push(`resource ${action}`);
        },
      },
      actions: (a) => [
        a.index(),
        a.show(),
        a.collection('quote', { method: 'get', calculate: () => ({ total: 1 }) }),
      ],
    });
    await execute(endpoint(orders, 'index', app), request(), database);
    await execute(endpoint(orders, 'show', app), request({ params: { id: '1' } }), database);
    await execute(endpoint(orders, 'quote', app), request(), database);
    expect(ran).toEqual([]);
  });

  test('provenance: after counts app and resource hooks only on actions that write', () => {
    const app = defineApp({ hooks: { after: () => {} } });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: { after: () => {} },
      actions: (a) => [a.show(), a.update({ after: () => {} })],
    });
    expect(endpoint(orders, 'update', app).provenance.after).toEqual([
      'schema',
      'app',
      'resource',
      'action',
    ]);
    expect(endpoint(orders, 'show', app).provenance.after).toEqual(['schema']);
  });

  test('blend() refuses after on an action that writes nothing', () => {
    // The types refuse it too (after.types.test.ts); this is for JavaScript and casts.
    const hook = { after: () => {} } as never;
    const show = () => blend(shop.orders, { policy: allow.public, actions: (a) => [a.show(hook)] });
    const index = () =>
      blend(shop.orders, { policy: allow.public, actions: (a) => [a.index(hook)] });
    expect(show).toThrow(BlendxDefinitionError);
    expect(show).toThrow('show writes nothing, so it has no after');
    expect(index).toThrow('index writes nothing, so it has no after');
  });
});
