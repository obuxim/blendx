import { allow, blend, z } from 'blendx';
import { expense_category, models } from '../src/generated/schema.gen.ts';

type Category = (typeof expense_category.enumValues)[number];

/** The tax included in each category's claims. */
const TAX_RATES: Record<Category, number> = { travel: 0, meals: 0.1, office: 0.2, other: 0 };

/** Tax at the category's rate, and the total. Numeric columns are strings; sums run in cents. */
function price(amount: string, category: Category) {
  const cents = Math.round(Number(amount) * 100);
  const tax = Math.round(cents * TAX_RATES[category]);
  return { tax: (tax / 100).toFixed(2), total: ((cents + tax) / 100).toFixed(2) };
}

/** An amount that numeric(10,2) holds: 12.50, 7 or 0.99. */
const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be an amount such as 12.50');

/** A claim waits for review, and nobody reviews their own. */
const reviewable = (record: { status: string; user_id: number }, auth: { id: number } | null) =>
  record.status === 'submitted' && record.user_id !== auth?.id;

const approvers = allow.when(({ auth }) => auth?.is_approver === true, {
  requiresAuth: true,
  description: 'an approver',
});

export default blend(models.expenses, {
  // A claim belongs to its claimant. Approvers also see and review everyone's.
  policy: {
    default: allow.owner('user_id'),
    index: allow.authenticated,
    store: allow.authenticated,
    quote: allow.authenticated,
    show: allow.when(
      ({ auth, record }) => auth?.is_approver === true || record?.user_id === auth?.id,
      { requiresAuth: true, description: 'the claimant, or an approver' },
    ),
    approve: approvers,
    reject: approvers,
  },
  actions: (a) => [
    a.index({
      // Approvers list every claim. Everyone else lists their own, with ?user_id=<their id>.
      authorize: ({ prev, auth, input }) =>
        prev && (auth?.is_approver === true || input.user_id === String(auth?.id)),
    }),
    a.store({
      rules: ({ prev }) =>
        prev.pick({ description: true, category: true, spent_on: true }).extend({ amount }),
      calculate: ({ input }) => ({ ...input, ...price(input.amount, input.category) }),
      // The claimant is whoever is signed in. calculate never sees the identity; save does.
      save: ({ runDefault, writes, auth }) => runDefault({ ...writes, user_id: auth?.id }),
    }),
    a.show(),
    a.update({
      rules: ({ prev }) =>
        prev
          .pick({ description: true, category: true, spent_on: true })
          .extend({ amount: amount.optional() }),
      // Only a draft changes, and a new amount or category is priced again.
      authorize: ({ prev, record }) => prev && record.status === 'draft',
      calculate: ({ input, record }) => ({
        ...input,
        ...price(input.amount ?? record.amount, input.category ?? record.category),
      }),
    }),
    a.destroy({ authorize: ({ prev, record }) => prev && record.status === 'draft' }),
    a.restore(),
    a.member('submit', {
      authorize: ({ prev, record }) => prev && record.status === 'draft',
      calculate: () => ({ status: 'submitted' as const }),
    }),
    a.member('approve', {
      authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
      calculate: () => ({ status: 'approved' as const }),
    }),
    a.member('reject', {
      rules: () => z.object({ note: z.string().min(3).max(500) }),
      authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
      calculate: ({ input }) => ({ status: 'rejected' as const, review_note: input.note }),
    }),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ amount, category: z.enum(expense_category.enumValues) }),
      calculate: ({ input }) => price(input.amount, input.category),
      reply: z.object({ tax: z.string(), total: z.string() }),
    }),
  ],
});
