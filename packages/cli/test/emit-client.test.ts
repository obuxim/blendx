/**
 * N.1a, N.8: client.gen.ts, every table's actions by name, each as its method and path, and
 * what the table includes (D25). The golden comes from the same shop blends as
 * golden/routes.gen.ts, and test/types/client.types.test.ts checks that its entries are
 * exactly that AppType's routes.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { allow, blend, defineApp } from '@blendx/core';
import { z } from 'blendx';
import { models as kitchen } from '../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';
import { emitClient } from '../src/emit-client.ts';
import orderNotes from './fixtures/shop/blends/order_notes.ts';
import orders from './fixtures/shop/blends/orders.ts';
import users from './fixtures/shop/blends/users.ts';
import { expectGolden } from './support/golden.ts';

const golden = join(import.meta.dir, 'golden', 'client.gen.ts');
const app = defineApp({});

describe('emitClient', () => {
  test('shop fixture', async () => {
    // Not in table order, to show the emitter sorts.
    await expectGolden(golden, emitClient([users, orders, orderNotes], app));
  });

  test('each table: its actions with routes and declared writes, in the order of routes.gen.ts, its includes and its key', async () => {
    const { tables } = await import('./golden/client.gen.ts');
    expect(tables).toEqual({
      order_notes: {
        actions: {
          index: {
            route: 'GET /order_notes',
            writes: [],
            sorts: ['id', 'order_id', '-id', '-order_id'],
          },
          store: { route: 'POST /order_notes', writes: [] },
          show: { route: 'GET /order_notes/:id', writes: [] },
        },
        includes: {},
        key: [{ column: 'id', type: 'number' }],
      },
      orders: {
        actions: {
          index: {
            route: 'GET /orders',
            writes: [],
            sorts: [
              'id',
              'user_id',
              'status',
              'public_id',
              'created_at',
              '-id',
              '-user_id',
              '-status',
              '-public_id',
              '-created_at',
            ],
          },
          store: { route: 'POST /orders', writes: [] },
          quote: { route: 'GET /orders/quote', writes: [] },
          show: { route: 'GET /orders/:id', writes: [] },
          update: { route: 'PATCH /orders/:id', writes: [] },
          destroy: { route: 'DELETE /orders/:id', writes: [] },
          restore: { route: 'POST /orders/:id/restore', writes: [] },
          refund: { route: 'POST /orders/:id/refund', writes: ['users'] },
        },
        // The table each include points to, not the relation's column (N.8); a has-many
        // include the same way (D31), so a write to its table invalidates the queries that ask for it.
        includes: { notes: 'order_notes', user: 'users' },
        // The primary key, and whether JSON carries it as a number or a string (D30).
        key: [{ column: 'id', type: 'number' }],
      },
      users: {
        actions: {
          store: { route: 'POST /users', writes: [] },
          show: { route: 'GET /users/:id', writes: [] },
          update: { route: 'PATCH /users/:id', writes: [] },
        },
        includes: {},
        key: [{ column: 'id', type: 'number' }],
      },
    });
    // toEqual ignores key order.
    expect(Object.keys(tables)).toEqual(['order_notes', 'orders', 'users']);
    expect(Object.keys(tables.orders.actions)).toEqual([
      ...['index', 'store', 'quote', 'show', 'update', 'destroy', 'restore', 'refund'],
    ]);
  });

  test('imports nothing, so a web app can load it without the server', async () => {
    expect(await Bun.file(golden).text()).not.toContain('import');
  });

  test('keyed by action name, not by path', () => {
    const renamed = blend(models.orders, {
      policy: allow.public,
      actions: (a) => [a.collection('estimate', { method: 'get', path: 'quote' })],
    });
    expect(emitClient([renamed], app)).toContain('"route": "GET /orders/quote",');
  });

  test('includes app-owned action descriptors outside table metadata (D37)', () => {
    const actions = defineApp({
      actions: (a) => [
        a.action('accept_invite', {
          method: 'post',
          path: '/invites/:token/accept',
          policy: allow.public,
          input: z.object({}),
          reply: { status: 200, body: z.object({ accepted: z.literal(true) }) },
          writes: [models.users],
          handler: () => ({ status: 200, body: { accepted: true as const } }),
        }),
      ],
    });
    expect(emitClient([], actions)).toContain(
      'export const appActions = {\n  "accept_invite": {\n    "route": "POST /invites/:token/accept",\n    "writes": ["users"],',
    );
  });

  test('a composite key lists every column in the key order (D33)', () => {
    const items = blend(kitchen.order_items, { policy: allow.public, actions: (a) => [a.show()] });
    expect(emitClient([items], app)).toContain(
      '"key": [{ "column": "order_id", "type": "number" }, { "column": "line", "type": "number" }],',
    );
  });

  test('an index with app, resource, or action rules has no default sort metadata', () => {
    const action = blend(models.orders, {
      policy: allow.public,
      actions: (a) => [a.index({ rules: ({ prev }) => prev })],
    });
    const resource = blend(models.orders, {
      policy: allow.public,
      hooks: { rules: ({ prev }) => prev },
      actions: (a) => [a.index()],
    });
    const appRules = defineApp({ hooks: { rules: ({ prev }) => prev } });

    expect(emitClient([action], app)).not.toContain('"sorts"');
    expect(emitClient([resource], app)).not.toContain('"sorts"');
    expect(emitClient([orders], appRules)).not.toContain('"sorts"');
  });

  test('no blends: an empty map', () => {
    expect(emitClient([], app)).toContain('export const tables = {} as const;');
  });
});
