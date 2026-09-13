/**
 * P1.3 spike, kept as a regression test.
 *
 * Default validation rules come from the schema via drizzle-orm/zod (docs/decisions.md D6).
 * This proves drizzle-orm/zod on zod 4.6.2 covers the column kinds blendx relies on
 * (varchar(n), pgEnum, identity, string-mode timestamp, double, int32), and that its
 * schemas are ordinary `zod` schemas: z.infer, .strict() and .extend() from the `zod`
 * import all work on them.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { doublePrecision, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-orm/zod';
import { z } from 'zod';

const orderStatus = pgEnum('order_status', ['pending', 'paid', 'refunded']);

const orders = pgTable('orders', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  customer_name: varchar({ length: 20 }).notNull(),
  status: orderStatus().notNull().default('pending'),
  total: doublePrecision().notNull(),
  note: varchar({ length: 255 }),
  created_at: timestamp({ mode: 'string' }).notNull().defaultNow(),
});

const insert = createInsertSchema(orders);
const select = createSelectSchema(orders);
const update = createUpdateSchema(orders);

const validOrder = { customer_name: 'Ada', total: 12.5 };

describe('P1.3 drizzle-orm/zod on zod 4.6.2', () => {
  test('varchar(n) becomes a max-length rule', () => {
    const result = insert.safeParse({ ...validOrder, customer_name: 'x'.repeat(21) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'too_big', path: ['customer_name'] });
  });

  test('insert input omits the identity column and makes defaulted columns optional', () => {
    expect(Object.keys(insert.shape)).not.toContain('id');
    expectTypeOf<z.input<typeof insert>>().toEqualTypeOf<{
      customer_name: string;
      status?: 'pending' | 'paid' | 'refunded';
      total: number;
      note?: string | null;
      created_at?: string;
    }>();
  });

  test('select output maps every column, string-mode timestamps stay strings', () => {
    expectTypeOf<z.infer<typeof select>>().toEqualTypeOf<{
      id: number;
      customer_name: string;
      status: 'pending' | 'paid' | 'refunded';
      total: number;
      note: string | null;
      created_at: string;
    }>();
  });

  test('pgEnum becomes an enum rule', () => {
    expect(insert.safeParse({ ...validOrder, status: 'shipped' }).success).toBe(false);
    expect(insert.safeParse({ ...validOrder, status: 'paid' }).success).toBe(true);
  });

  test('integer becomes an int32 rule, double stays a plain number', () => {
    expect(select.shape.id.safeParse(2 ** 31).success).toBe(false);
    expect(select.shape.id.safeParse(1.5).success).toBe(false);
    expect(select.shape.total.safeParse(1.5).success).toBe(true);
  });

  test('update makes every writable column optional', () => {
    expect(update.safeParse({}).success).toBe(true);
    expect(Object.keys(update.shape)).not.toContain('id');
  });

  test('schemas unify with the `zod` import: instanceof, strict, extend', () => {
    expect(insert).toBeInstanceOf(z.ZodObject);

    const strictStore = insert.strict();
    const unknownKey = strictStore.safeParse({ ...validOrder, is_admin: true });
    expect(unknownKey.success).toBe(false);
    expect(unknownKey.error?.issues[0]?.code).toBe('unrecognized_keys');

    const withCoupon = insert.extend({ coupon: z.string().max(8) });
    expectTypeOf<z.input<typeof withCoupon>['coupon']>().toEqualTypeOf<string>();
    expect(withCoupon.safeParse({ ...validOrder, coupon: 'SAVE10' }).success).toBe(true);
  });
});
