/**
 * P15.8: reveal (D24). An action that replies with one record may carry hidden columns it
 * names; every other reply, index pages included, still leaves them out. The engine,
 * OpenAPI and the review say which replies carry them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  type ActionBuilder,
  allow,
  BlendxDefinitionError,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  type Resource,
  resolveEndpoint,
  reviewResource,
  toEndpoints,
} from '@blendx/core';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { buildOpenApi, type JsonObject } from '../src/openapi.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'));
}, 60_000);
afterAll(() => database.close());

const app = defineApp({});

const users = blend(shop.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [
    a.index(),
    a.store({ reveal: ['password'] }),
    a.show(),
    a.member('rotate', { reveal: ['password'], calculate: () => ({ password: 'rotated' }) }),
  ],
});

function endpoint(resource: Resource, action: string) {
  const found = toEndpoints(resource).find((e) => e.action === action);
  if (!found) throw new Error(`no ${action}`);
  return resolveEndpoint(found, { app, defaults: defaultEffects(found) });
}

const request = (overrides: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  params: {},
  query: {},
  body: undefined,
  auth: null,
  ...overrides,
});

const at = (value: unknown, ...keys: string[]): JsonObject =>
  keys.reduce((node, key) => (node as JsonObject)[key], value) as JsonObject;

describe('reveal (D24)', () => {
  test('the revealing actions reply with the column; show and index still leave it out', async () => {
    const created = await execute(
      endpoint(users, 'store'),
      request({ body: { email: 'ada@example.com', password: 'ada-secret' } }),
      database,
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, password: 'ada-secret' });

    const rotated = await execute(
      endpoint(users, 'rotate'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(rotated.body).toMatchObject({ id: 1, password: 'rotated' });

    const shown = await execute(
      endpoint(users, 'show'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(shown.body).not.toHaveProperty('password');
    const listed = await execute(endpoint(users, 'index'), request(), database);
    expect((listed.body as { data: object[] }).data[0]).not.toHaveProperty('password');
  });

  test('OpenAPI: a revealing reply is the record and what it reveals; others use the component', () => {
    const { document } = buildOpenApi({
      app,
      resources: [users],
      info: { title: 'reveal', version: '1' },
    });
    const schema = (path: string, method: string, status: string) =>
      at(document, 'paths', path, method, 'responses', status, 'content', 'application/json');
    expect(Object.keys(at(schema('/users', 'post', '201'), 'schema', 'properties'))).toContain(
      'password',
    );
    expect(schema('/users/{id}', 'get', '200').schema).toEqual({
      $ref: '#/components/schemas/users',
    });
    const component = at(document, 'components', 'schemas', 'users', 'properties');
    expect(Object.keys(component)).not.toContain('password');
  });

  test('the review lists what an action reveals, and its reply says so', () => {
    const review = reviewResource(users, app);
    const store = review.actions.find((action) => action.name === 'store');
    expect(store?.reveals).toEqual(['password']);
    expect(store?.reply).toEqual({ status: 201, body: 'the record, with password' });
    expect(review.actions.find((action) => action.name === 'show')?.reveals).toBeUndefined();
    expect(review.hidden).toEqual(['password']);
    expect(Object.keys(review.record)).not.toContain('password');
  });

  test('reveal names hidden columns, on an action that replies with one record', () => {
    const define =
      (actions: (a: ActionBuilder<typeof shop.users, 'password'>) => unknown[]) => () =>
        blend(shop.users, {
          policy: allow.public,
          hidden: ['password'],
          actions: actions as never,
        });
    expect(define((a) => [a.store({ reveal: ['email'] as never })])).toThrow(
      new BlendxDefinitionError('users', 'action "store" reveals "email", which is not hidden'),
    );
    for (const [name, action] of [
      [
        'index',
        (a: ActionBuilder<typeof shop.users, 'password'>) =>
          a.index({ reveal: ['password'] } as never),
      ],
      [
        'destroy',
        (a: ActionBuilder<typeof shop.users, 'password'>) =>
          a.destroy({ reveal: ['password'] } as never),
      ],
      [
        'ping',
        (a: ActionBuilder<typeof shop.users, 'password'>) =>
          a.collection('ping', { reveal: ['password'], calculate: () => ({}) } as never),
      ],
    ] as const) {
      expect(define((a) => [action(a)])).toThrow(
        new BlendxDefinitionError(
          'users',
          `action "${name}" cannot reveal: it does not reply with one record`,
        ),
      );
    }
  });
});
