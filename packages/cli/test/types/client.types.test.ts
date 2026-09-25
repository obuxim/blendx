/**
 * N.1a, N.8: the generated table map and AppType, emitted from the same blends, name the same
 * routes. The React adapter (D25) finds an action's types by looking its entry up in AppType,
 * and follows each table's includes when it invalidates.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import type { Hono } from 'hono';
import type { tables } from '../golden/client.gen.ts';
import type { AppType } from '../golden/routes.gen.ts';

type Tables = typeof tables;
type Schema = AppType extends Hono<infer _Env, infer S, infer _Base> ? S : never;

/** Every action route of the map, as `METHOD /path`. */
type Entries = {
  [T in keyof Tables]: Tables[T]['actions'][keyof Tables[T]['actions']] extends {
    readonly route: infer Route;
  }
    ? Route
    : never;
}[keyof Tables];

/** Every route of AppType, as `METHOD /path`; hono keys a path's methods as `$get`. */
type Routes = {
  [P in keyof Schema & string]: {
    [K in keyof Schema[P] & string]: K extends `$${infer M}` ? `${Uppercase<M>} ${P}` : never;
  }[keyof Schema[P] & string];
}[keyof Schema & string];

describe('client.gen.ts tables', () => {
  test('its action entries are exactly the routes of AppType', () => {
    expectTypeOf<Entries>().toEqualTypeOf<Routes>();
  });

  test('action descriptors keep literal route and related-write types', () => {
    expectTypeOf<
      Tables['orders']['actions']['quote']['route']
    >().toEqualTypeOf<'GET /orders/quote'>();
    expectTypeOf<
      Tables['orders']['actions']['refund']['route']
    >().toEqualTypeOf<'POST /orders/:id/refund'>();
    expectTypeOf<Tables['orders']['actions']['refund']['writes']>().toEqualTypeOf<
      readonly ['users']
    >();
    expectTypeOf<Tables['orders']['actions']['index']['sorts']>().toEqualTypeOf<
      readonly [
        'id',
        'user_id',
        'status',
        'public_id',
        'created_at',
        '-id',
        '-user_id',
        '-status',
        '-public_id',
        '-created_at',
      ]
    >();
  });

  test('includes name the table each relation points to, and are {} without any', () => {
    expectTypeOf<Tables['orders']['includes']>().toEqualTypeOf<{
      readonly notes: 'order_notes';
      readonly user: 'users';
    }>();
    expectTypeOf<Tables['users']['includes']>().toEqualTypeOf<Record<never, never>>();
  });

  test('the key lists the primary key columns and whether JSON carries each as a number (D30, D33)', () => {
    expectTypeOf<Tables['orders']['key']>().toEqualTypeOf<
      readonly [{ readonly column: 'id'; readonly type: 'number' }]
    >();
  });
});
