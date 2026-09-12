/**
 * P8.3: a typed hc client for the addition example. AppType, exported by server.ts, gives the
 * client each route's input and its replies by status. The client runs against the real
 * server (through server.request) on PGlite; importing AppType is type-only, so server.ts
 * itself never starts.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase, createServer, type Database } from 'blendx';
import { hc } from 'blendx/client';
import type { AppType } from '../server.ts';
import app from '../src/app.ts';
import { routes } from '../src/generated/routes.gen.ts';

let database: Database;
let client: ReturnType<typeof hc<AppType>>;

beforeAll(async () => {
  database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  await database.migrate(join(import.meta.dir, '..', 'drizzle'));
  const server = createServer({ app, db: database.db, routes });
  // hc's fetch option is typed as typeof fetch, which in Bun has extra members (D9 note).
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    server.request(input, init)) as typeof globalThis.fetch;
  client = hc<AppType>('http://blendx.test', { fetch });
}, 30_000);
afterAll(() => database.close());

describe('hc<AppType> for the addition example', () => {
  test('store: typed input, and the 201 body typed by its status', async () => {
    const res = await client.addition_results.$post({ json: { a: 4, b: 3 } });
    expect(res.status).toBe(201);
    if (res.status === 201) {
      const row = await res.json();
      expectTypeOf(row.result).toEqualTypeOf<number | null>();
      expect(row).toMatchObject({ id: 1, result: 7 });
    }
  });

  test('a 422 reply is a typed problem', async () => {
    // @ts-expect-error b must be a number
    const res = await client.addition_results.$post({ json: { a: 4, b: 'three' } });
    expect(res.status).toBe(422);
    if (res.status === 422) {
      const problem = await res.json();
      expectTypeOf(problem.title).toEqualTypeOf<string>();
      expect(problem.errors?.[0]?.pointer).toBe('/b');
    }
  });

  test('index, show, destroy and restore through the client', async () => {
    const listed = await client.addition_results.$get({ query: {} });
    expect(listed.status).toBe(200);
    if (listed.status === 200) expect((await listed.json()).meta.total).toBe(1);

    const record = client.addition_results[':id'];
    const shown = await record.$get({ param: { id: '1' } });
    expect(shown.status).toBe(200);
    if (shown.status === 200) expect((await shown.json()).result).toBe(7);

    expect((await record.$delete({ param: { id: '1' } })).status).toBe(204);
    expect((await record.$get({ param: { id: '1' } })).status).toBe(404);
    expect((await record.restore.$post({ param: { id: '1' } })).status).toBe(200);
  });

  test('actions the blend does not list are not on the client', () => {
    type Record = (typeof client)['addition_results'][':id'];
    expectTypeOf<'$patch' extends keyof Record ? true : false>().toEqualTypeOf<false>();
  });
});
