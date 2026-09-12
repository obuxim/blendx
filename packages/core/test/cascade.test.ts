/**
 * P4.3: the cascade. Each stage starts at the schema default and runs the app, resource
 * and action hooks in that order; a hook replaces the value it receives or extends it.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  type App,
  allow,
  blend,
  defineApp,
  type EffectDefaults,
  type Reply,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { z } from 'zod';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
});

const loaded = { id: 7, user_id: 42, status: 'paid', quantity: 1 };
const defaults: EffectDefaults = {
  load: async () => {
    calls.push('default load');
    return loaded;
  },
  save: async ({ writes }) => {
    calls.push(`default save ${JSON.stringify(writes)}`);
    return { ...loaded, ...writes };
  },
};

const loadInput = { db: {} as never, params: { id: '7' }, query: {}, auth: null };
const saveInput = { tx: {} as never, writes: { quantity: 2 }, record: loaded, auth: null };
const reply: Reply = { status: 200, body: { id: 7 } };

function resolve(resource: Resource, action: string, app: App = defineApp({})) {
  const endpoint = toEndpoints(resource).find((e) => e.action === action);
  if (!endpoint) throw new Error(`no ${action}`);
  return resolveEndpoint(endpoint, { app, defaults });
}

describe('without hooks every stage is the schema default', () => {
  const orders = blend(shop.orders, {
    policy: allow.public,
    actions: (a) => [a.store(), a.update()],
  });

  test('rules, authorize, calculate and respond', async () => {
    const store = resolve(orders, 'store');
    expect(store.provenance.rules).toEqual(['schema']);
    expect(store.rules.safeParse({ user_id: 1, total: '1' }).success).toBe(true);
    expect(store.rules.safeParse({ user_id: 1, total: '1', id: 1 }).success).toBe(false);
    expect(await store.authorize({ auth: null, record: undefined, input: {} })).toBe(true);
    expect(store.calculate({ prev: { total: '1' }, input: {}, record: undefined })).toEqual({
      total: '1',
    });
    expect(store.respond({ prev: reply, record: undefined, result: {} })).toBe(reply);
  });

  test('load and save run the defaults', async () => {
    const update = resolve(orders, 'update');
    expect(await update.load(loadInput)).toBe(loaded);
    expect(await update.save(saveInput)).toEqual({ ...loaded, quantity: 2 });
    expect(calls).toEqual(['default load', 'default save {"quantity":2}']);
  });
});

describe('rules', () => {
  test('each level receives the rules of the level above: schema, app, resource, action', () => {
    const traced = <T extends z.ZodType>(prev: T, field: string) =>
      (prev instanceof z.ZodObject ? prev.extend({ [field]: z.string().optional() }) : prev) as T;
    const app = defineApp({ hooks: { rules: ({ prev }) => traced(prev, 'trace_id') } });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: { rules: ({ prev }) => traced(prev, 'note') },
      actions: (a) => [a.store({ rules: ({ prev }) => prev.extend({ coupon: z.string() }) })],
    });
    const store = resolve(orders, 'store', app);
    const valid = { user_id: 1, total: '1', trace_id: 't', note: 'n', coupon: 'c' };
    expect(store.rules.safeParse(valid).success).toBe(true);
    expect(store.rules.safeParse({ ...valid, coupon: undefined }).success).toBe(false);
    expect(store.rules.safeParse({ ...valid, other: 1 }).success).toBe(false);
    expect(store.provenance.rules).toEqual(['schema', 'app', 'resource', 'action']);
  });

  test('an action can replace the defaults; a plain object is made strict', () => {
    const replaced = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.store({ rules: () => z.object({ a: z.number(), b: z.number() }) }),
        a.member('tag', { rules: () => z.object({ tag: z.string() }).loose() }),
      ],
    });
    const store = resolve(replaced, 'store');
    expect(store.rules.parse({ a: 4, b: 3 })).toEqual({ a: 4, b: 3 });
    expect(store.rules.safeParse({ a: 4, b: 3, c: 1 }).success).toBe(false);
    expect(resolve(replaced, 'tag').rules.parse({ tag: 'x', extra: 1 })).toEqual({
      tag: 'x',
      extra: 1,
    });
  });
});

describe('authorize', () => {
  test('the policy decides first, then app, resource and action hooks run in order', async () => {
    const app = defineApp({
      hooks: {
        authorize: ({ prev }) => {
          calls.push(`app got ${prev}`);
          return true;
        },
      },
    });
    const orders = blend(shop.orders, {
      policy: allow.owner('user_id'),
      hooks: {
        authorize: ({ prev }) => {
          calls.push(`resource got ${prev}`);
          return prev;
        },
      },
      actions: (a) => [
        a.update({
          authorize: ({ prev, record }) => {
            calls.push(`action got ${prev}`);
            return prev && record.status !== 'refunded';
          },
        }),
      ],
    });
    const update = resolve(orders, 'update', app);
    const stranger = { auth: { id: 1 }, input: {} };

    expect(await update.authorize({ ...stranger, record: loaded })).toBe(true);
    expect(calls).toEqual(['app got false', 'resource got true', 'action got true']);
    expect(await update.authorize({ ...stranger, record: { ...loaded, status: 'refunded' } })).toBe(
      false,
    );
    expect(update.provenance.authorize).toEqual(['schema', 'app', 'resource', 'action']);
  });
});

describe('calculate', () => {
  test('an action extends the default writes or replaces them', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({ calculate: ({ prev, record }) => ({ ...prev, quantity: record.quantity + 1 }) }),
        a.member('reset', { calculate: () => ({ quantity: 0 }) }),
      ],
    });
    expect(
      resolve(orders, 'update').calculate({ prev: { status: 'paid' }, input: {}, record: loaded }),
    ).toEqual({ status: 'paid', quantity: 2 });
    expect(
      resolve(orders, 'reset').calculate({ prev: { status: 'paid' }, input: {}, record: loaded }),
    ).toEqual({ quantity: 0 });
  });
});

describe('respond', () => {
  test('app, resource and action each receive the reply so far', () => {
    const app = defineApp({
      hooks: { respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'x-api': '1' } }) },
    });
    const orders = blend(shop.orders, {
      policy: allow.public,
      hooks: {
        respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'x-resource': 'orders' } }),
      },
      actions: (a) => [a.show({ respond: ({ prev }) => ({ ...prev, status: 203 }) })],
    });
    const show = resolve(orders, 'show', app);
    expect(show.respond({ prev: reply, record: loaded, result: {} })).toEqual({
      status: 203,
      body: { id: 7 },
      headers: { 'x-api': '1', 'x-resource': 'orders' },
    });
    expect(show.provenance.respond).toEqual(['schema', 'app', 'resource', 'action']);
  });
});

describe('load and save', () => {
  test('calling runDefault extends the default, skipping it replaces the default', async () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          load: async ({ runDefault }) => ({ ...(await runDefault()), quantity: 5 }),
          save: async ({ runDefault, writes }) => runDefault({ ...writes, quantity: 9 }),
        }),
        a.show({ load: async () => ({ ...loaded, id: 1 }) }),
      ],
    });
    const update = resolve(orders, 'update');
    expect(await update.load(loadInput)).toEqual({ ...loaded, quantity: 5 });
    expect(await update.save(saveInput)).toEqual({ ...loaded, quantity: 9 });
    expect(calls).toEqual(['default load', 'default save {"quantity":9}']);

    calls.length = 0;
    expect(await resolve(orders, 'show').load(loadInput)).toEqual({ ...loaded, id: 1 });
    expect(calls).toEqual([]);
    expect(update.provenance.load).toEqual(['schema', 'action']);
    expect(update.provenance.calculate).toEqual(['schema']);
  });
});
