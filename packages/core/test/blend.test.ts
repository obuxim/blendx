import { describe, expect, expectTypeOf, test } from 'bun:test';
import { allow, BlendxDefinitionError, blend, type Row } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const additionExample = () =>
  blend(addition.addition_results, {
    policy: allow.public,
    actions: (a) => [
      a.index(),
      a.show(),
      a.store({
        rules: () => z.object({ a: z.number(), b: z.number() }),
        calculate: ({ input }) => ({ result: input.a + input.b }),
      }),
      a.destroy(),
      a.restore(),
    ],
  });

const routesOf = (resource: {
  actions: readonly { name: string; method: string; path: string }[];
}) => resource.actions.map(({ name, method, path }) => `${name} ${method.toUpperCase()} ${path}`);

describe('blend()', () => {
  test('the addition example: exposed actions, methods and paths', () => {
    const resource = additionExample();
    expect(resource.kind).toBe('blendx/resource');
    expect(resource.model).toBe(addition.addition_results);
    expect(routesOf(resource)).toEqual([
      'index GET ',
      'show GET /:id',
      'store POST ',
      'destroy DELETE /:id',
      'restore POST /:id/restore',
    ]);
    expect(Object.keys(resource.policies)).toEqual([
      'index',
      'show',
      'store',
      'destroy',
      'restore',
    ]);
    expect(resource.hidden).toEqual([]);
  });

  test('hooks are kept, and calculate is the pure function that was written', () => {
    const [index, , store] = additionExample().actions;
    expect(store?.hooks.rules).toBeFunction();
    expect(
      store?.hooks.calculate?.({ prev: {}, input: { a: 4, b: 3 }, record: undefined }),
    ).toEqual({
      result: 7,
    });
    expect(index?.hooks).toEqual({});
  });

  test('custom member and collection actions with their methods and paths', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('refund', {
          rules: () => z.object({ reason: z.string() }),
          calculate: ({ record }) => ({
            status: record.status === 'paid' ? 'refunded' : record.status,
          }),
        }),
        a.collection('quote', { method: 'get', calculate: () => ({ total: '0.00' }) }),
        a.member('mark_paid', { method: 'patch', path: 'paid' }),
      ],
    });
    expect(routesOf(orders)).toEqual([
      'refund POST /:id/refund',
      'quote GET /quote',
      'mark_paid PATCH /:id/paid',
    ]);
    expect(orders.actions.map((action) => action.on)).toEqual(['member', 'collection', 'member']);
  });

  test('a policy map applies per-action policies over the default', () => {
    const orders = blend(shop.orders, {
      policy: {
        default: allow.owner('user_id'),
        index: allow.authenticated,
        store: allow.authenticated,
      },
      actions: (a) => [a.index(), a.show(), a.store(), a.update()],
    });
    expect(
      Object.fromEntries(Object.entries(orders.policies).map(([k, p]) => [k, p.kind])),
    ).toEqual({
      index: 'authenticated',
      show: 'owner',
      store: 'authenticated',
      update: 'owner',
    });
  });

  test('hidden columns are kept for responses', () => {
    const users = blend(shop.users, {
      policy: allow.authenticated,
      hidden: ['password'],
      actions: (a) => [a.show()],
    });
    expect(users.hidden).toEqual(['password']);
  });
});

describe('blend() rejects invalid definitions', () => {
  const orders = shop.orders;
  const expectError = (define: () => unknown, message: string) =>
    expect(define).toThrow(new BlendxDefinitionError('orders', message));

  test('an exposed action without a policy', () => {
    expectError(
      () =>
        blend(orders, { policy: { index: allow.public }, actions: (a) => [a.index(), a.show()] }),
      'action "show" has no policy; add it or a default',
    );
  });

  test('a policy for an action that is not exposed', () => {
    expectError(
      () =>
        blend(orders, {
          policy: { index: allow.public, shw: allow.public },
          actions: (a) => [a.index()],
        }),
      'policy for "shw", which is not an action',
    );
  });

  test('the same action twice', () => {
    expectError(
      () => blend(orders, { policy: allow.public, actions: (a) => [a.show(), a.show()] }),
      'action "show" is listed twice',
    );
  });

  test('custom actions with bad or built-in names, or a bad path', () => {
    expectError(
      () => blend(orders, { policy: allow.public, actions: (a) => [a.member('Refund')] }),
      'custom action "Refund" must be lowercase letters, digits and _',
    );
    expectError(
      () => blend(orders, { policy: allow.public, actions: (a) => [a.collection('store')] }),
      'custom action "store" reuses a built-in action name',
    );
    expectError(
      () =>
        blend(orders, {
          policy: allow.public,
          actions: (a) => [a.member('pay', { path: 'Pay Now' })],
        }),
      'custom action "pay" has an invalid path "Pay Now"',
    );
  });

  test('restore on a table without soft delete (types forbid it; JS callers get an error)', () => {
    expect(() =>
      blend(shop.users, {
        policy: allow.public,
        actions: (a) => [(a as unknown as { restore(): never }).restore()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'users',
        'restore needs a soft-delete table (a nullable deleted_at timestamp)',
      ),
    );
  });

  test('purge on a table without soft delete (types forbid it; JS callers get an error)', () => {
    expect(() =>
      blend(shop.users, {
        policy: allow.public,
        actions: (a) => [(a as unknown as { purge(): never }).purge()],
      }),
    ).toThrow(
      new BlendxDefinitionError(
        'users',
        'purge needs a soft-delete table (a nullable deleted_at timestamp); destroy already deletes for good',
      ),
    );
  });

  test('purge: DELETE /:id/purge, a built-in member action that writes (D29)', () => {
    const resource = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.purge({ after: () => {}, later: () => {} })],
    });
    expect(routesOf(resource)).toEqual(['purge DELETE /:id/purge']);
    expect(resource.actions[0]).toMatchObject({ on: 'member', builtin: true });
  });

  test('a hidden column that does not exist', () => {
    expectError(
      () =>
        blend(orders, {
          policy: allow.public,
          hidden: ['secret' as never],
          actions: (a) => [a.show()],
        }),
      'hidden column "secret" is not a column of orders',
    );
  });
});

describe('blend() types', () => {
  test('the resource knows its action names', () => {
    expectTypeOf<ReturnType<typeof additionExample>['actions'][number]['name']>().toEqualTypeOf<
      'index' | 'show' | 'store' | 'destroy' | 'restore'
    >();
  });

  test('calculate is typed from rules, the loaded record and the model', () => {
    const typeOnly = () =>
      blend(shop.orders, {
        policy: allow.public,
        actions: (a) => [
          a.store({
            rules: ({ prev }) => prev.extend({ coupon: z.string().optional() }),
            calculate: ({ input }) => {
              expectTypeOf(input.total).toEqualTypeOf<string>();
              expectTypeOf(input.coupon).toEqualTypeOf<string | undefined>();
              return { total: input.total };
            },
          }),
          a.update({
            calculate: ({ input, record }) => {
              expectTypeOf(record).toEqualTypeOf<Row<typeof shop.orders>>();
              expectTypeOf(input.quantity).toEqualTypeOf<number | undefined>();
              return { quantity: (input.quantity ?? record.quantity) + 1 };
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('invalid definitions fail to compile', () => {
    const typeOnly = () => {
      // @ts-expect-error users has no deleted_at, so there is no restore action
      blend(shop.users, { policy: allow.public, actions: (a) => [a.restore()] });
      // @ts-expect-error users has no deleted_at, so there is no purge action either (D29)
      blend(shop.users, { policy: allow.public, actions: (a) => [a.purge()] });
      // @ts-expect-error hidden columns must be columns of the model
      blend(shop.users, { policy: allow.public, hidden: ['passwrd'], actions: (a) => [a.show()] });
      // @ts-expect-error every resource needs a policy
      blend(shop.users, { actions: (a) => [a.show()] });
      blend(shop.orders, {
        policy: allow.public,
        actions: (a) => [
          a.store({
            // @ts-expect-error id is generated, calculate may not write it
            calculate: () => ({ id: 1 }),
          }),
        ],
      });
    };
    expect(typeOnly).toBeFunction();
  });
});
