/** P7.1: the generated AppType gives hc every route's types. */
import { describe, expectTypeOf, test } from 'bun:test';
import type { hc, InferRequestType, InferResponseType } from 'hono/client';
import type { AppType } from '../golden/routes.gen.ts';

type Client = ReturnType<typeof hc<AppType>>;

describe('routes.gen.ts AppType', () => {
  test('a custom GET collection action: its rules as the query, its result as the body', () => {
    type Quote = Client['orders']['quote']['$get'];
    expectTypeOf<InferRequestType<Quote>>().toEqualTypeOf<{ query: { quantity: string } }>();
    expectTypeOf<InferResponseType<Quote, 200>>().toEqualTypeOf<{ total: number }>();
  });

  test('a custom member action takes the id and its rules as JSON', () => {
    type Refund = InferRequestType<Client['orders'][':id']['refund']['$post']>;
    expectTypeOf<Refund['param']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Refund['json']>().toEqualTypeOf<{ reason: string }>();
  });

  test('hidden columns stay out of replies', () => {
    type Shown = InferResponseType<Client['users'][':id']['$get'], 200>;
    expectTypeOf<'password' extends keyof Shown ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'email' extends keyof Shown ? true : false>().toEqualTypeOf<true>();
  });
});
