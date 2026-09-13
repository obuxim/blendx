/**
 * P6.3: Hono RPC types over run(). hc sees each action's input, its reply narrowed by
 * status, the Problem Details type, and 204 without a body. tsc checks these; the client
 * is only built inside a function that never runs.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { allow, blend, type ProblemDetails, type PublicRow } from '@blendx/core';
import { type BlendxEnv, run } from '@blendx/hono';
import { Hono } from 'hono';
import { hc, type InferRequestType, type InferResponseType } from 'hono/client';
import { z } from 'zod';
import { models as addition } from '../../../dbml/test/golden/addition.schema.gen.ts';
import { models as kitchen } from '../../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { models as shop } from '../../../dbml/test/golden/shop.schema.gen.ts';

type Addition = typeof addition.addition_results;

const additions = blend(addition.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
    a.update(),
    a.destroy(),
    a.restore(),
    a.purge(),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ a: z.string(), b: z.string() }),
      calculate: ({ input }) => ({ sum: Number(input.a) + Number(input.b) }),
    }),
    a.member('double', {
      rules: () => z.object({ times: z.number() }),
      calculate: ({ input, record }) => ({ result: (record.result ?? 0) * input.times }),
    }),
    // No rules: the action accepts nothing, so it takes no body (P15.6).
    a.member('halve', {
      calculate: ({ record }) => ({ result: (record.result ?? 0) / 2 }),
    }),
  ],
});

const users = blend(shop.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.show()],
});

// A show with includes takes ?include= (D28); one without takes nothing.
const orders = blend(shop.orders, {
  policy: allow.public,
  includes: { user: users },
  actions: (a) => [a.show()],
});

// A composite key: one segment per key column (D33).
const items = blend(kitchen.order_items, {
  policy: allow.public,
  actions: (a) => [a.show(), a.update()],
});

const routes = new Hono<BlendxEnv>()
  .get('/order_items/:order_id/:line', ...run(items, 'show'))
  .patch('/order_items/:order_id/:line', ...run(items, 'update'))
  .get('/addition_results', ...run(additions, 'index'))
  .post('/addition_results', ...run(additions, 'store'))
  .get('/addition_results/quote', ...run(additions, 'quote'))
  .get('/addition_results/:id', ...run(additions, 'show'))
  .patch('/addition_results/:id', ...run(additions, 'update'))
  .delete('/addition_results/:id', ...run(additions, 'destroy'))
  .post('/addition_results/:id/restore', ...run(additions, 'restore'))
  .delete('/addition_results/:id/purge', ...run(additions, 'purge'))
  .post('/addition_results/:id/double', ...run(additions, 'double'))
  .post('/addition_results/:id/halve', ...run(additions, 'halve'))
  .get('/users/:id', ...run(users, 'show'))
  .get('/orders/:id', ...run(orders, 'show'));

type Client = ReturnType<typeof hc<typeof routes>>;
type Additions = Client['addition_results'];
type Member = Additions[':id'];

describe('P6.3 RPC types over run()', () => {
  test('store: the JSON body comes from its rules', () => {
    expectTypeOf<InferRequestType<Additions['$post']>>().toEqualTypeOf<{
      json: { a: number; b: number };
    }>();
  });

  test('each status has its own body: 201 the saved row, 422 a problem', () => {
    expectTypeOf<InferResponseType<Additions['$post'], 201>>().toEqualTypeOf<PublicRow<Addition>>();
    expectTypeOf<InferResponseType<Additions['$post'], 422>>().toEqualTypeOf<ProblemDetails>();
  });

  test('index: a query in, the page envelope out', () => {
    expectTypeOf<InferRequestType<Additions['$get']>>().toEqualTypeOf<{
      query: Record<string, string>;
    }>();
    expectTypeOf<InferResponseType<Additions['$get'], 200>['meta']>().toEqualTypeOf<{
      page: number;
      per_page: number;
      total: number;
    }>();
  });

  test('update: the id param and a partial body', () => {
    type Patch = InferRequestType<Member['$patch']>;
    expectTypeOf<Patch['param']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Patch['json']['result']>().toEqualTypeOf<number | null | undefined>();
    const typeOnly = () => {
      const member = hc<typeof routes>('http://blendx.test').addition_results[':id'];
      member.$patch({ param: { id: '1' }, json: {} });
      member.$patch({ param: { id: '1' }, json: { result: 10 } });
      // @ts-expect-error result is a number
      member.$patch({ param: { id: '1' }, json: { result: 'ten' } });
    };
    expect(typeOnly).toBeFunction();
  });

  test('show, destroy, restore and purge take only the id; destroy and purge answer 204', () => {
    expectTypeOf<InferRequestType<Member['$get']>>().toEqualTypeOf<{ param: { id: string } }>();
    expectTypeOf<InferRequestType<Member['$delete']>>().toEqualTypeOf<{ param: { id: string } }>();
    expectTypeOf<InferRequestType<Member['restore']['$post']>>().toEqualTypeOf<{
      param: { id: string };
    }>();
    expectTypeOf<InferResponseType<Member['$delete'], 204>>().toEqualTypeOf<null>();
    expectTypeOf<InferRequestType<Member['purge']['$delete']>>().toEqualTypeOf<{
      param: { id: string };
    }>();
    expectTypeOf<InferResponseType<Member['purge']['$delete'], 204>>().toEqualTypeOf<null>();
  });

  test('a show whose blend declares includes takes ?include= as its query (D28)', () => {
    type Order = Client['orders'][':id']['$get'];
    expectTypeOf<InferRequestType<Order>['param']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<InferRequestType<Order>['query']>().toEqualTypeOf<{ include?: string }>();
    expectTypeOf<InferResponseType<Order, 200>['user']>().toEqualTypeOf<
      PublicRow<typeof shop.users, 'password'> | null | undefined
    >();
  });

  test('custom actions: a GET takes its rules as the query, a POST as the JSON body', () => {
    expectTypeOf<InferRequestType<Additions['quote']['$get']>>().toEqualTypeOf<{
      query: { a: string; b: string };
    }>();
    expectTypeOf<InferResponseType<Additions['quote']['$get'], 200>>().toEqualTypeOf<{
      sum: number;
    }>();
    type Double = InferRequestType<Member['double']['$post']>;
    expectTypeOf<Double['param']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Double['json']>().toEqualTypeOf<{ times: number }>();
  });

  test('an action whose rules accept nothing takes only the id, as OpenAPI says (P15.6)', () => {
    expectTypeOf<InferRequestType<Member['halve']['$post']>>().toEqualTypeOf<{
      param: { id: string };
    }>();
  });

  test('a composite key takes one param per column, and its columns in the body (D33)', () => {
    type Item = Client['order_items'][':order_id'][':line'];
    // hono types the params as one object per segment, intersected: the keys are what matter.
    type Get = InferRequestType<Item['$get']>;
    expectTypeOf<keyof Get>().toEqualTypeOf<'param'>();
    expectTypeOf<keyof Get['param']>().toEqualTypeOf<'order_id' | 'line'>();
    expectTypeOf<Get['param']['order_id']>().toEqualTypeOf<string>();
    expectTypeOf<Get['param']['line']>().toEqualTypeOf<string>();
    type Patch = InferRequestType<Item['$patch']>;
    expectTypeOf<keyof Patch['param']>().toEqualTypeOf<'order_id' | 'line'>();
    expectTypeOf<Patch['json']['sku']>().toEqualTypeOf<string | undefined>();
    // The key columns are input, as a non-generated single key is (D33).
    expectTypeOf<Patch['json']['line']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<InferResponseType<Item['$get'], 200>>().toEqualTypeOf<
      PublicRow<typeof kitchen.order_items>
    >();
    const typeOnly = () => {
      const item = hc<typeof routes>('http://blendx.test').order_items[':order_id'][':line'];
      item.$get({ param: { order_id: '1', line: '2' } });
      // @ts-expect-error every segment of the key is needed
      item.$get({ param: { order_id: '1' } });
    };
    expect(typeOnly).toBeFunction();
  });

  test('hidden columns are not in the reply type', () => {
    type Shown = InferResponseType<Client['users'][':id']['$get'], 200>;
    expectTypeOf<'password' extends keyof Shown ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'email' extends keyof Shown ? true : false>().toEqualTypeOf<true>();
  });

  test('a client narrows the body by status and rejects wrong input', () => {
    const typeOnly = async () => {
      const client = hc<typeof routes>('http://blendx.test');
      const res = await client.addition_results.$post({ json: { a: 1, b: 2 } });
      if (res.status === 201) {
        const row = await res.json();
        expectTypeOf(row.result).toEqualTypeOf<number | null>();
      }
      if (res.status === 422) {
        const problem = await res.json();
        expectTypeOf(problem.title).toEqualTypeOf<string>();
        expectTypeOf(problem.status).toEqualTypeOf<ProblemDetails['status']>();
      }
      // @ts-expect-error b must be a number
      await client.addition_results.$post({ json: { a: 1, b: '2' } });
    };
    expect(typeOnly).toBeFunction();
  });
});
