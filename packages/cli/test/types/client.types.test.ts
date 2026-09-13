/**
 * N.1a: the generated endpoint map and AppType, emitted from the same blends, name the same
 * routes. The React adapter (D25) finds an action's types by looking its entry up in AppType.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import type { Hono } from 'hono';
import type { endpoints } from '../golden/client.gen.ts';
import type { AppType } from '../golden/routes.gen.ts';

type Endpoints = typeof endpoints;
type Schema = AppType extends Hono<infer _Env, infer S, infer _Base> ? S : never;

/** Every entry of the map, as `METHOD /path`. */
type Entries = { [T in keyof Endpoints]: Endpoints[T][keyof Endpoints[T]] }[keyof Endpoints];

/** Every route of AppType, as `METHOD /path`; hono keys a path's methods as `$get`. */
type Routes = {
  [P in keyof Schema & string]: {
    [K in keyof Schema[P] & string]: K extends `$${infer M}` ? `${Uppercase<M>} ${P}` : never;
  }[keyof Schema[P] & string];
}[keyof Schema & string];

describe('client.gen.ts endpoints', () => {
  test('its entries are exactly the routes of AppType', () => {
    expectTypeOf<Entries>().toEqualTypeOf<Routes>();
  });

  test('entries are literal types', () => {
    expectTypeOf<Endpoints['orders']['quote']>().toEqualTypeOf<'GET /orders/quote'>();
    expectTypeOf<Endpoints['orders']['refund']>().toEqualTypeOf<'POST /orders/:id/refund'>();
  });
});
