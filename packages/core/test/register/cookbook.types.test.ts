/**
 * P12.3: every snippet in docs/cookbook.md, as code tsc checks. It lives in the Register
 * project, where the identity is typed as in an app (`auth?.id` is a number), and every
 * blend is also built, so blend()'s own checks apply. Keep it in step with the cookbook.
 */
import { expect, test } from 'bun:test';
import { allow, blend } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../../dbml/test/golden/addition.schema.gen.ts';
import { models as kitchen } from '../../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

/** Pattern 11's mailer: the app's own. The hook never runs here, so it needs no body. */
declare function notify(userId: number, text: string): Promise<void>;

/** Pattern 12's payment provider: the app's own client. */
declare const payments: {
  refund(orderId: number, options: { idempotencyKey: string }): Promise<void>;
};

/** Pattern 13's target: the users blend, with a show that decides who sees each user. */
const users = blend(models.users, {
  policy: allow.authenticated,
  hidden: ['password'],
  actions: (a) => [a.show()],
});

/** Pattern 14's target: the notes blend, whose show decides who sees each note. */
const orderNotes = blend(models.order_notes, {
  policy: allow.authenticated,
  actions: (a) => [a.show()],
});

/** Pattern 15's target: an orders blend with an include of its own, which a path follows. */
const ordersWithUser = blend(models.orders, {
  policy: allow.owner('user_id'),
  includes: { user: users },
  actions: (a) => [a.show()],
});

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
      policy: {
        default: allow.owner('user_id'),
        index: allow.authenticated,
        purge: allow.when(({ auth }) => auth?.role === 'admin'),
      },
      actions: (a) => [a.index({ trashed: true }), a.show(), a.destroy(), a.restore(), a.purge()],
    }),
    // 11. Do something once a write has committed
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('refund', {
          rules: () => z.object({ reason: z.string().min(3) }),
          calculate: () => ({ status: 'refunded' as const }),
          after: ({ saved, input }) =>
            notify(saved.user_id, `Your order was refunded: ${input.reason}`),
        }),
      ],
    }),
    // 12. An effect that must not be lost
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('refund', {
          rules: () => z.object({ reason: z.string().min(3) }),
          calculate: () => ({ status: 'refunded' as const }),
          later: ({ saved, id }) => payments.refund(saved.id, { idempotencyKey: `refund-${id}` }),
        }),
      ],
    }),
    // 13. Nest a related row
    blend(models.orders, {
      policy: { default: allow.owner('user_id'), index: allow.public },
      includes: { user: users },
      actions: (a) => [a.index(), a.show()],
    }),
    // 14. Nest the rows that point at a row
    blend(models.orders, {
      policy: { default: allow.owner('user_id'), index: allow.public },
      includes: { notes: { blend: orderNotes, limit: 10, sort: '-created_at' } },
      actions: (a) => [a.index(), a.show()],
    }),
    // 15. Nest an included row's own includes
    blend(models.order_notes, {
      policy: allow.authenticated,
      includes: { order: ordersWithUser },
      actions: (a) => [a.index(), a.show()],
    }),
    // 16. A table keyed by several columns
    blend(kitchen.order_items, {
      policy: allow.authenticated,
      actions: (a) => [a.index(), a.store(), a.show(), a.update(), a.destroy()],
    }),
    // 17. Replace a record with PUT
    blend(models.orders, {
      policy: allow.owner('user_id'),
      actions: (a) => [
        a.show(),
        a.update(),
        a.replace({
          calculate: ({ prev, record }) => ({ ...prev, public_id: record.public_id }),
        }),
      ],
    }),
  ];
  // Patterns 4 to 7 share one orders blend: fourteen blends for seventeen patterns.
  expect(patterns).toHaveLength(14);
  expect(patterns.every((pattern) => pattern.kind === 'blendx/resource')).toBe(true);
});
