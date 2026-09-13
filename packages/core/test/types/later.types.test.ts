/**
 * P16.3 (D27): later's context at each level, and no later on reads. The blends with refused
 * hooks are built only inside `reads`, which is never called: blend() would throw.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import { allow, blend, type Db, defineApp, type Row } from '@blendx/core';
import { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

type Order = Row<typeof models.orders>;

describe('later (D27)', () => {
  test("an action's later sees after's context, the entry's id and the attempt", () => {
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.store({
          rules: () => z.object({ user_id: z.number(), total: z.string() }),
          later: ({ saved, record, input, db, id, attempt }) => {
            expectTypeOf(saved).toEqualTypeOf<Order>();
            expectTypeOf(record).toEqualTypeOf<undefined>();
            expectTypeOf(input).toEqualTypeOf<{ user_id: number; total: string }>();
            expectTypeOf(db).toEqualTypeOf<Db>();
            expectTypeOf(id).toEqualTypeOf<number>();
            expectTypeOf(attempt).toEqualTypeOf<number>();
          },
        }),
        a.update({ later: async ({ record }) => expectTypeOf(record).toEqualTypeOf<Order>() }),
        a.destroy({ later: () => {} }),
        a.restore({ later: () => {} }),
        a.member('refund', { later: () => {} }),
      ],
    });
  });

  test('app and resource later hooks see every table, and the action', () => {
    defineApp({
      auth: () => ({ id: 1 }),
      hooks: {
        later: ({ auth, action, saved, id }) => {
          expectTypeOf(auth).toEqualTypeOf<{ id: number } | null>();
          expectTypeOf(action).toEqualTypeOf<string>();
          expectTypeOf(saved).toEqualTypeOf<unknown>();
          expectTypeOf(id).toEqualTypeOf<number>();
        },
      },
    });
    blend(models.orders, {
      policy: allow.public,
      hooks: {
        later: ({ saved, record }) => {
          expectTypeOf(saved).toEqualTypeOf<Order>();
          expectTypeOf(record).toEqualTypeOf<Order | undefined>();
        },
      },
      actions: (a) => [a.update()],
    });
  });

  test('reads take no later', () => {
    const reads = () =>
      blend(models.orders, {
        policy: allow.public,
        actions: (a) => [
          // @ts-expect-error index writes nothing
          a.index({ later: () => {} }),
          // @ts-expect-error show writes nothing
          a.show({ later: () => {} }),
          // @ts-expect-error a collection action writes nothing
          a.collection('quote', { later: () => {} }),
        ],
      });
    expectTypeOf(reads).toBeFunction();
  });
});
