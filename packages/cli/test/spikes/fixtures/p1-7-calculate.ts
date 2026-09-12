/** P1.7 fixture: calculate hooks in the shapes the review extractor must handle. */
type Order = { status: 'pending' | 'paid'; note: string | null; total: number };

export const spec = {
  actions: {
    store: {
      calculate: ({ input }: { input: { a: number; b: number } }) => ({
        result: input.a + input.b,
      }),
    },
    update: {
      calculate: ({ input, prev }: { input: { quantity: number }; prev: Order }) => ({
        ...prev,
        total: input.quantity * 2,
      }),
    },
    pay: {
      calculate: ({ input }: { input: { paid: boolean; at: string } }) =>
        input.paid
          ? { status: 'paid' as const, paid_at: input.at }
          : { status: 'pending' as const },
    },
    refund: {
      calculate({ record }: { record: Order }) {
        if (record.status !== 'paid') return { note: 'not paid' };
        return { status: 'pending' as const, total: 0 };
      },
    },
  },
};
