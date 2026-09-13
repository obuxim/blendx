import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';
import orderNotes from './order_notes.ts';
import users from './users.ts';

export default blend(models.orders, {
  // An order belongs to its user_id; listing and quoting are public.
  policy: {
    default: allow.owner('user_id'),
    index: allow.public,
    store: allow.authenticated,
    quote: allow.public,
  },
  // ?include=user nests the order's user, as GET /users/:id would reply (D28), and
  // ?include=notes its two newest notes, each as GET /order_notes/:id would reply (D31);
  // ?include=notes.author follows the notes' own include to each note's author (D32).
  includes: { user: users, notes: { blend: orderNotes, limit: 2, sort: '-id' } },
  actions: (a) => [
    a.index({ trashed: true }),
    a.store({
      // An order is placed for oneself.
      authorize: ({ prev, auth, input }) => prev && input.user_id === auth?.id,
    }),
    a.show(),
    a.update(),
    a.destroy(),
    a.restore(),
    a.purge(),
    a.member('refund', {
      rules: () => z.object({ reason: z.string().min(3) }),
      calculate: () => ({ status: 'refunded' as const }),
    }),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string().regex(/^[1-9][0-9]*$/) }),
      calculate: ({ input }) => ({ total: (Number(input.quantity) * 9.5).toFixed(2) }),
      reply: z.object({ total: z.string() }),
    }),
  ],
});
