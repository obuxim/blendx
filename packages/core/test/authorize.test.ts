/**
 * P4.4: the policy is the schema-level authorize decision, and it says up front whether a
 * request needs an identity, so the engine can answer 401 before validating.
 */
import { describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defineApp,
  deny,
  type EffectDefaults,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const defaults: EffectDefaults = { load: async () => undefined, save: async () => undefined };
const order = { id: 7, user_id: 42 } as never;

function resolve(resource: Resource, action: string) {
  const endpoint = toEndpoints(resource).find((e) => e.action === action);
  if (!endpoint) throw new Error(`no ${action}`);
  return resolveEndpoint(endpoint, { app: defineApp({}), defaults });
}

describe('the policy as the schema-level authorize stage', () => {
  test('requiresAuth comes from each action policy', () => {
    const orders = blend(shop.orders, {
      policy: {
        default: allow.owner('user_id'),
        index: allow.public,
        store: allow.authenticated,
        quote: allow.when(() => true),
      },
      actions: (a) => [a.index(), a.store(), a.show(), a.collection('quote')],
    });
    expect(
      ['index', 'store', 'show', 'quote'].map((name) => resolve(orders, name).requiresAuth),
    ).toEqual([false, true, true, false]);
  });

  test('deny refuses every request unless an explicit hook replaces its decision', async () => {
    const locked = blend(shop.orders, {
      policy: deny,
      actions: (a) => [a.show(), a.update({ authorize: () => true })],
    });
    const request = { auth: { id: 1 }, record: order, input: {} };
    expect(await resolve(locked, 'show').authorize(request)).toBe(false);
    expect(resolve(locked, 'show').provenance.authorize).toEqual(['schema']);
    expect(await resolve(locked, 'update').authorize(request)).toBe(true);
  });

  test('the policy sees the identity, the record, the validated input and the action', async () => {
    const seen: unknown[] = [];
    const orders = blend(shop.orders, {
      policy: allow.when((context) => {
        seen.push(context);
        return true;
      }),
      actions: (a) => [a.update()],
    });
    await resolve(orders, 'update').authorize({
      auth: { id: 42 },
      record: order,
      input: { quantity: 2 },
    });
    expect(seen).toEqual([
      { auth: { id: 42 }, record: order, input: { quantity: 2 }, action: 'update' },
    ]);
  });

  test('an owner policy allows the owner and refuses everyone else', async () => {
    const orders = blend(shop.orders, {
      policy: allow.owner('user_id'),
      actions: (a) => [a.show()],
    });
    const show = resolve(orders, 'show');
    expect(await show.authorize({ auth: { id: 42 }, record: order, input: {} })).toBe(true);
    expect(await show.authorize({ auth: { id: 41 }, record: order, input: {} })).toBe(false);
    expect(await show.authorize({ auth: null, record: order, input: {} })).toBe(false);
  });
});
