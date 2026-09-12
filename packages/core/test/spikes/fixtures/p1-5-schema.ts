import { doublePrecision, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const orderStatus = pgEnum('order_status', ['pending', 'paid', 'refunded']);

export const additionResults = pgTable('addition_results', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  result: doublePrecision(),
  created_at: timestamp({ mode: 'string' }).notNull().defaultNow(),
  updated_at: timestamp({ mode: 'string' }).notNull().defaultNow(),
  deleted_at: timestamp({ mode: 'string' }),
});

export const customers = pgTable('customers', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: varchar({ length: 20 }).notNull().unique('customers_email_unique'),
  status: orderStatus().notNull().default('pending'),
});
