/**
 * P1.2 spike, kept as a regression test.
 *
 * blendx errors are RFC 9457 Problem Details served as `application/problem+json`.
 * This proves that passing that Content-Type to `c.json()` keeps the response a
 * TypedResponse (so hc still sees the Problem body under its status) and that Hono
 * sends our header instead of its default `application/json`.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { Hono } from 'hono';
import type { InferResponseType } from 'hono/client';
import { testClient } from 'hono/testing';

type Problem = { type: string; title: string; status: number; detail: string };

const PROBLEM_JSON = { 'Content-Type': 'application/problem+json' } as const;

const app = new Hono().get('/orders/:id', (c) => {
  const id = c.req.param('id');
  if (id !== '1') {
    const problem: Problem = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `orders ${id} does not exist`,
    };
    return c.json(problem, 404, PROBLEM_JSON);
  }
  return c.json({ id: 1 }, 200);
});

const client = testClient(app);
type Show = (typeof client.orders)[':id']['$get'];

describe('P1.2 problem+json keeps typed responses', () => {
  test('hc sees the Problem body under its status and the success body under 200', () => {
    expectTypeOf<InferResponseType<Show, 404>>().toEqualTypeOf<Problem>();
    expectTypeOf<InferResponseType<Show, 200>>().toEqualTypeOf<{ id: number }>();
  });

  test('runtime: the problem is sent as application/problem+json', async () => {
    const res = await client.orders[':id'].$get({ param: { id: '2' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toStartWith('application/problem+json');
    if (res.status === 404) {
      const body = await res.json();
      expect(body).toEqual({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'orders 2 does not exist',
      });
    }
  });

  test('runtime: success responses keep application/json', async () => {
    const res = await client.orders[':id'].$get({ param: { id: '1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toStartWith('application/json');
  });
});
