/**
 * P9.4: a declared `reply` (D14) is kept on the action and its endpoint, and OpenAPI uses it
 * instead of warning. Replies that are neither declared nor derivable are still warnings.
 */
import { describe, expect, test } from 'bun:test';
import { allow, BlendxDefinitionError, blend, defineApp, toEndpoints } from '@blendx/core';
import { z } from 'zod';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';
import { buildOpenApi, type JsonObject } from '../src/openapi.ts';

const orders = blend(models.orders, {
  policy: allow.public,
  actions: (a) => [
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string() }),
      calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
      reply: z.object({ total: z.number() }),
    }),
    a.member('refund', {
      respond: ({ record }) => ({ status: 202, body: { id: record.id } }),
      reply: { status: 202, body: z.object({ id: z.number() }) },
    }),
    a.collection('estimate', {
      calculate: () => ({ total: 1 }),
    }),
    a.member('touch', {
      respond: ({ record }) => ({ status: 200, body: { id: record.id } }),
    }),
  ],
});

const at = (value: unknown, ...keys: string[]): JsonObject =>
  keys.reduce((node, key) => (node as JsonObject)[key], value) as JsonObject;

describe('a declared reply', () => {
  test('blend() keeps the body schema, and the status when it is not the default', () => {
    const action = (name: string) => orders.actions.find((candidate) => candidate.name === name);
    expect(action('quote')?.reply?.status).toBeUndefined();
    expect(action('quote')?.reply?.schema.parse({ total: 5 })).toEqual({ total: 5 });
    expect(action('refund')?.reply?.status).toBe(202);
    expect(toEndpoints(orders).find((e) => e.action === 'refund')?.reply?.status).toBe(202);
  });

  test('a reply that is neither a schema nor { status, body } is a definition error', () => {
    const define = () =>
      blend(models.orders, {
        policy: allow.public,
        actions: (a) => [a.collection('quote', { reply: 'total' } as never)],
      });
    expect(define).toThrow(BlendxDefinitionError);
    expect(define).toThrow(
      'blend(orders): action "quote" has a reply that is neither a zod schema nor { status, body }',
    );
  });

  test('OpenAPI describes declared replies, at their status, and warns about the rest', () => {
    const { document, warnings } = buildOpenApi({
      app: defineApp({}),
      resources: [orders],
      info: { title: 'Shop API', version: '1.0.0' },
    });
    const quote = at(document, 'paths', '/orders/quote', 'get', 'responses', '200', 'content');
    expect(at(quote, 'application/json', 'schema', 'properties')).toEqual({
      total: { type: 'number' },
    });
    const refund = at(document, 'paths', '/orders/{id}/refund', 'post', 'responses');
    expect(Object.keys(refund)).toContain('202');
    expect(Object.keys(refund)).not.toContain('200');
    expect(at(refund, '202').description).toBe('Accepted');
    expect(warnings).toEqual([
      'orders.estimate: the reply is what calculate returns; describe it with reply',
      'orders.touch: its respond hook builds the reply; describe it with reply',
    ]);
  });
});
