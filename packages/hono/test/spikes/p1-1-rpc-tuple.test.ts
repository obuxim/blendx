/**
 * P1.1 spike, kept as a regression test.
 *
 * `run()` will return an explicitly typed `[validator, handler]` tuple that generated
 * routes spread into chained Hono calls (docs/decisions.md D9). This proves the shape
 * keeps Hono RPC types: per-action JSON input, the success body narrowed by status,
 * and the 422 Problem body — without relying on createHandlers() inference.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import type { Context, Handler, MiddlewareHandler, TypedResponse } from 'hono';
import { Hono } from 'hono';
import type { hc, InferRequestType, InferResponseType } from 'hono/client';
import { testClient } from 'hono/testing';
import type { BlankEnv } from 'hono/types';
import type { StatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { z } from 'zod';

type Problem = {
  type: string;
  title: string;
  status: number;
  errors: { pointer: string; detail: string }[];
};

type JsonInput<In, Out> = { in: { json: In }; out: { json: Out } };

type Responses<Body, Status extends StatusCode> =
  | TypedResponse<Body, Status, 'json'>
  | TypedResponse<Problem, 422, 'json'>;

type RunTuple<In, Out, Body, Status extends StatusCode> = readonly [
  MiddlewareHandler<BlankEnv, string, JsonInput<In, Out>>,
  Handler<BlankEnv, string, JsonInput<In, Out>, Promise<Responses<Body, Status>>>,
];

function runSpike<S extends z.ZodType, Body, Status extends 200 | 201>(
  schema: S,
  status: Status,
  calculate: (input: z.output<S>) => Body,
): RunTuple<z.input<S>, z.output<S>, Body, Status> {
  const validate = validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    const problem: Problem = {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      errors: parsed.error.issues.map((issue) => ({
        pointer: `/${issue.path.join('/')}`,
        detail: issue.message,
      })),
    };
    return c.json(problem, 422);
  });
  const handle = (c: Context<BlankEnv, string, JsonInput<z.input<S>, z.output<S>>>) =>
    c.json(calculate(c.req.valid('json')) as never, status);
  return [validate, handle] as unknown as RunTuple<z.input<S>, z.output<S>, Body, Status>;
}

const additionRules = z.object({ a: z.number(), b: z.number() }).strict();

const app = new Hono().post(
  '/addition_results',
  ...runSpike(additionRules, 201, ({ a, b }) => ({ result: a + b })),
);

type AppType = typeof app;
type Store = ReturnType<typeof hc<AppType>>['addition_results']['$post'];
const client = testClient(app);

describe('P1.1 typed run() tuple keeps Hono RPC types', () => {
  test('request type is the resolved rules input', () => {
    expectTypeOf<InferRequestType<Store>>().toEqualTypeOf<{ json: { a: number; b: number } }>();
  });

  test('201 body and 422 problem are distinct status-narrowed types', () => {
    expectTypeOf<InferResponseType<Store, 201>>().toEqualTypeOf<{ result: number }>();
    expectTypeOf<InferResponseType<Store, 422>>().toEqualTypeOf<Problem>();
  });

  test('wrong input and unknown routes fail to compile', () => {
    const neverCalled = () => {
      // @ts-expect-error b must be a number
      client.addition_results.$post({ json: { a: 1, b: 'x' } });
      // @ts-expect-error the route is not part of AppType
      client.nope.$post();
    };
    expect(neverCalled).toBeFunction();
  });

  test('runtime: 201 with the calculated result', async () => {
    const res = await client.addition_results.$post({ json: { a: 4, b: 3 } });
    expect(res.status).toBe(201);
    if (res.status === 201) {
      const body = await res.json();
      expectTypeOf(body).toEqualTypeOf<{ result: number }>();
      expect(body).toEqual({ result: 7 });
    }
  });

  test('runtime: 422 problem with a JSON pointer', async () => {
    const res = await client.addition_results.$post({ json: { a: 4, b: 'x' } as never });
    expect(res.status).toBe(422);
    if (res.status === 422) {
      const body = await res.json();
      expect(body.errors[0]?.pointer).toBe('/b');
    }
  });
});
