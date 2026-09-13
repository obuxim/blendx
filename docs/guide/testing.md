# Testing

blendx is tested by blendx: validation from the schema, the pipeline, errors and transactions all have tests and conformance cases. An app tests its own decisions: its policies, its rules, its calculations. Three layers cover them, from cheapest to most complete.

## 1. The typecheck

`bunx tsc --noEmit` catches most mistakes in a blend before anything runs:

- `calculate`'s input is typed from `rules`, so a field the rules do not accept is an error;
- `calculate` may return only writable columns of its table;
- a `pick`, `hidden` or `allow.owner` that names a column the table does not have is an error;
- a declared `reply` must match what the action sends;
- `auth` in every hook and policy has the type your `auth` function returns.

## 2. The review examples

`review/<table>.examples.yaml` pins down validation and calculation with concrete cases ([Review](review.md#examples)). They run without a database, so they are fast, and `blendx review --check` runs them. To also run them with `bun test`, add one test, as [`examples/expenses/test/examples.test.ts`](../../examples/expenses/test/examples.test.ts) does:

```ts
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkExamples } from '@blendx/cli/examples';

test('review/*.examples.yaml hold', async () => {
  const result = await checkExamples(join(import.meta.dir, '..'));
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(16);
});
```

Checking the count too means an example that stopped being read fails the test.

## 3. HTTP tests on PGlite

The rest (policies, authorize hooks, save hooks, what the database refuses) needs requests. `createServer` returns a Hono app, and its `request()` runs a request in-process, so a test needs no port and no running server. PGlite in memory gives each test file a fresh database.

From [`examples/expenses/test/api.test.ts`](../../examples/expenses/test/api.test.ts):

```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase, createServer, type Database } from 'blendx';
import app from '../src/app.ts';
import { routes } from '../src/generated/routes.gen.ts';

let database: Database;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  await database.migrate(join(import.meta.dir, '..', 'drizzle'));
  server = createServer({ app, db: database.db, routes });
});
afterAll(() => database.close());

const send = (method: string, path: string, token?: string, body?: unknown) =>
  server.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
```

The test uses the same app, the same generated routes and the same committed migrations as `server.ts`, so it tests what will be served.

What to test is what the app decided. For the expenses app:

- who may do what: a claim is shown to its claimant and to approvers, and to nobody else (403);
- state rules: a submitted claim cannot be edited or deleted; nobody approves their own;
- what comes from the identity: the claimant is the signed-in user, whatever the body says;
- what the client may not send: `user_id`, `total` and `status` are refused (422).

### Identities in tests

Get identities the way clients do. The expenses tests sign up through `POST /users` and use the tokens in the replies. What the API cannot do, such as making someone an approver, the test does in the database, through the generated models:

```ts
import { sql } from 'blendx/drizzle';
import { models } from '../src/generated/schema.gen.ts';

const users = models.users.table;
await database.db.update(users).set({ is_approver: true }).where(sql`${users.id} = ${cy.id}`);
```

An app whose identity comes from an outside provider can let tests put a test identity in a header; the [conformance fixture](../../packages/conformance/fixtures/shop/src/app.ts) reads `x-user-id`. Keep such a shortcut out of production.

### On real PostgreSQL

PGlite is PostgreSQL, but a test run on your production database's version is worth having in CI. The examples switch on an environment variable:

```ts
const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

database = await createDatabase({
  database: realPostgres ? { driver: 'pg', url: undefined } : { driver: 'pglite', url: undefined },
});
if (realPostgres) {
  await database.db.execute(sql.raw('drop schema if exists drizzle cascade'));
  await database.db.execute(sql.raw('drop schema if exists public cascade'));
  await database.db.execute(sql.raw('create schema public'));
}
```

With `url: undefined`, the `pg` driver reads `DATABASE_URL`. The reset drops everything in that database, so point it at a scratch database: `BLENDX_TEST_DB=pg DATABASE_URL=postgres://postgres@localhost:5432/myapp_test bun test`.

## The typed client in tests

`hc<AppType>` gives a client whose calls are typed by the routes ([The HTTP API](http.md#the-typed-client)). To drive the in-process server with it, pass the server's `request` as its `fetch`, as [`examples/expenses/test/client.test.ts`](../../examples/expenses/test/client.test.ts) does:

```ts
import { hc } from 'blendx/client';
import type { AppType } from '../server.ts';

// hc's fetch option is typed as typeof fetch, which in Bun has extra members.
const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  server.request(input, init)) as typeof globalThis.fetch;
const client = hc<AppType>('http://localhost', { fetch });
```

Importing `AppType` from `server.ts` is type-only, so the server does not start.

## In CI

```sh
bunx blendx generate --check   # the generated files match the schema and blends
bunx blendx review --check     # the review files match, and every example holds
bunx tsc --noEmit
bun test
```
