/**
 * P6.1: createServer. Identity and database reach every route, unknown routes and errors
 * answer as Problem Details, and a malformed JSON body is a 400.
 */
import { describe, expect, test } from 'bun:test';
import { type Db, defineApp, HttpProblem, PROBLEM_CONTENT_TYPE, problem } from '@blendx/core';
import { type BlendxEnv, createServer, readJson } from '@blendx/hono';
import { Hono } from 'hono';

const db = { name: 'fake db' } as unknown as Db;

const app = defineApp({
  auth: async ({ request }) => {
    const token = request.headers.get('authorization');
    return token === 'Bearer ada' ? { id: 1, name: 'Ada' } : null;
  },
  problems: { typeBase: 'https://errors.example.com' },
});

const routes = new Hono<BlendxEnv>()
  .get('/whoami', (c) => {
    const { auth, db: handle } = c.get('blendx');
    return c.json({ auth, sameDb: handle === db });
  })
  .get('/boom', () => {
    throw new Error('secret connection string');
  })
  .get('/conflict', () => {
    throw new HttpProblem(problem(409, { detail: 'already there' }));
  })
  .post('/echo', async (c) => c.json({ body: (await readJson(c)) ?? null }));

const errors: unknown[] = [];
const server = createServer({ app, db, routes, onError: (error) => errors.push(error) });

describe('createServer', () => {
  test('resolves the identity for every request and hands routes the database', async () => {
    const signedIn = await server.request('/whoami', { headers: { authorization: 'Bearer ada' } });
    expect(await signedIn.json()).toEqual({ auth: { id: 1, name: 'Ada' }, sameDb: true });
    const anonymous = await server.request('/whoami');
    expect(await anonymous.json()).toEqual({ auth: null, sameDb: true });
  });

  test('an unknown route answers a 404 problem', async () => {
    const response = await server.request('/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toStartWith(PROBLEM_CONTENT_TYPE);
    expect(await response.json()).toEqual({
      type: 'https://errors.example.com/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'No route for GET /nope',
    });
  });

  test('an unexpected error answers a 500 problem without leaking its message', async () => {
    const response = await server.request('/boom');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('secret');
    expect(JSON.parse(text)).toMatchObject({ title: 'Internal Server Error', status: 500 });
    expect((errors.at(-1) as Error).message).toBe('secret connection string');
  });

  test('a thrown HttpProblem answers with that problem', async () => {
    const response = await server.request('/conflict');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ title: 'Conflict', detail: 'already there' });
  });

  test('malformed JSON is a 400 problem; an empty body is undefined', async () => {
    const malformed = await server.request('/echo', { method: 'POST', body: '{"a":' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ detail: 'The request body is not valid JSON.' });

    const empty = await server.request('/echo', { method: 'POST' });
    expect(await empty.json()).toEqual({ body: null });

    const valid = await server.request('/echo', { method: 'POST', body: '{"a":1}' });
    expect(await valid.json()).toEqual({ body: { a: 1 } });
  });

  test('routes mount under basePath', async () => {
    const api = createServer({ app: defineApp({}), db, routes, basePath: '/api' });
    expect((await api.request('/api/whoami')).status).toBe(200);
    expect((await api.request('/whoami')).status).toBe(404);
  });
});
