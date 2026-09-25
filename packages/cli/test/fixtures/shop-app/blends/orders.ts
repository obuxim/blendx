import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.orders, {
  policy: { default: allow.authenticated, index: allow.public, quote: allow.public },
  actions: (a) => [
    a.index({ trashed: true }),
    a.store(),
    a.show(),
    a.update({
      authorize: ({ prev }) => prev,
      save: async ({ runDefault }) => runDefault(),
      writes: [models.users],
    }),
    a.destroy(),
    a.restore(),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string() }),
      calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
    }),
    a.member('refund', {
      rules: () => z.object({ reason: z.string() }),
    }),
  ],
});
