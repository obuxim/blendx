/**
 * N.1a: client.gen.ts, every action's method and path by table and action name (D25). The
 * golden comes from the same shop blends as golden/routes.gen.ts, and
 * test/types/client.types.test.ts checks that its entries are exactly that AppType's routes.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { allow, blend } from '@blendx/core';
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

  test('each action by table and name, with its route, in the order of routes.gen.ts', async () => {
    const { endpoints } = await import('./golden/client.gen.ts');
    expect(endpoints).toEqual({
      order_notes: { index: 'GET /order_notes', store: 'POST /order_notes' },
      orders: {
        index: 'GET /orders',
        store: 'POST /orders',
        quote: 'GET /orders/quote',
        show: 'GET /orders/:id',
        update: 'PATCH /orders/:id',
        destroy: 'DELETE /orders/:id',
        restore: 'POST /orders/:id/restore',
        refund: 'POST /orders/:id/refund',
      },
      users: { store: 'POST /users', show: 'GET /users/:id', update: 'PATCH /users/:id' },
    });
    // toEqual ignores key order.
    expect(Object.keys(endpoints)).toEqual(['order_notes', 'orders', 'users']);
    expect(Object.keys(endpoints.orders)).toEqual([
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

  test('no blends: an empty map', () => {
    expect(emitClient([])).toContain('export const endpoints = {} as const;');
  });
});
