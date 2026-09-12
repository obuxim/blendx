import { describe, expect, expectTypeOf, test } from 'bun:test';
import { allow, deny, type Policy, type PolicyContext, type Row } from '@blendx/core';
import type { models } from '../../dbml/test/golden/shop.schema.gen.ts';

type Orders = typeof models.orders;

const order = { id: 7, user_id: 42 } as Row<Orders>;

const context = (overrides: Partial<PolicyContext<Orders>>): PolicyContext<Orders> => ({
  auth: null,
  record: undefined,
  input: {},
  action: 'show',
  ...overrides,
});

describe('policies', () => {
  test('public allows anyone and needs no identity', async () => {
    expect(allow.public.requiresAuth).toBe(false);
    expect(await allow.public.check(context({}))).toBe(true);
  });

  test('authenticated needs an identity', async () => {
    expect(allow.authenticated.requiresAuth).toBe(true);
    expect(await allow.authenticated.check(context({}))).toBe(false);
    expect(await allow.authenticated.check(context({ auth: { id: 1 } }))).toBe(true);
  });

  test('owner compares the record column with the identity', async () => {
    const owner: Policy<Orders> = allow.owner('user_id');
    expect(owner.requiresAuth).toBe(true);
    expect(owner.description).toBe('owner (user_id = auth.id)');
    expect(await owner.check(context({ auth: { id: 42 }, record: order }))).toBe(true);
    expect(await owner.check(context({ auth: { id: 43 }, record: order }))).toBe(false);
    expect(await owner.check(context({ auth: null, record: order }))).toBe(false);
  });

  test('owner denies actions without a record (default-deny)', async () => {
    const owner: Policy<Orders> = allow.owner('user_id');
    expect(await owner.check(context({ auth: { id: 42 }, action: 'store' }))).toBe(false);
  });

  test('owner can compare against another identity field', async () => {
    const owner: Policy<Orders> = allow.owner('user_id', 'customer_id');
    expect(owner.description).toBe('owner (user_id = auth.customer_id)');
    expect(await owner.check(context({ auth: { customer_id: 42 }, record: order }))).toBe(true);
  });

  test('when runs a custom rule, sync or async', async () => {
    const adminsOnly: Policy<Orders, { role: string }> = allow.when(
      async ({ auth }) => auth?.role === 'admin',
      { description: 'admins only', requiresAuth: true },
    );
    expect(adminsOnly.requiresAuth).toBe(true);
    expect(adminsOnly.description).toBe('admins only');
    expect(await adminsOnly.check({ ...context({}), auth: { role: 'admin' } })).toBe(true);
    expect(await adminsOnly.check({ ...context({}), auth: { role: 'user' } })).toBe(false);
    expect(allow.when(() => true).requiresAuth).toBe(false);
  });

  test('deny refuses everyone', async () => {
    expect(await deny.check(context({ auth: { id: 1 }, record: order }))).toBe(false);
  });

  test('owner only accepts real columns of the model', () => {
    expectTypeOf<Parameters<typeof allow.owner<Orders>>[0]>().toEqualTypeOf<
      | 'id'
      | 'user_id'
      | 'status'
      | 'total'
      | 'quantity'
      | 'tags'
      | 'meta'
      | 'public_id'
      | 'placed_on'
      | 'created_at'
      | 'updated_at'
      | 'deleted_at'
    >();
    // @ts-expect-error not a column of orders
    const typo: Policy<Orders> = allow.owner('user_idd');
    expect(typo.kind).toBe('owner');
  });
});
