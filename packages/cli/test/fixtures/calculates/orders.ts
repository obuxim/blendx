/** P10.2 fixture: calculate hooks in every shape the review extractor must read. */
import { allow, blend, z } from 'blendx';
import { models } from '../../../../dbml/test/golden/shop.schema.gen.ts';

export default blend(models.orders, {
  policy: allow.public,
  actions: (a) => [
    // A spread: the keys come from prev's type; with the default rules, every writable column.
    a.store({
      calculate: ({ prev }) => ({ ...prev, quantity: 1 }),
    }),
    // A spread under narrower rules: prev holds only the writable columns they accept.
    a.member('reprice', {
      rules: () => z.object({ total: z.string(), note: z.string() }),
      calculate: ({ prev }) => ({ ...prev, status: 'pending' as const }),
    }),
    // One literal key.
    a.update({
      rules: ({ prev }) => prev.pick({ quantity: true }),
      calculate: ({ input, record }) => ({
        total: (Number(record.total) * (input.quantity ?? 1)).toFixed(2),
      }),
    }),
    // A conditional: the union of both branches.
    a.member('pay', {
      rules: () => z.object({ paid: z.boolean() }),
      calculate: ({ input }) =>
        input.paid ? { status: 'paid' as const } : { status: 'pending' as const, placed_on: null },
    }),
    // A method with several returns.
    a.collection('quote', {
      rules: () => z.object({ quantity: z.number() }),
      calculate({ input }) {
        if (input.quantity > 10) return { total: input.quantity * 9 };
        return { total: input.quantity * 10, discount: 0 };
      },
    }),
    // A scope: its source, and the columns the listing is scoped by (D22).
    a.index({ scope: ({ auth }) => ({ user_id: (auth as { id: number } | null)?.id }) }),
    // No calculate at all.
    a.destroy(),
  ],
});
