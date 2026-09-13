/**
 * P16.7 (D28): relations come from the foreign keys, and includes are checked: a relation of
 * the table, through a blend of the table it points to. The refused blends are built only
 * inside `refused`, which is never called: blend() would throw.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import { allow, blend, type Relation, type RelationTable } from '@blendx/core';
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
