/**
 * P8.2 (and P8.4): the addition example end to end, through the same app, generated routes
 * and committed migrations that server.ts serves. PGlite in memory by default; with
 * BLENDX_TEST_DB=pg it runs on DATABASE_URL, whose public and drizzle schemas it resets.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase, createServer, type Database, PROBLEM_CONTENT_TYPE } from 'blendx';
import { sql } from 'blendx/drizzle';
import app from '../src/app.ts';
import { routes } from '../src/generated/routes.gen.ts';

const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

let database: Database;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  database = await createDatabase({
    database: realPostgres
      ? { driver: 'pg', url: undefined }
      : { driver: 'pglite', url: undefined },
  });
  if (realPostgres) {
    await database.db.execute(sql.raw('drop schema if exists drizzle cascade'));
    await database.db.execute(sql.raw('drop schema if exists public cascade'));
    await database.db.execute(sql.raw('create schema public'));
  }
  await database.migrate(join(import.meta.dir, '..', 'drizzle'));
  server = createServer({ app, db: database.db, routes });
}, 30_000);
afterAll(() => database.close());

const send = (method: string, path: string, body?: unknown) =>
  server.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe(`addition example on ${realPostgres ? 'PostgreSQL' : 'PGlite'}`, () => {
  test('POST {a: 4, b: 3} stores result 7 and answers 201', async () => {
    const created = await send('POST', '/addition_results', { a: 4, b: 3 });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 1, result: 7, deleted_at: null });
  });

  test('a wrong type is a 422 problem that points at the field', async () => {
    const invalid = await send('POST', '/addition_results', { a: 'four', b: 3 });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get('content-type')).toStartWith(PROBLEM_CONTENT_TYPE);
    expect(await invalid.json()).toMatchObject({ status: 422, errors: [{ pointer: '/a' }] });
  });

  test('an unknown key is a 422 too: result cannot be sent, only calculated', async () => {
    const smuggled = await send('POST', '/addition_results', { a: 4, b: 3, result: 99 });
    expect(smuggled.status).toBe(422);
    expect(await smuggled.json()).toMatchObject({ errors: [{ pointer: '/result' }] });
  });

  test('show finds the row; an unknown id is a 404 problem', async () => {
    expect(await (await send('GET', '/addition_results/1')).json()).toMatchObject({
      id: 1,
      result: 7,
    });
    const missing = await send('GET', '/addition_results/999');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toStartWith(PROBLEM_CONTENT_TYPE);
  });

  test('actions the blend does not list are not routed', async () => {
    expect((await send('PATCH', '/addition_results/1', { result: 1 })).status).toBe(404);
  });

  test('destroy soft-deletes: 204, then gone from index and show', async () => {
    const destroyed = await send('DELETE', '/addition_results/1');
    expect(destroyed.status).toBe(204);
    expect(await destroyed.text()).toBe('');
    expect(await (await send('GET', '/addition_results')).json()).toMatchObject({
      data: [],
      meta: { total: 0 },
    });
    expect((await send('GET', '/addition_results/1')).status).toBe(404);
  });

  test('restore brings it back', async () => {
    const restored = await send('POST', '/addition_results/1/restore');
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: 1, result: 7, deleted_at: null });
    expect(await (await send('GET', '/addition_results')).json()).toMatchObject({
      data: [{ id: 1, result: 7 }],
      meta: { page: 1, per_page: 25, total: 1 },
    });
  });
});
