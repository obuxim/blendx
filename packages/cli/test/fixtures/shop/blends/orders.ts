import { allow, blend, z } from 'blendx';
import { models } from '../../../../../dbml/test/golden/shop.schema.gen.ts';
import orderNotes from './order_notes.ts';
import users from './users.ts';

// Listed out of order on purpose: routes.gen.ts orders them.
export default blend(models.orders, {
  policy: allow.public,
  // ?include=user, so client.gen.ts records that orders include users (N.8), and
  // ?include=notes, a has-many (D31), which it records the same way.
  includes: { user: users, notes: { blend: orderNotes, limit: 5, sort: '-id' } },
  actions: (a) => [
    a.member('refund', {
      rules: () => z.object({ reason: z.string() }),
    }),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string() }),
      calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
    }),
    a.restore(),
    a.destroy(),
    a.update(),
    a.show(),
    a.store(),
    a.index({ trashed: true }),
  ],
});
