/**
 * P9.4: `reply` must describe the reply it documents (docs/decisions.md D14). tsc checks the
 * @ts-expect-error lines, which sit on the call: the check reports on the whole spec. The
 * blends also run, so a declared reply is kept at runtime.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { allow, blend } from '@blendx/core';
import { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

const quote = { method: 'get', rules: () => z.object({ quantity: z.string() }) } as const;

describe('reply on a collection action: what calculate returns', () => {
  test('a schema that describes the result is accepted, and inference still flows', () => {
    const orders = blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.collection('quote', {
          ...quote,
          calculate: ({ input }) => {
            expectTypeOf(input.quantity).toEqualTypeOf<string>();
            return { total: Number(input.quantity) * 10 };
          },
          reply: z.object({ total: z.number() }),
        }),
      ],
    });
    expect(orders.actions[0]?.reply?.schema).toBeDefined();
  });

  test('a wrong type, an extra key or a missing key is rejected', () => {
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        // @ts-expect-error total is a number, not a string
        a.collection('wrong_type', {
          ...quote,
          calculate: ({ input }) => ({ total: Number(input.quantity) }),
          reply: z.object({ total: z.string() }),
        }),
        // @ts-expect-error the body has no currency
        a.collection('extra_key', {
          ...quote,
          calculate: ({ input }) => ({ total: Number(input.quantity) }),
          reply: z.object({ total: z.number(), currency: z.string() }),
        }),
        // @ts-expect-error the schema leaves out total
        a.collection('missing_key', {
          ...quote,
          calculate: ({ input }) => ({ total: Number(input.quantity) }),
          reply: z.object({}),
        }),
      ],
    });
  });
});

describe('reply with a respond hook: what respond returns', () => {
  test('another status is declared with { status, body }', () => {
    const orders = blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.member('refund', {
          rules: () => z.object({ reason: z.string() }),
          respond: ({ record }) => ({ status: 202, body: { id: record.id, refunding: true } }),
          reply: { status: 202, body: z.object({ id: z.number(), refunding: z.boolean() }) },
        }),
      ],
    });
    expect(orders.actions[0]?.reply?.status).toBe(202);
  });

  test('a bare schema, or the wrong status, is rejected when respond changes the status', () => {
    blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        // @ts-expect-error respond returns 202, so the status must be declared
        a.member('bare', {
          respond: ({ record }) => ({ status: 202, body: { id: record.id } }),
          reply: z.object({ id: z.number() }),
        }),
        // @ts-expect-error respond returns 202, not 200
        a.member('wrong_status', {
          respond: ({ record }) => ({ status: 202, body: { id: record.id } }),
          reply: { status: 200, body: z.object({ id: z.number() }) },
        }),
      ],
    });
  });
});
