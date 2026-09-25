/**
 * P17.7: blendx/drizzle is the supported Drizzle boundary for application hooks. Keep the
 * related-table query below in step with docs/guide/hooks.md#save.
 */
import { expect, test } from 'bun:test';
import { allow, blend } from 'blendx';
import {
  and,
  arrayContained,
  arrayContains,
  arrayOverlaps,
  asc,
  between,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notExists,
  notIlike,
  notInArray,
  notLike,
  or,
} from 'blendx/drizzle';
import { models } from '../../conformance/fixtures/shop/src/generated/schema.gen.ts';

test('the documented query helpers and related-table save hook typecheck', () => {
  const helpers = [
    and,
    arrayContained,
    arrayContains,
    arrayOverlaps,
    asc,
    between,
    desc,
    eq,
    exists,
    gt,
    gte,
    ilike,
    inArray,
    isNotNull,
    isNull,
    like,
    lt,
    lte,
    ne,
    not,
    notBetween,
    notExists,
    notIlike,
    notInArray,
    notLike,
    or,
  ];
  expect(helpers).toHaveLength(26);

  const resource = blend(models.orders, {
    policy: allow.public,
    actions: (a) => [
      a.store({
        save: async ({ runDefault, tx, writes }) => {
          const users = models.users.table;
          const [user] = await tx
            .select({ is_active: users.is_active })
            .from(users)
            .where(eq(users.id, writes.user_id ?? -1))
            .limit(1);
          if (!user?.is_active) throw new Error('Orders need an active user.');
          return runDefault();
        },
      }),
    ],
  });
  expect(resource.model).toBe(models.orders);
});
