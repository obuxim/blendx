/**
 * P16.1 (D26): through createServer, an after hook's failure goes to the server's onError, and
 * the reply is the success the write already earned.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { allow, blend, defineApp } from '@blendx/core';
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
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
      after: () => {
        throw new Error('webhook unreachable');
      },
    }),
  ],
});

const routes = new Hono<BlendxEnv>().post('/addition_results', ...run(additions, 'store'));

const errors: unknown[] = [];
let database: TestDatabase;
let server: Hono<BlendxEnv>;
beforeAll(async () => {
  database = await migratedDatabase(goldenSchema('addition'));
  server = createServer({
    app: defineApp({}),
    db: database.db,
    routes,
    onError: (error) => errors.push(error),
  });
}, 60_000);
afterAll(() => database.close());

test("an after hook's failure goes to the server's onError, and the reply stands", async () => {
  const created = await server.request('/addition_results', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: 4, b: 3 }),
  });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ result: 7 });
  expect(errors).toHaveLength(1);
  expect((errors[0] as Error).message).toBe('webhook unreachable');
});
