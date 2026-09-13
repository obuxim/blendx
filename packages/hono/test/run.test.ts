/**
 * P6.2: run() is the controller behind each route. Every action of the addition example
 * works over hand-written routes on PGlite; errors come back as Problem Details.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { allow, blend, defineApp, PROBLEM_CONTENT_TYPE } from '@blendx/core';
import { type BlendxEnv, createServer, run } from '@blendx/hono';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  goldenSchema,
  migratedDatabase,
  type TestDatabase,
} from '../../core/test/support/database.ts';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';

const additions = blend(addition.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
    a.update(),
    a.replace(),
    a.destroy(),
    a.restore(),
    a.purge(),
  ],
});

const routes = new Hono<BlendxEnv>()
  .get('/addition_results', ...run(additions, 'index'))
  .post('/addition_results', ...run(additions, 'store'))
  .get('/addition_results/:id', ...run(additions, 'show'))
  .patch('/addition_results/:id', ...run(additions, 'update'))
  .put('/addition_results/:id', ...run(additions, 'replace'))
  .delete('/addition_results/:id', ...run(additions, 'destroy'))
  .post('/addition_results/:id/restore', ...run(additions, 'restore'))
  .delete('/addition_results/:id/purge', ...run(additions, 'purge'));

let database: TestDatabase;
let server: Hono<BlendxEnv>;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('addition'));
  server = createServer({ app: defineApp({}), db: database.db, routes });
}, 60_000);
afterAll(() => database.close());

const send = (method: string, path: string, body?: unknown) =>
  server.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

describe('run(): the addition example over hand-written routes', () => {
  test('POST creates: 201 with the saved row as JSON', async () => {
    const created = await send('POST', '/addition_results', { a: 4, b: 3 });
    expect(created.status).toBe(201);
    expect(created.headers.get('content-type')).toStartWith('application/json');
    expect(await created.json()).toMatchObject({ id: 1, result: 7 });
  });

  test('GET lists rows in the page envelope', async () => {
    const listed = await send('GET', '/addition_results?per_page=10');
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      data: [{ id: 1, result: 7 }],
      meta: { page: 1, per_page: 10, total: 1 },
    });
  });

  test('GET /:id shows the row and PATCH /:id updates it', async () => {
    expect(await (await send('GET', '/addition_results/1')).json()).toMatchObject({ id: 1 });
    const updated = await send('PATCH', '/addition_results/1', { result: 10 });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: 1, result: 10 });
  });

  test('PUT /:id replaces the row: a column left out is reset (D34)', async () => {
    const replaced = await send('PUT', '/addition_results/1', { result: 12 });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ id: 1, result: 12 });
    const reset = await send('PUT', '/addition_results/1', {});
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ id: 1, result: null });
  });

  test('DELETE /:id answers 204 with no body; show no longer finds the row', async () => {
    const destroyed = await send('DELETE', '/addition_results/1');
    expect(destroyed.status).toBe(204);
    expect(await destroyed.text()).toBe('');
    expect((await send('GET', '/addition_results/1')).status).toBe(404);
  });

  test('POST /:id/restore brings it back', async () => {
    const restored = await send('POST', '/addition_results/1/restore');
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: 1, deleted_at: null });
  });

  test('DELETE /:id/purge deletes for good: 204, and restore no longer finds the row (D29)', async () => {
    const purged = await send('DELETE', '/addition_results/1/purge');
    expect(purged.status).toBe(204);
    expect(await purged.text()).toBe('');
    expect((await send('POST', '/addition_results/1/restore')).status).toBe(404);
    expect(await (await send('GET', '/addition_results')).json()).toMatchObject({
      meta: { total: 0 },
    });
  });

  test('errors are problems: 422 invalid input, 400 malformed JSON, 404 unknown id', async () => {
    const invalid = await send('POST', '/addition_results', { a: 'four' });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get('content-type')).toStartWith(PROBLEM_CONTENT_TYPE);
    expect(await invalid.json()).toMatchObject({ errors: [{ pointer: '/a' }, { pointer: '/b' }] });

    const malformed = await send('POST', '/addition_results', '{"a":');
    expect(malformed.status).toBe(400);

    expect((await send('GET', '/addition_results/999')).status).toBe(404);
  });
});

test('run() refuses an action the resource does not expose', () => {
  expect(() => run(additions, 'publish' as never)).toThrow(
    'addition_results has no action "publish"',
  );
});
