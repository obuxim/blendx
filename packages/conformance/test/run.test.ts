/**
 * P11.2: runConformance against a small in-memory API, so the runner is tested without a
 * database or blendx: reset per case, steps in order, captures, and readable failures.
 */
import { describe, expect, test } from 'bun:test';
import type { ConformanceCase } from '../src/case.ts';
import { runConformance } from '../src/run.ts';

/** POST /items, GET and DELETE /items/:id, with Problem Details for a missing item. */
function itemsApi() {
  let items: { id: number; name: string }[] = [];
  let next = 1;
  const requests: string[] = [];
  return {
    requests,
    reset: () => {
      items = [];
      next = 1;
    },
    fetch: async (request: Request) => {
      const { pathname } = new URL(request.url);
      requests.push(`${request.method} ${pathname}`);
      if (request.method === 'POST' && pathname === '/items') {
        const { name } = (await request.json()) as { name: string };
        const item = { id: next++, name };
        items.push(item);
        return Response.json(item, { status: 201 });
      }
      const id = Number(pathname.match(/^\/items\/(\d+)$/)?.[1]);
      const item = items.find((candidate) => candidate.id === id);
      if (request.method === 'DELETE' && item) {
        items = items.filter((candidate) => candidate !== item);
        return new Response(null, { status: 204 });
      }
      if (request.method === 'GET' && item) return Response.json(item);
      if (request.method === 'GET') {
        return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        });
      }
      return new Response('not allowed', { status: 405 });
    },
  };
}

const lifecycle: ConformanceCase = {
  id: 'ITEM-LIFECYCLE',
  title: 'create, show, delete, and then it is gone',
  steps: [
    {
      request: { method: 'POST', path: '/items', body: { name: 'pen' } },
      expect: { status: 201, body: { id: '$int', name: 'pen' } },
      capture: { item: '/id' },
    },
    {
      request: { method: 'GET', path: '/items/{item}' },
      expect: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { name: 'pen' },
      },
    },
    {
      request: { method: 'DELETE', path: '/items/{item}' },
      expect: { status: 204, body: '$absent' },
    },
    {
      request: { method: 'GET', path: '/items/{item}' },
      expect: { status: 404, headers: { 'content-type': 'application/problem+json' } },
    },
  ],
};

describe('runConformance', () => {
  test('steps run in order, captures fill later paths, and the case passes', async () => {
    const api = itemsApi();
    const result = await runConformance([lifecycle], api.fetch, { reset: api.reset });
    expect(result).toEqual({
      passed: 1,
      failed: [],
      results: [{ id: 'ITEM-LIFECYCLE', title: lifecycle.title, problems: [] }],
    });
    expect(api.requests).toEqual([
      'POST /items',
      'GET /items/1',
      'DELETE /items/1',
      'GET /items/1',
    ]);
  });

  test('every case starts from reset', async () => {
    const api = itemsApi();
    const first: ConformanceCase = {
      id: 'FIRST-ID',
      title: 'the first item gets id 1',
      steps: [
        {
          request: { method: 'POST', path: '/items', body: { name: 'a' } },
          expect: { status: 201, body: { id: 1 } },
        },
      ],
    };
    const result = await runConformance([first, { ...first, id: 'FIRST-ID-AGAIN' }], api.fetch, {
      reset: api.reset,
    });
    expect(result.passed).toBe(2);
  });

  test('a failing step names the step and what differed, and ends the case', async () => {
    const api = itemsApi();
    const wrong: ConformanceCase = {
      id: 'WRONG',
      title: 'expects the wrong status and name',
      steps: [
        {
          request: { method: 'POST', path: '/items', body: { name: 'pen' } },
          expect: { status: 200, body: { name: 'pencil' } },
        },
        { request: { method: 'GET', path: '/items/1' }, expect: { status: 200 } },
      ],
    };
    const result = await runConformance([wrong, lifecycle], api.fetch, { reset: api.reset });
    expect(result.passed).toBe(1);
    expect(result.failed).toEqual([
      {
        id: 'WRONG',
        title: wrong.title,
        problems: [
          'step 1 (POST /items): status: expected 200, got 201',
          'step 1 (POST /items): /name: expected "pencil", got "pen"',
        ],
      },
    ]);
    expect(api.requests.slice(0, 2)).toEqual(['POST /items', 'POST /items']);
  });

  test('a path needing a value nobody captured, or a capture that finds nothing', async () => {
    const api = itemsApi();
    const result = await runConformance(
      [
        {
          id: 'NO-CAPTURE',
          title: 'uses {item} without capturing it',
          steps: [{ request: { method: 'GET', path: '/items/{item}' }, expect: { status: 200 } }],
        },
        {
          id: 'EMPTY-CAPTURE',
          title: 'captures a key the reply lacks',
          steps: [
            {
              request: { method: 'POST', path: '/items', body: { name: 'pen' } },
              expect: { status: 201 },
              capture: { owner: '/owner/id' },
            },
          ],
        },
      ],
      api.fetch,
      { reset: api.reset },
    );
    expect(result.failed.map((failure) => failure.problems)).toEqual([
      ['step 1 (GET /items/{item}): nothing captured as {item}'],
      ['step 1 (POST /items): nothing at /owner/id to capture as {owner}'],
    ]);
    expect(api.requests).toEqual(['POST /items']);
  });

  test('a body that is not JSON is compared as text', async () => {
    const api = itemsApi();
    const result = await runConformance(
      [
        {
          id: 'TEXT',
          title: 'an unsupported method answers plain text',
          steps: [
            {
              request: { method: 'PATCH', path: '/items/1', body: {} },
              expect: { status: 405, body: 'not allowed' },
            },
          ],
        },
      ],
      api.fetch,
      { reset: api.reset },
    );
    expect(result.passed).toBe(1);
  });
});
