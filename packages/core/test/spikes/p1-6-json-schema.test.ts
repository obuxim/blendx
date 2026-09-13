/**
 * P1.6 spike, kept as a regression test.
 *
 * blendx generates openapi.json itself (docs/decisions.md D8) with zod 4's
 * z.toJSONSchema, targeting draft 2020-12 (the dialect OpenAPI 3.1 uses). This proves
 * drizzle-orm/zod schemas and hand-written rules convert without unrepresentable types, in
 * both directions: io 'input' for request bodies and io 'output' for responses.
 * The snapshots show exactly what the OpenAPI builder (P9.1) will receive.
 */
import { describe, expect, test } from 'bun:test';
import { doublePrecision, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod';
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

/** The schema exactly as openapi.json will hold it: plain, serialized JSON data. */
const toJson = (schema: z.ZodType, io: 'input' | 'output'): unknown =>
  JSON.parse(JSON.stringify(z.toJSONSchema(schema, { target: 'draft-2020-12', io })));

describe('P1.6 z.toJSONSchema on blendx schemas', () => {
  test('store request body: strict drizzle-orm/zod insert schema, io input', () => {
    const body = toJson(createInsertSchema(orders).strict(), 'input');
    expect(body).toMatchSnapshot();
  });

  test('response body: drizzle-orm/zod select schema, io output', () => {
    expect(toJson(createSelectSchema(orders), 'output')).toMatchSnapshot();
  });

  test('hand-written rules (the addition example), io input', () => {
    const rules = z.object({ a: z.number(), b: z.number() }).strict();
    expect(toJson(rules, 'input')).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });

  test('the ~standard payload is non-enumerable, so JSON.stringify never writes it', () => {
    const raw = z.toJSONSchema(z.object({ a: z.number() }), { target: 'draft-2020-12' });
    expect(Object.getOwnPropertyDescriptor(raw, '~standard')?.enumerable).toBe(false);
    expect(JSON.stringify(raw)).not.toContain('~standard');
  });

  test('output is deterministic', () => {
    const select = createSelectSchema(orders);
    expect(JSON.stringify(toJson(select, 'output'))).toBe(JSON.stringify(toJson(select, 'output')));
  });
});
