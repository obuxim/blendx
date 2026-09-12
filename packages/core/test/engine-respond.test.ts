/**
 * P5.5: default replies through the engine. store answers 201, destroy 204, the rest 200;
 * hidden columns never leave, not even to a respond hook; collection actions answer with
 * what calculate returned; respond hooks at every level shape status, body and headers.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { z } from 'zod';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('shop'));
}, 60_000);
afterAll(() => database.close());

const app = defineApp({
  hooks: { respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'x-api': '1' } }) },
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

let seenByRespond: string[] = [];

const users = blend(shop.users, {
  policy: allow.public,
  hidden: ['password'],
  hooks: {
    respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'x-resource': 'users' } }),
  },
  actions: (a) => [
    a.store(),
    a.show(),
    a.update(),
    a.member('rename', {
      rules: () => z.object({ display_name: z.string() }),
      calculate: ({ input }) => ({ display_name: input.display_name }),
      respond: ({ prev, record }) => {
        seenByRespond = Object.keys(record);
        return { ...prev, status: 202, body: { renamed: record.display_name } };
      },
    }),
    a.collection('ping', { method: 'get', calculate: () => ({ pong: true }) }),
  ],
});

const headersFromHooks = { 'x-api': '1', 'x-resource': 'users' };

describe('default replies', () => {
  test('store answers 201 with the saved row and no hidden columns', async () => {
    const created = await execute(
      endpoint(users, 'store'),
      request({ body: { email: 'ada@example.com', password: 'secret' } }),
      database,
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, email: 'ada@example.com', is_active: true });
    expect(created.body).not.toHaveProperty('password');
    expect(created.headers).toEqual(headersFromHooks);
  });

  test('show and update answer 200 without hidden columns', async () => {
    const shown = await execute(
      endpoint(users, 'show'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(shown.status).toBe(200);
    expect(shown.body).not.toHaveProperty('password');

    const updated = await execute(
      endpoint(users, 'update'),
      request({ params: { id: '1' }, body: { display_name: 'Ada' } }),
      database,
    );
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: 1, display_name: 'Ada' });
    expect(updated.body).not.toHaveProperty('password');
  });

  test('a collection action answers 200 with what calculate returned', async () => {
    const ping = await execute(endpoint(users, 'ping'), request(), database);
    expect(ping).toEqual({ status: 200, body: { pong: true }, headers: headersFromHooks });
  });
});

describe('respond hooks', () => {
  test('see only the public record, and may change the status and body', async () => {
    const renamed = await execute(
      endpoint(users, 'rename'),
      request({ params: { id: '1' }, body: { display_name: 'Ada Lovelace' } }),
      database,
    );
    expect(renamed).toEqual({
      status: 202,
      body: { renamed: 'Ada Lovelace' },
      headers: headersFromHooks,
    });
    expect(seenByRespond).toContain('email');
    expect(seenByRespond).not.toContain('password');
  });
});
