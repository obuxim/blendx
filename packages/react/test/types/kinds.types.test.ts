/**
 * N.4: parity with hc for every kind of action. An inline app on the shop fixture's orders
 * lists each kind once: the built-in actions, and custom member and collection actions of
 * every method, with and without rules. Its map is written out as `blendx generate` would
 * write it, and checked against toEndpoints at run time. Each action's input and data are
 * compared with hc's for its route, so a wrong entry fails too. useTypesOnly is only
 * typechecked, never called.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { useMutation } from '@tanstack/react-query';
import { allow, blend, router, run, z } from 'blendx';
import { hc, type InferRequestType, type InferResponseType } from 'blendx/client';
import { models } from '../../../conformance/fixtures/shop/src/generated/schema.gen.ts';
import { toEndpoints } from '../../../core/src/index.ts';
import { createBlendxClient } from '../../src/index.ts';

const kinds = blend(models.orders, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store(),
    a.show(),
    a.update(),
    a.destroy(),
    a.restore(),
    a.purge(),
    a.member('refund', {
      rules: () => z.object({ reason: z.string() }),
      calculate: () => ({ status: 'refunded' as const }),
    }),
    a.member('cancel'),
    a.member('history', { method: 'get' }),
    a.member('reprice', { method: 'patch', rules: () => z.object({ total: z.string() }) }),
    a.member('void', { method: 'delete' }),
    a.collection('quote', {
      method: 'get',
      rules: () => z.object({ quantity: z.string() }),
      calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
    }),
    a.collection('estimate', {
      rules: () => z.object({ quantity: z.number() }),
      calculate: ({ input }) => ({ total: input.quantity * 10 }),
      reply: z.object({ total: z.number() }),
    }),
    a.collection('recount', { calculate: () => ({ counted: true }) }),
  ],
});

const routes = router()
  .get('/orders', ...run(kinds, 'index'))
  .post('/orders', ...run(kinds, 'store'))
  .post('/orders/estimate', ...run(kinds, 'estimate'))
  .get('/orders/quote', ...run(kinds, 'quote'))
  .post('/orders/recount', ...run(kinds, 'recount'))
  .get('/orders/:id', ...run(kinds, 'show'))
  .patch('/orders/:id', ...run(kinds, 'update'))
  .delete('/orders/:id', ...run(kinds, 'destroy'))
  .post('/orders/:id/restore', ...run(kinds, 'restore'))
  .delete('/orders/:id/purge', ...run(kinds, 'purge'))
  .post('/orders/:id/cancel', ...run(kinds, 'cancel'))
  .get('/orders/:id/history', ...run(kinds, 'history'))
  .post('/orders/:id/refund', ...run(kinds, 'refund'))
  .patch('/orders/:id/reprice', ...run(kinds, 'reprice'))
  .delete('/orders/:id/void', ...run(kinds, 'void'));

const endpoints = {
  orders: {
    index: 'GET /orders',
    store: 'POST /orders',
    estimate: 'POST /orders/estimate',
    quote: 'GET /orders/quote',
    recount: 'POST /orders/recount',
    show: 'GET /orders/:id',
    update: 'PATCH /orders/:id',
    destroy: 'DELETE /orders/:id',
    restore: 'POST /orders/:id/restore',
    purge: 'DELETE /orders/:id/purge',
    cancel: 'POST /orders/:id/cancel',
    history: 'GET /orders/:id/history',
    refund: 'POST /orders/:id/refund',
    reprice: 'PATCH /orders/:id/reprice',
    void: 'DELETE /orders/:id/void',
  },
} as const;

const client = hc<typeof routes>('http://localhost');
const api = createBlendxClient(client, endpoints);
type Orders = typeof client.orders;
type Member = Orders[':id'];
type Api = (typeof api)['orders'];

/** What a query resolves to, read off its options as TanStack reads them. */
type QueryData<O> = O extends { queryFn?: infer Fn }
  ? NonNullable<Fn> extends (...args: never[]) => infer R
    ? Awaited<R>
    : never
  : never;

/** What a mutation takes and resolves to, read off its options. */
type MutationOf<O> = O extends { mutationFn?: infer Fn }
  ? NonNullable<Fn> extends (variables: infer V, ...rest: never[]) => Promise<infer D>
    ? { variables: V; data: D }
    : never
  : never;

type Query<A extends keyof Api> = Api[A] extends { queryOptions: (...args: never[]) => infer O }
  ? QueryData<O>
  : never;
type Mutation<A extends keyof Api> = Api[A] extends {
  mutationOptions: (...args: never[]) => infer O;
}
  ? MutationOf<O>
  : never;

/** hc's input and success data for a route's function. */
type Hc<F, Status extends 200 | 201 | 204> = {
  variables: InferRequestType<F>;
  data: InferResponseType<F, Status>;
};

function useTypesOnly() {
  // recount takes no input, so mutate() takes no argument.
  useMutation(api.orders.recount.mutationOptions()).mutate();
}

describe('every kind of action', () => {
  test('the map is the one blendx generate writes for this blend', () => {
    const generated = toEndpoints(kinds).map((endpoint): [string, string] => [
      endpoint.action,
      `${endpoint.method.toUpperCase()} ${endpoint.path}`,
    ]);
    expect(Object.entries<string>(endpoints.orders)).toEqual(generated);
  });

  test('a GET action is a query, any other method a mutation', () => {
    type Kind<A> = A extends { queryOptions: unknown } ? 'query' : 'mutation';
    expectTypeOf<{ [A in keyof Api]: Kind<Api[A]> }>().toEqualTypeOf<{
      readonly index: 'query';
      readonly store: 'mutation';
      readonly estimate: 'mutation';
      readonly quote: 'query';
      readonly recount: 'mutation';
      readonly show: 'query';
      readonly update: 'mutation';
      readonly destroy: 'mutation';
      readonly restore: 'mutation';
      readonly purge: 'mutation';
      readonly cancel: 'mutation';
      readonly history: 'query';
      readonly refund: 'mutation';
      readonly reprice: 'mutation';
      readonly void: 'mutation';
    }>();
  });

  test('queries take hc input and resolve to hc data', () => {
    expectTypeOf(api.orders.index.queryOptions).parameters.toEqualTypeOf<
      [input?: InferRequestType<Orders['$get']>]
    >();
    expectTypeOf<Query<'index'>>().toEqualTypeOf<InferResponseType<Orders['$get'], 200>>();

    expectTypeOf(api.orders.show.queryOptions).parameters.toEqualTypeOf<
      [input: InferRequestType<Member['$get']>]
    >();
    expectTypeOf<Query<'show'>>().toEqualTypeOf<InferResponseType<Member['$get'], 200>>();

    type History = Member['history']['$get'];
    expectTypeOf(api.orders.history.queryOptions).parameters.toEqualTypeOf<
      [input: InferRequestType<History>]
    >();
    expectTypeOf<Query<'history'>>().toEqualTypeOf<InferResponseType<History, 200>>();

    type Quote = Orders['quote']['$get'];
    expectTypeOf(api.orders.quote.queryOptions).parameters.toEqualTypeOf<
      [input: InferRequestType<Quote>]
    >();
    expectTypeOf<Query<'quote'>>().toEqualTypeOf<InferResponseType<Quote, 200>>();
    expectTypeOf<Query<'quote'>>().toEqualTypeOf<{ total: number }>();
  });

  test('built-in mutations take hc input and resolve to hc data', () => {
    expectTypeOf<Mutation<'store'>>().toEqualTypeOf<Hc<Orders['$post'], 201>>();
    expectTypeOf<Mutation<'update'>>().toEqualTypeOf<Hc<Member['$patch'], 200>>();
    expectTypeOf<Mutation<'destroy'>>().toEqualTypeOf<Hc<Member['$delete'], 204>>();
    expectTypeOf<Mutation<'destroy'>['data']>().toEqualTypeOf<null>();
    expectTypeOf<Mutation<'restore'>>().toEqualTypeOf<Hc<Member['restore']['$post'], 200>>();
    expectTypeOf<Mutation<'purge'>>().toEqualTypeOf<Hc<Member['purge']['$delete'], 204>>();
    expectTypeOf<Mutation<'purge'>['data']>().toEqualTypeOf<null>();
  });

  test('custom mutations of every method take hc input and resolve to hc data', () => {
    expectTypeOf<Mutation<'refund'>>().toEqualTypeOf<Hc<Member['refund']['$post'], 200>>();
    expectTypeOf<Mutation<'cancel'>>().toEqualTypeOf<Hc<Member['cancel']['$post'], 200>>();
    // Without rules, a member action takes only the id.
    expectTypeOf<Mutation<'cancel'>['variables']>().toEqualTypeOf<{ param: { id: string } }>();
    expectTypeOf<Mutation<'reprice'>>().toEqualTypeOf<Hc<Member['reprice']['$patch'], 200>>();
    // A custom DELETE replies with the record, not 204.
    expectTypeOf<Mutation<'void'>>().toEqualTypeOf<Hc<Member['void']['$delete'], 200>>();
    expectTypeOf<Mutation<'estimate'>>().toEqualTypeOf<Hc<Orders['estimate']['$post'], 200>>();
    expectTypeOf<Mutation<'estimate'>['data']>().toEqualTypeOf<{ total: number }>();
    expectTypeOf<Mutation<'recount'>['data']>().toEqualTypeOf<
      InferResponseType<Orders['recount']['$post'], 200>
    >();
    expectTypeOf<Mutation<'recount'>['data']>().toEqualTypeOf<{ counted: boolean }>();
    expectTypeOf(useTypesOnly).toBeFunction();
  });
});
