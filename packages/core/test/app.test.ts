import { describe, expect, expectTypeOf, test } from 'bun:test';
import {
  AppActionDefinitionError,
  allow,
  BlendxConfigError,
  defineApp,
  multipart,
  type RegisteredAuth,
} from '@blendx/core';
import { z } from 'zod';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';

describe('defineApp', () => {
  test('defaults to 25 rows per page and at most 100', () => {
    const app = defineApp({});
    expect(app.kind).toBe('blendx/app');
    expect(app.index).toEqual({ perPage: 25, maxPerPage: 100 });
  });

  test('custom index limits', () => {
    expect(defineApp({ index: { perPage: 50, maxPerPage: 200 } }).index).toEqual({
      perPage: 50,
      maxPerPage: 200,
    });
  });

  test('rejects index limits that make no sense', () => {
    expect(() => defineApp({ index: { perPage: 0 } })).toThrow(
      new BlendxConfigError('index.perPage and index.maxPerPage must be positive integers'),
    );
    expect(() => defineApp({ index: { perPage: 200 } })).toThrow(
      new BlendxConfigError('index.perPage (200) is larger than index.maxPerPage (100)'),
    );
  });

  test('keeps the spec as written, including auth', () => {
    const auth = async () => ({ id: 1 });
    expect(defineApp({ auth }).spec.auth).toBe(auth);
  });

  test('app hooks must keep the type they receive', () => {
    const typeOnly = () => {
      defineApp({
        hooks: {
          rules: ({ prev }) => prev,
          respond: ({ prev }) => ({ ...prev, headers: { 'x-api-version': '1' } }),
        },
      });
      defineApp({
        hooks: {
          // @ts-expect-error an app hook runs for every table, so it cannot change the reply type
          respond: () => ({ status: 200, body: {} }),
        },
      });
    };
    expect(typeOnly).toBeFunction();
  });

  test('app hooks see the identity that auth returns', () => {
    type Identity = { id: number; suspended: boolean };
    const app = defineApp({
      auth: ({ request }): Identity | null =>
        request.headers.has('authorization') ? { id: 1, suspended: false } : null,
      hooks: {
        authorize: ({ prev, auth }) => {
          expectTypeOf(auth).toEqualTypeOf<Identity | null>();
          return prev && auth?.suspended !== true;
        },
      },
    });
    const authorize = app.spec.hooks?.authorize;
    if (!authorize) throw new Error('the app has an authorize hook');
    const context = { prev: true, model: {} as never, action: 'store' };
    expect(authorize({ ...context, auth: { id: 1, suspended: true } })).toBe(false);
    expect(authorize({ ...context, auth: { id: 1, suspended: false } })).toBe(true);
    expect(authorize({ ...context, auth: null })).toBe(true);
  });

  test('without auth, app hooks see no identity', () => {
    defineApp({
      hooks: {
        authorize: ({ prev, auth }) => {
          expectTypeOf(auth).toEqualTypeOf<null>();
          return prev;
        },
      },
    });
  });

  test('without a registered app, auth is unknown', () => {
    expectTypeOf<RegisteredAuth>().toEqualTypeOf<unknown>();
  });

  test('freezes typed app actions with their stable route and declared writes (D37)', () => {
    const app = defineApp({
      auth: (): { id: number } => ({ id: 1 }),
      actions: (a) => [
        a.action('health', {
          method: 'get',
          path: '/health',
          policy: allow.public,
          input: z.object({}),
          reply: { status: 200, body: z.object({ ok: z.literal(true) }) },
          handler: ({ db }) => {
            expectTypeOf(db).toExtend<object>();
            return { status: 200, body: { ok: true as const } };
          },
        }),
        a.action('accept_invite', {
          method: 'post',
          path: '/invites/:token/accept',
          policy: allow.authenticated,
          input: z.object({ note: z.string().optional() }),
          reply: { status: 200, body: z.object({ accepted: z.literal(true) }) },
          writes: [models.orders, models.users],
          handler: ({ auth, input, params, tx }) => {
            expectTypeOf(auth).toEqualTypeOf<{ id: number } | null>();
            expectTypeOf(input).toEqualTypeOf<{ note?: string | undefined }>();
            expectTypeOf(params.token).toEqualTypeOf<string | undefined>();
            expectTypeOf(tx).toExtend<object>();
            return { status: 200, body: { accepted: true as const } };
          },
        }),
      ],
    });
    expect(app.actions).toHaveLength(2);
    expect(app.actions[1]).toMatchObject({
      id: 'app.accept_invite',
      method: 'post',
      path: '/invites/:token/accept',
      writes: ['orders', 'users'],
    });
    expect(Object.isFrozen(app.actions)).toBe(true);
    expect(Object.isFrozen(app.actions[1])).toBe(true);
  });

  test('app actions reject invalid route, policy, and write declarations', () => {
    const action = (name: string, spec: Record<string, unknown>) =>
      defineApp({ actions: (a) => [a.action(name, spec as never)] });
    const valid = {
      method: 'post',
      path: '/invites/:token/accept',
      policy: allow.public,
      input: z.object({}),
      reply: { status: 200, body: z.object({ ok: z.literal(true) }) },
      writes: [models.users],
      handler: () => ({ status: 200, body: { ok: true as const } }),
    };
    expect(() => action('AcceptInvite', valid)).toThrow(AppActionDefinitionError);
    expect(() => action('accept_invite', { ...valid, method: undefined })).toThrow(
      'app.accept_invite method must be an explicit HTTP method',
    );
    expect(() => action('accept_invite', { ...valid, policy: undefined })).toThrow(
      'app.accept_invite requires a policy',
    );
    expect(() => action('accept_invite', { ...valid, input: undefined })).toThrow(
      'app.accept_invite input must be a Zod schema',
    );
    expect(() => action('accept_invite', { ...valid, reply: undefined })).toThrow(
      'app.accept_invite reply must declare a status and Zod body schema',
    );
    expect(() => action('accept_invite', { ...valid, path: 'invites' })).toThrow(
      'app.accept_invite path must be an absolute Hono path with valid :segments',
    );
    expect(() => action('accept_invite', { ...valid, policy: allow.owner('id') })).toThrow(
      'app.accept_invite owner policy requires a resource record',
    );
    expect(() =>
      action('accept_invite', {
        ...valid,
        policy: { kind: 'member', requiresAuth: true, description: 'member', check: () => true },
      }),
    ).toThrow('app.accept_invite member policy requires a resource record');
    expect(() => action('accept_invite', { ...valid, writes: [] })).toThrow(
      'app.accept_invite writing actions require a non-empty writes declaration',
    );
    expect(() =>
      action('accept_invite', { ...valid, writes: [models.users, models.users] }),
    ).toThrow('app.accept_invite writes declares users more than once');
    expect(() => action('lookup', { ...valid, method: 'get', writes: [models.users] })).toThrow(
      'app.lookup GET actions cannot declare writes',
    );
    expect(() =>
      action('upload', {
        ...valid,
        input: multipart(z.object({ file: z.file() }), { maxBytes: 10 }),
        method: 'get',
        writes: undefined,
      }),
    ).toThrow('app.upload multipart input requires POST, PUT, or PATCH');
    expect(() => multipart(z.object({}), { maxBytes: 0 })).toThrow(
      'multipart maxBytes must be a positive finite number',
    );
  });
});
