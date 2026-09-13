/**
 * P12.3: every snippet in docs/cookbook.md, as code tsc checks. It lives in the Register
 * project, where the identity is typed as in an app (`auth?.id` is a number), and every
 * blend is also built, so blend()'s own checks apply. Keep it in step with the cookbook.
 */
import { expect, test } from 'bun:test';
import { allow, blend } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../../dbml/test/golden/addition.schema.gen.ts';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

test('the cookbook, compiled', () => {
  const patterns = [
    // 1. Expose a table read-only, hiding a column
    blend(models.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [a.index(), a.show()],
    }),
    // 2. A policy per action, and the owner rule
    blend(models.orders, {
      policy: {
        default: allow.owner('user_id'),
        index: allow.public,
        store: allow.authenticated,
      },
      actions: (a) => [a.index(), a.store(), a.show(), a.update(), a.destroy()],
    }),
    // 3. A column computed from the input
    blend(addition.addition_results, {
      policy: allow.public,
      actions: (a) => [
        a.store({
          rules: () => z.object({ a: z.number(), b: z.number() }),
          calculate: ({ input }) => ({ result: input.a + input.b }),
        }),
      ],
    }),
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        // 4. Add a field to the default rules
        a.store({
          rules: ({ prev }) => prev.extend({ coupon: z.string().optional() }),
          calculate: ({ input }) => ({
            total: input.coupon === 'HALF' ? (Number(input.total) / 2).toFixed(2) : input.total,
          }),
        }),
        // 5. A member action that writes
        a.member('refund', {
          rules: () => z.object({ reason: z.string().min(3) }),
          calculate: () => ({ status: 'refunded' as const }),
        }),
        // 6. A collection action with a declared reply
        a.collection('quote', {
          method: 'get',
          rules: () => z.object({ quantity: z.string() }),
          calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
          reply: z.object({ total: z.number() }),
        }),
        // 7. Scope a listing to the requester
        a.index({ scope: ({ auth }) => ({ user_id: auth?.id }) }),
      ],
    }),
    // 8. Reshape the reply
    blend(models.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [
        a.member('rename', {
          rules: () => z.object({ display_name: z.string() }),
          calculate: ({ input }) => ({ display_name: input.display_name }),
          respond: ({ prev, record }) => ({
            ...prev,
            status: 202,
            body: { renamed: record.display_name },
          }),
          reply: { status: 202, body: z.object({ renamed: z.string().nullable() }) },
        }),
      ],
    }),
    // 9. One more authorization rule
    blend(models.orders, {
      policy: allow.authenticated,
      actions: (a) => [
        a.store({
          authorize: ({ prev, auth, input }) => prev && input.user_id === auth?.id,
        }),
      ],
    }),
    // 10. Soft delete, restore and trashed rows
    blend(models.orders, {
      policy: { default: allow.owner('user_id'), index: allow.authenticated },
      actions: (a) => [a.index({ trashed: true }), a.show(), a.destroy(), a.restore()],
    }),
  ];
  // Patterns 4 to 7 share one orders blend: seven blends for ten patterns.
  expect(patterns).toHaveLength(7);
  expect(patterns.every((pattern) => pattern.kind === 'blendx/resource')).toBe(true);
});
