/**
 * P16.1 (D26): after's context at each level, and no after on reads. The blends with
 * refused hooks are built only inside `reads`, which is never called: blend() would throw.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import { allow, blend, type Db, defineApp, type Row } from '@blendx/core';
import { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

type Order = Row<typeof models.orders>;

describe('after (D26)', () => {
  test('an action sees the saved row, the loaded row, its input and the database', () => {
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.store({
          rules: () => z.object({ user_id: z.number(), total: z.string() }),
          after: ({ saved, record, input, db }) => {
            expectTypeOf(saved).toEqualTypeOf<Order>();
            expectTypeOf(record).toEqualTypeOf<undefined>();
            expectTypeOf(input).toEqualTypeOf<{ user_id: number; total: string }>();
            expectTypeOf(db).toEqualTypeOf<Db>();
          },
        }),
        a.update({
          after: async ({ saved, record }) => {
            expectTypeOf(saved).toEqualTypeOf<Order>();
            expectTypeOf(record).toEqualTypeOf<Order>();
          },
        }),
        a.destroy({ after: ({ record }) => expectTypeOf(record).toEqualTypeOf<Order>() }),
        a.restore({ after: ({ saved }) => expectTypeOf(saved).toEqualTypeOf<Order>() }),
        // purge (D29): saved is the row as deleted.
        a.purge({
          after: ({ saved, record }) => {
            expectTypeOf(saved).toEqualTypeOf<Order>();
            expectTypeOf(record).toEqualTypeOf<Order>();
          },
        }),
        a.member('refund', {
          rules: () => z.object({ reason: z.string() }),
          after: ({ input }) => expectTypeOf(input).toEqualTypeOf<{ reason: string }>(),
        }),
      ],
    });
  });

  test('app and resource hooks see every table, and the action', () => {
    defineApp({
      auth: () => ({ id: 1 }),
      hooks: {
        after: ({ auth, action, saved }) => {
          expectTypeOf(auth).toEqualTypeOf<{ id: number } | null>();
          expectTypeOf(action).toEqualTypeOf<string>();
          expectTypeOf(saved).toEqualTypeOf<unknown>();
        },
      },
    });
    blend(models.orders, {
      policy: allow.public,
      hooks: {
        after: ({ saved, record, action }) => {
          expectTypeOf(saved).toEqualTypeOf<Order>();
          expectTypeOf(record).toEqualTypeOf<Order | undefined>();
          expectTypeOf(action).toEqualTypeOf<string>();
        },
      },
      actions: (a) => [a.update()],
    });
  });

  test('reads take no after', () => {
    const reads = () =>
      blend(models.orders, {
        policy: allow.public,
        actions: (a) => [
          // @ts-expect-error index writes nothing
          a.index({ after: () => {} }),
          // @ts-expect-error show writes nothing
          a.show({ after: () => {} }),
          // @ts-expect-error a collection action writes nothing
          a.collection('quote', { after: () => {} }),
        ],
      });
    expectTypeOf(reads).toBeFunction();
  });
});
