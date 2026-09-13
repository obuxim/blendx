/**
 * P3.5: the Register augmentation carries the app's auth type into policies and hooks.
 * This folder is its own tsconfig project, so the augmentation cannot leak into other
 * tests (module augmentation is global to a TypeScript program).
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import {
  allow,
  blend,
  defineApp,
  type Policy,
  type PolicyContext,
  type RegisteredAuth,
} from '@blendx/core';
import type { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

interface User {
  id: number;
  role: 'admin' | 'member';
}

const app = defineApp({
  auth: async ({ request }): Promise<User | null> =>
    request.headers.has('authorization') ? { id: 1, role: 'admin' } : null,
  hooks: {
    // P15.1: an app hook reads the identity. Typed through Register, this was a circular type.
    authorize: ({ prev, auth, action }) => {
      expectTypeOf(auth).toEqualTypeOf<User | null>();
      return prev && (action !== 'destroy' || auth?.role === 'admin');
    },
  },
});

declare module '@blendx/core' {
  interface Register {
    app: typeof app;
  }
}

type Orders = typeof models.orders;
declare const orders: Orders;

describe('Register', () => {
  test('the registered app decides the auth type', () => {
    expectTypeOf<RegisteredAuth>().toEqualTypeOf<User>();
  });

  test('policies see the registered identity', () => {
    const adminsOnly: Policy<Orders> = allow.when(({ auth }) => {
      expectTypeOf(auth).toEqualTypeOf<User | null>();
      return auth?.role === 'admin';
    });
    expectTypeOf<PolicyContext<Orders>['auth']>().toEqualTypeOf<User | null>();
    expect(adminsOnly.kind).toBe('when');
  });

  test('hooks see the registered identity', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.authenticated,
        actions: (a) => [
          a.update({
            authorize: ({ auth, prev }) => {
              expectTypeOf(auth).toEqualTypeOf<User | null>();
              return prev && auth?.role === 'admin';
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('app hooks see the identity that auth returns', () => {
    const authorize = app.spec.hooks?.authorize;
    if (!authorize) throw new Error('the app has an authorize hook');
    const context = { prev: true, model: {} as never, action: 'destroy' };
    expect(authorize({ ...context, auth: { id: 2, role: 'member' } })).toBe(false);
    expect(authorize({ ...context, auth: { id: 1, role: 'admin' } })).toBe(true);
    // @ts-expect-error the identity is a User, not any object
    authorize({ ...context, auth: { id: 3 } });
  });

  test('auth resolves the identity from the request', async () => {
    const request = new Request('http://blendx.test', { headers: { authorization: 'Bearer x' } });
    expect(await app.spec.auth?.({ request, db: {} as never })).toEqual({ id: 1, role: 'admin' });
    expect(
      await app.spec.auth?.({ request: new Request('http://blendx.test'), db: {} as never }),
    ).toBe(null);
  });
});
