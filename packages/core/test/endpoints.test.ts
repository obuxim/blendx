import { describe, expect, test } from 'bun:test';
import { allow, blend, type EndpointDefinition, toEndpoints } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const summary = (endpoints: EndpointDefinition[]) =>
  endpoints.map((e) => `${e.method.toUpperCase()} ${e.path} ${e.id}`);

describe('toEndpoints', () => {
  test('built-in actions come out in a fixed order, whatever order they were listed in', () => {
    const listed = blend(addition.addition_results, {
      policy: allow.public,
      actions: (a) => [a.purge(), a.restore(), a.destroy(), a.store(), a.show(), a.index()],
    });
    expect(summary(toEndpoints(listed))).toEqual([
      'GET /addition_results addition_results.index',
      'POST /addition_results addition_results.store',
      'GET /addition_results/:id addition_results.show',
      'DELETE /addition_results/:id addition_results.destroy',
      'POST /addition_results/:id/restore addition_results.restore',
      'DELETE /addition_results/:id/purge addition_results.purge',
    ]);
  });

  test('custom collection routes come before /:id; custom actions sort by name', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('refund'),
        a.show(),
        a.collection('quote', { method: 'get' }),
        a.index(),
        a.member('archive'),
        a.collection('export', { method: 'get' }),
        a.update(),
      ],
    });
    expect(summary(toEndpoints(orders))).toEqual([
      'GET /orders orders.index',
      'GET /orders/export orders.export',
      'GET /orders/quote orders.quote',
      'GET /orders/:id orders.show',
      'PATCH /orders/:id orders.update',
      'POST /orders/:id/archive orders.archive',
      'POST /orders/:id/refund orders.refund',
    ]);
  });

  test('each endpoint carries its model, resolved policy, hidden columns and hooks', () => {
    const users = blend(shop.users, {
      policy: { default: allow.authenticated, store: allow.public },
      hidden: ['password'],
      actions: (a) => [a.show(), a.store({ rules: () => z.object({ email: z.string() }) })],
    });
    const [store, show] = toEndpoints(users);
    expect(store).toMatchObject({
      resource: 'users',
      action: 'store',
      on: 'collection',
      builtin: true,
      hidden: ['password'],
    });
    expect(store?.model).toBe(shop.users);
    expect(store?.policy.kind).toBe('public');
    expect(show?.policy.kind).toBe('authenticated');
    expect(store?.hooks.rules).toBeFunction();
    expect(show?.hooks).toEqual({});
    expect(Object.isFrozen(store)).toBe(true);
  });
});
