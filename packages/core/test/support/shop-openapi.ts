/**
 * The shop fixture as resources for the OpenAPI tests: a hidden column, public and
 * authenticated policies, a when policy, soft delete with ?trashed, and a custom collection
 * and member action.
 */
import { allow, blend } from '@blendx/core';
import { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

export const users = blend(models.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.store(), a.show()],
});

export const orders = blend(models.orders, {
  policy: {
    default: allow.authenticated,
    index: allow.public,
    quote: allow.public,
    refund: allow.when(({ auth }) => auth !== null),
  },
  actions: (a) => [
    a.index({ trashed: true }),
    a.store(),
    a.show(),
    a.update(),
    a.destroy(),
    a.restore(),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string() }),
      calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
    }),
    a.member('refund', { rules: () => z.object({ reason: z.string() }) }),
  ],
});

export const notes = blend(models.order_notes, {
  policy: allow.authenticated,
  actions: (a) => [a.index(), a.store()],
});

export const resources = [users, orders, notes];

export const info = { title: 'Shop API', version: '1.0.0' };
