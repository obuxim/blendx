/**
 * P6.4: the Node smoke test. The addition example runs on Node through @hono/node-server
 * and the pg driver, and is exercised over real HTTP. It needs Node 24 (type stripping) and
 * DATABASE_URL pointing at a scratch database, whose public schema it resets:
 *
 *   DATABASE_URL=postgres://postgres@localhost:5432/blendx_test node packages/hono/test/node/smoke.ts
 *
 * It exits 0 when every check passes.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { allow, blend, type Db, defineApp, PROBLEM_CONTENT_TYPE } from '@blendx/core';
import { type BlendxEnv, createServer, run } from '@blendx/hono';
import { serve } from '@hono/node-server';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { z } from 'zod';
import { addition_results, models } from '../../../dbml/test/golden/addition.schema.gen.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('node smoke: set DATABASE_URL to a scratch database');
  process.exit(1);
}

const additions = blend(models.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
    a.destroy(),
  ],
});

const routes = new Hono<BlendxEnv>()
  .post('/addition_results', ...run(additions, 'store'))
  .get('/addition_results/:id', ...run(additions, 'show'))
  .delete('/addition_results/:id', ...run(additions, 'destroy'));

const pool = new Pool({ connectionString: url });
await pool.query('drop schema if exists public cascade; create schema public');
const empty = await generateDrizzleJson({});
for (const statement of await generateMigration(
  empty,
  await generateDrizzleJson({ addition_results }),
)) {
  await pool.query(statement);
}

const db = drizzle({ client: pool }) as unknown as Db;
const app = createServer({ app: defineApp({}), db, routes });
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }) as Server;
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const send = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    text,
    json: () => JSON.parse(text) as Record<string, unknown>,
  };
};

try {
  const created = await send('POST', '/addition_results', { a: 4, b: 3 });
  assert.equal(created.status, 201, created.text);
  assert.partialDeepStrictEqual(created.json(), { id: 1, result: 7 });

  const shown = await send('GET', '/addition_results/1');
  assert.equal(shown.status, 200, shown.text);
  assert.partialDeepStrictEqual(shown.json(), { id: 1, result: 7, deleted_at: null });

  const invalid = await send('POST', '/addition_results', { a: 'four' });
  assert.equal(invalid.status, 422, invalid.text);
  assert.ok(invalid.type.startsWith(PROBLEM_CONTENT_TYPE), invalid.type);
  assert.partialDeepStrictEqual(invalid.json(), { errors: [{ pointer: '/a' }, { pointer: '/b' }] });

  const malformed = await send('POST', '/addition_results', '{"a":');
  assert.equal(malformed.status, 400, malformed.text);

  const destroyed = await send('DELETE', '/addition_results/1');
  assert.equal(destroyed.status, 204, destroyed.text);
  assert.equal(destroyed.text, '');

  const gone = await send('GET', '/addition_results/1');
  assert.equal(gone.status, 404, gone.text);
  assert.ok(gone.type.startsWith(PROBLEM_CONTENT_TYPE), gone.type);

  console.log(`node smoke: ok on Node ${process.version}`);
} finally {
  server.closeAllConnections();
  server.close();
  await pool.end();
}
