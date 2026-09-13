/**
 * N.1a, N.8: client.gen.ts, every table's actions by name, each as its method and path, and
 * what the table includes (D25). The golden comes from the same shop blends as
 * golden/routes.gen.ts, and test/types/client.types.test.ts checks that its entries are
 * exactly that AppType's routes.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { allow, blend } from '@blendx/core';
import { models as kitchen } from '../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';
import { emitClient } from '../src/emit-client.ts';
import orderNotes from './fixtures/shop/blends/order_notes.ts';
import orders from './fixtures/shop/blends/orders.ts';
import users from './fixtures/shop/blends/users.ts';
import { expectGolden } from './support/golden.ts';

const golden = join(import.meta.dir, 'golden', 'client.gen.ts');

describe('emitClient', () => {
  test('shop fixture', async () => {
    // Not in table order, to show the emitter sorts.
    await expectGolden(golden, emitClient([users, orders, orderNotes]));
  });

  test('each table: its actions with their routes, in the order of routes.gen.ts, its includes and its key', async () => {
    const { tables } = await import('./golden/client.gen.ts');
    expect(tables).toEqual({
      order_notes: {
        actions: {
          index: 'GET /order_notes',
          store: 'POST /order_notes',
          show: 'GET /order_notes/:id',
        },
        includes: {},
        key: [{ column: 'id', type: 'number' }],
      },
      orders: {
        actions: {
          index: 'GET /orders',
          store: 'POST /orders',
          quote: 'GET /orders/quote',
          show: 'GET /orders/:id',
          update: 'PATCH /orders/:id',
          destroy: 'DELETE /orders/:id',
          restore: 'POST /orders/:id/restore',
          refund: 'POST /orders/:id/refund',
        },
        // The table each include points to, not the relation's column (N.8); a has-many
        // include the same way (D31), so a write to its table invalidates the queries that ask for it.
        includes: { notes: 'order_notes', user: 'users' },
        // The primary key, and whether JSON carries it as a number or a string (D30).
        key: [{ column: 'id', type: 'number' }],
      },
      users: {
        actions: { store: 'POST /users', show: 'GET /users/:id', update: 'PATCH /users/:id' },
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
    expect(emitClient([renamed])).toContain('"estimate": "GET /orders/quote",');
  });

  test('a composite key lists every column in the key order (D33)', () => {
    const items = blend(kitchen.order_items, { policy: allow.public, actions: (a) => [a.show()] });
    expect(emitClient([items])).toContain(
      '"key": [{ "column": "order_id", "type": "number" }, { "column": "line", "type": "number" }],',
    );
  });

  test('no blends: an empty map', () => {
    expect(emitClient([])).toContain('export const tables = {} as const;');
  });
});
