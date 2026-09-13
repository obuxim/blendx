/**
 * The typed client that docs/guide/http.md shows: hc<AppType> over the expenses routes, driven
 * through server.request on PGlite. Importing AppType from server.ts is type-only, so the
 * server itself never starts.
 */
import { afterAll, beforeAll, expect, expectTypeOf, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase, createServer, type Database } from 'blendx';
import { hc } from 'blendx/client';
import type { AppType } from '../server.ts';
import app from '../src/app.ts';
import { routes } from '../src/generated/routes.gen.ts';

let database: Database;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  await database.migrate(join(import.meta.dir, '..', 'drizzle'));
  server = createServer({ app, db: database.db, routes });
}, 30_000);
afterAll(() => database.close());

/** A client for the in-process server, signed in when given a token. */
function clientFor(token?: string) {
  // hc's fetch option is typed as typeof fetch, which in Bun has extra members.
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    server.request(input, init)) as typeof globalThis.fetch;
  return hc<AppType>('http://localhost:3000', {
    fetch,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const lunch = {
  description: 'Team lunch',
  category: 'meals',
  amount: '40.00',
  spent_on: '2026-09-01',
} as const;

test('sign up, file, submit and quote, typed by the routes', async () => {
  const signed = await clientFor().users.$post({ json: { email: 'ada@example.com', name: 'Ada' } });
  expect(signed.status).toBe(201);
  if (signed.status !== 201) return;
  const ada = await signed.json();
  expectTypeOf(ada.api_token).toEqualTypeOf<string>();

  const client = clientFor(ada.api_token);
  const filed = await client.expenses.$post({ json: lunch });
  expect(filed.status).toBe(201);
  if (filed.status !== 201) return;
  const claim = await filed.json();
  expectTypeOf(claim.status).toEqualTypeOf<'draft' | 'submitted' | 'approved' | 'rejected'>();
  expect(claim).toMatchObject({ user_id: ada.id, tax: '4.00', total: '44.00' });

  // A custom action without rules still takes a JSON body: an empty one.
  const submitted = await client.expenses[':id'].submit.$post({
    param: { id: String(claim.id) },
    json: {},
  });
  expect(submitted.status).toBe(200);

  const quoted = await client.expenses.quote.$get({ query: { amount: '10', category: 'office' } });
  expect(quoted.status).toBe(200);
  if (quoted.status === 200) expect(await quoted.json()).toEqual({ tax: '2.00', total: '12.00' });
});

test('input is typed, and a refusal is a typed problem', async () => {
  expect((await clientFor().expenses.$post({ json: lunch })).status).toBe(401);

  const signed = await clientFor().users.$post({ json: { email: 'bob@example.com', name: 'Bob' } });
  if (signed.status !== 201) throw new Error(`sign-up answered ${signed.status}`);
  const client = clientFor((await signed.json()).api_token);
  // @ts-expect-error the category must be one of the enum's values
  const invalid = await client.expenses.$post({ json: { ...lunch, category: 'food' } });
  expect(invalid.status).toBe(422);
  if (invalid.status === 422) {
    const problem = await invalid.json();
    expectTypeOf(problem.title).toEqualTypeOf<string>();
    expect(problem.errors?.[0]?.pointer).toBe('/category');
  }
});

test('actions the blends do not list are not on the client', () => {
  type Users = ReturnType<typeof clientFor>['users'];
  expectTypeOf<'$get' extends keyof Users ? true : false>().toEqualTypeOf<false>();
});
