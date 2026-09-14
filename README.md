# blendx

An API-only TypeScript framework where the only code anyone writes is business logic. You write `schema.dbml` and one small blend per exposed table; blendx derives the validation, loading, authorization, saving, replies, routes, typed client and OpenAPI document from them. It is built for a world where AI agents write most of the code: fewer output tokens, a smaller codebase for every later task to read, and less for a human to review.

blendx is the successor to [larablend](https://github.com/obuxim/larablend) (Laravel, 2020). It keeps larablend's idea, derive everything from the schema and write only what differs, and fixes its flaws: input is validated strictly on the server, nothing is exposed unless listed, and you override a single stage instead of a whole action.

**Status:** version 0, on npm from 0.1.0 (`bun add blendx`, then `bun add -d @blendx/cli`; [getting started](docs/guide/getting-started.md)). The API may still change. What does not work yet is in [known issues](docs/guide/known-issues.md).

## A whole app

`schema.dbml`:

```dbml
Table addition_results {
  id int [pk, increment]
  result double
  created_at timestamp
  updated_at timestamp
  deleted_at timestamp
}
```

`blends/addition_results.ts`, the only logic in the app:

```ts
import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
    a.destroy(),
    a.restore(),
  ],
});
```

That gives these routes:

| Route | Action |
|---|---|
| `GET /addition_results` | index: paginated, sortable, filterable on key and indexed columns |
| `POST /addition_results` | store: validates `{ a, b }`, stores `result = a + b` |
| `GET /addition_results/:id` | show |
| `DELETE /addition_results/:id` | destroy: a soft delete, because the table has `deleted_at` |
| `POST /addition_results/:id/restore` | restore |

`POST /addition_results {"a": 4, "b": 3}` replies `201`:

```json
{
  "id": 1,
  "result": 7,
  "created_at": "2026-09-13 10:53:43.609",
  "updated_at": "2026-09-13 10:53:43.609",
  "deleted_at": null
}
```

`{"a": 4, "b": "three", "c": 1}` replies `422` with RFC 9457 Problem Details, one entry per field:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "The request did not pass validation.",
  "errors": [
    { "pointer": "/b", "detail": "Invalid input: expected number, received string" },
    { "pointer": "/c", "detail": "is not an accepted field" }
  ]
}
```

The full app is in [`examples/addition`](examples/addition).

## What you write, what is generated

| Path | Owner |
|---|---|
| `schema.dbml` | you: tables, columns, keys, indexes |
| `blends/<table>.ts` | you: per table, what differs from the defaults |
| `src/app.ts` | you: identity (`auth`) and app-wide hooks |
| `src/generated/` | generated: the Drizzle schema, routes, the `AppType` and the endpoint map for clients, the drizzle-kit config, `openapi.json` |
| `drizzle/` | generated: SQL migrations, through drizzle-kit |
| `review/<table>.yaml` | generated for human review (below) |
| `review/<table>.examples.yaml` | the humans': inputs and the outputs they expect |

Nobody reads or edits generated files. `blendx generate --check` fails when they are out of date.

## How a request runs

Every endpoint runs the same pipeline:

**authenticate → validate → load → authorize → calculate → save → after → respond**

Failures take this precedence: 401, then 422, 404, 403 and 409. Mutations run in one transaction, and a member action locks its row. `after` runs once a write has committed. Each stage has a default derived from the schema, and each can be changed by a hook at the app, the resource or the action; the most specific level wins.

- `rules`, `authorize`, `calculate` and `respond` receive the level above's value as `prev` and return the replacement.
- `load` and `save` receive `runDefault()`: call it to extend the default, skip it to replace it.
- `calculate({ input, record })` is pure and synchronous. Its input type comes from `rules`, and it may return only columns of its table; `tsc` rejects anything else.

Security is on by default. Every blend needs a `policy` (`allow.public`, `allow.authenticated`, `allow.owner('user_id')`, `allow.when(fn)` or `deny`), only listed actions exist, unknown input keys are refused, and generated columns can never be written.

## Review without reading code

`blendx review` writes `review/<table>.yaml`: what every action accepts, what each stage does and where that came from, calculate's source, and the reply. An excerpt from the example:

```yaml
  store:
    route: POST /addition_results
    input:
      a: number
      b: number
    stages:
      rules: the insert columns, without generated ones # from: schema, action
      load: nothing
      authorize: public
      calculate: the input's writable columns # from: schema, action
      save: insert, setting created_at and updated_at
      respond: 201 with the saved record
    calculate:
      source: |-
        ({ input }) => ({ result: input.a + input.b })
      writes: [result]
```

A reviewer who wants a change edits this file, or adds an example to `review/<table>.examples.yaml`. `blendx review --check` then fails with the diff, and the blend is changed (by a developer or an agent) until the check passes again. The YAML is never input; it is only ever compared.

## Typed client

`AppType` from the generated routes gives a [Hono RPC](https://hono.dev/docs/guides/rpc) client each route's input and its replies by status:

```ts
import { hc } from 'blendx/client';
import type { AppType } from './server.ts';

const client = hc<AppType>('http://localhost:3000');
const res = await client.addition_results.$post({ json: { a: 4, b: 3 } });
if (res.status === 201) {
  const row = await res.json(); // row.result is number | null
}
```

## Commands

An app depends on `blendx` and, as a dev dependency, on `@blendx/cli`, which provides the `blendx` command: `bun add blendx`, then `bun add -d @blendx/cli`. Both are on npm at one shared version; keep them equal when you upgrade.

- `bunx blendx generate [--check]`: after changing the schema, a blend or `src/app.ts`.
- `bunx blendx migrate generate --name <what_changed>`, then `bunx blendx migrate up`.
- `bunx blendx review [--check]`: rewrites the review files; `--check` fails on drift and runs the examples.

## Runtimes and databases

PostgreSQL only. Drivers: `pg` (the default), `postgres-js`, `bun-sql` and `pglite`, each an optional dependency you install only when you choose it. The same conformance suite runs on Bun with PGlite, Bun with pg, Bun with bun-sql and Node 24 with pg. The CLI needs Bun.

## Documentation

- [`docs/guide`](docs/guide): the guide to building an app with blendx: [getting started](docs/guide/getting-started.md), a [tutorial](docs/guide/tutorial.md) that builds [`examples/expenses`](examples/expenses) from an empty folder, and a page for each part (schema, blends, hooks, identity, the HTTP API, review, testing, deployment, the CLI).
- [`examples/addition/CLAUDE.md`](examples/addition/CLAUDE.md): the template for an app's `CLAUDE.md`, the guide an agent works from.
- [`docs/cookbook.md`](docs/cookbook.md): seventeen blend patterns, from hiding a column to nesting related rows.
- [`packages/spec`](packages/spec): the normative spec: [pipeline](packages/spec/pipeline.md), [cascade](packages/spec/cascade.md), [errors](packages/spec/errors.md), [derivation rules](packages/spec/derivation-rules.md), [review format](packages/spec/review-format.md) and [conformance](packages/spec/conformance.md). Each rule links to the tests that prove it.
- [`docs/decisions.md`](docs/decisions.md): why things are the way they are.
- [`docs/releasing.md`](docs/releasing.md): how a version reaches npm.

## Packages

| Package | |
|---|---|
| `blendx` | what an app imports at runtime: `blend`, `allow`, `z`, `defineApp`, `defineConfig`, `createServer`, `createDatabase`; `blendx/client` for `hc` |
| `@blendx/cli` | the `blendx` command, and `checkExamples` for an app's tests |
| `@blendx/core` | the portable core: endpoint definitions, the cascade, rule derivation, the engine, OpenAPI and the review model |
| `@blendx/dbml` | DBML to the generated Drizzle schema |
| `@blendx/hono` | the Hono adapter |
| `@blendx/conformance` | request and expected-response cases, and their runner |
| `@blendx/react` | TanStack Query options for every action, reached by table and action name |

`@blendx/core` and `@blendx/dbml` import neither Bun, Node nor Hono, so another runtime or server can reuse them.

## Working on blendx

Requires Bun 1.4.2. For the Node checks, Node 24 and a scratch PostgreSQL database.

```sh
bun install
bun run check   # Biome, tsc, generated files up to date, bun test
```

`docs/todo.md` drives the work, and `CLAUDE.md` holds the rules for contributing, whether you are a person or an agent. The API, the React adapter and the deferred features of phase P16 are done; a new feature starts as an entry in `docs/decisions.md` and an item in the todo.

## License

[MIT](LICENSE)
