/**
 * P16.7 (D28): relations come from the foreign keys, and includes are checked: a relation of
 * the table, through a blend of the table it points to. The refused blends are built only
 * inside `refused`, which is never called: blend() would throw.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import {
  type ActionReply,
  type ActionRules,
  allow,
  blend,
  type PublicRow,
  type Relation,
  type RelationTable,
} from '@blendx/core';
import type { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

const users = blend(models.users, { policy: allow.public, actions: (a) => [a.show()] });
const notes = blend(models.order_notes, { policy: allow.public, actions: (a) => [a.show()] });

describe('relations (D28)', () => {
  test('named after their _id foreign key, pointing to its table', () => {
    expectTypeOf<Relation<typeof models.orders>>().toEqualTypeOf<'user'>();
    expectTypeOf<Relation<typeof models.order_notes>>().toEqualTypeOf<'order'>();
    expectTypeOf<Relation<typeof models.users>>().toEqualTypeOf<never>();
    expectTypeOf<RelationTable<typeof models.orders, 'user'>>().toEqualTypeOf<'users'>();
  });

  test('includes take a relation of the table, through a blend of the table it points to', () => {
    const orders = blend(models.orders, {
      policy: allow.public,
      includes: { user: users },
      actions: (a) => [a.index()],
    });
    expectTypeOf(orders.includes.user).toEqualTypeOf<typeof users>();

    const refused = () => [
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error customer is not a relation of orders
        includes: { customer: users },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        includes: {
          // @ts-expect-error user points to users, not to order_notes
          user: notes,
        },
        actions: (a) => [a.index()],
      }),
    ];
    expectTypeOf(refused).toBeFunction();
  });
});

describe('?include= in the types (P16.8, D28)', () => {
  const guarded = blend(models.users, {
    policy: allow.public,
    hidden: ['password'],
    actions: (a) => [a.show()],
  });
  const orders = blend(models.orders, {
    policy: allow.public,
    includes: { user: guarded },
    actions: (a) => [a.index(), a.show(), a.update()],
  });
  type Action<N> = Extract<(typeof orders)['actions'][number], { name: N }>;
  type User = PublicRow<typeof models.users, 'password'>;

  test('index and show replies carry each include as an optional, nullable record, without its hidden columns', () => {
    expectTypeOf<ActionReply<Action<'show'>>['body']['user']>().toEqualTypeOf<
      User | null | undefined
    >();
    expectTypeOf<ActionReply<Action<'index'>>['body']['data'][number]['user']>().toEqualTypeOf<
      User | null | undefined
    >();
    expectTypeOf<ActionReply<Action<'update'>>['body']>().not.toHaveProperty('user');
  });

  test("show's query takes include when the blend declares includes", () => {
    expectTypeOf<z.input<ActionRules<Action<'show'>>>>().toEqualTypeOf<{
      include?: string | undefined;
    }>();
  });
});
