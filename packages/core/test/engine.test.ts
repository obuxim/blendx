/**
 * P5.2: the engine's walking skeleton. The addition example runs end to end on PGlite,
 * and failures come back as Problem Details in pipeline order (401, 422, 404, 403).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  allow,
  blend,
  defaultEffects,
  defineApp,
  type ExecuteRequest,
  execute,
  PROBLEM_CONTENT_TYPE,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { goldenSchema, migratedDatabase, type TestDatabase } from './support/database.ts';

let database: TestDatabase;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('addition'));
}, 60_000);
afterAll(() => database.close());

const app = defineApp({});

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

const additions = blend(addition.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
  ],
});

describe('the addition example, end to end', () => {
  test('POST { a: 4, b: 3 } answers 201 with the saved record', async () => {
    const created = await execute(
      endpoint(additions, 'store'),
      request({ body: { a: 4, b: 3 } }),
      database,
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, result: 7, deleted_at: null });
    const body = created.body as { created_at: unknown; updated_at: unknown };
    expect(typeof body.created_at).toBe('string');
    expect(body.updated_at).toBe(body.created_at);
  });

  test('GET /:id loads it back', async () => {
    const shown = await execute(
      endpoint(additions, 'show'),
      request({ params: { id: '1' } }),
      database,
    );
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ id: 1, result: 7 });
  });
});

describe('failures are Problem Details, in pipeline order', () => {
  test('422 lists each invalid field with a JSON pointer', async () => {
    const invalid = await execute(
      endpoint(additions, 'store'),
      request({ body: { a: 'four', c: 1 } }),
      database,
    );
    expect(invalid.status).toBe(422);
    expect(invalid.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE);
    const errors = (invalid.body as { errors: { pointer: string }[] }).errors;
    expect(errors.map((error) => error.pointer)).toEqual(['/a', '/b', '/c']);
  });

  test('404 when the record does not exist', async () => {
    const missing = await execute(
      endpoint(additions, 'show'),
      request({ params: { id: '999' } }),
      database,
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({
      title: 'Not Found',
      detail: 'addition_results not found',
    });
  });

  test('401 comes before validation when the policy needs an identity', async () => {
    const guarded = blend(addition.addition_results, {
      policy: allow.authenticated,
      actions: (a) => [a.store()],
    });
    const anonymous = await execute(
      endpoint(guarded, 'store'),
      request({ body: { result: 'not a number' } }),
      database,
    );
    expect(anonymous.status).toBe(401);
  });

  test('403 when the policy refuses an identified request', async () => {
    const closed = blend(addition.addition_results, {
      policy: allow.when(() => false),
      actions: (a) => [a.show()],
    });
    const refused = await execute(
      endpoint(closed, 'show'),
      request({ params: { id: '1' }, auth: { id: 1 } }),
      database,
    );
    expect(refused.status).toBe(403);
  });
});
