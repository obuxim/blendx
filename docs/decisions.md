# Decisions

Short ADR log. Newest last. Each entry: decision, why, consequences. Change a decision by adding a new entry that supersedes the old one.

## D1: Stack (2026-09-13)
TypeScript · Bun (runtime, test runner, workspaces) · Hono (+ RPC) · Drizzle · PostgreSQL · Zod (+ drizzle-zod) · Biome · PGlite for tests.
**Why:** TypeScript is the best balance of AI fluency and compile-time checking, and its type system can derive types from values (schemas). Bun bundles runtime, test runner and workspaces. Hono is built on web standards and runs on Bun and Node.
**Consequence:** `tsc --noEmit` is required, because Bun strips types without checking them.

## D2: Schema source is DBML (2026-09-13)
`schema.dbml` → generated Drizzle schema → drizzle-kit migrations + inferred types. Nothing inspects the database at runtime.
**Consequence:** DBML can't express hidden fields or exposure. Those live in blends.

### D2 note: P1.4 spike result (2026-09-13)
(Superseded by D21: blendx parses DBML itself.) We keep @dbml/core 10.1.1. Under Bun a process that imports it never exits (oven-sh/bun#42512): VS Code code bundled in @dbml/parse adds a `message` listener to globalThis. `loadDbmlCore()` hides `postMessage` during the import, and `test/bun-42512.test.ts` fails once Bun fixes it. Behavior the adapter must handle (snapshot: `packages/dbml/test/spikes/__snapshots__/`):

- **PK columns:** they report `not_null: undefined`, so treat pk as not null. Absent settings are `undefined`, not `false`.
- **Type names:** `type_name` is verbatim and includes its arguments (`varchar(255)` with `args: '255'`, `numeric(10,2)` with `args: '10,2'`). Arrays appear as `text[]`, and `double` stays `double`. Enum columns carry the enum name as the type plus an `_enum` link.
- **Defaults:** `dbdefault` is `{ type: 'number' | 'string' | 'boolean' | 'expression', value }`. Boolean values arrive as the strings `'true'` / `'false'`.
- **Refs:** inline refs are listed with the `1` side first; standalone refs keep the order they were written in. `onDelete` / `onUpdate` are `undefined` when not set.
- **Composite PKs:** these are an index with `pk: true`. `unique`, `pk` and `type` are `undefined` when not set.
- **Syntax errors:** they throw `CompilerError` with `diags[]`, each `{ message, location: { start: { line, column } } }`.

## D3: Pipeline and hooks (2026-09-13)
Order: authenticate → validate → load → authorize → calculate → save → respond. One hook per stage. Cascade: schema → app → resource → action.
**Why load comes before authorize:** ownership policies need the record. 401 is still decided first, via the policy's `requiresAuth`.
**Why effect stages are lazy:** `load`/`save` receive `runDefault()` so an override can skip the default query entirely. Value stages receive `prev`.
**Consequence:** `calculate` is pure and sync, and its signature carries no db or request.

## D4: Default-deny, strict input, Problem Details (2026-09-13)
`policy` is required and actions are listed explicitly. Input schemas are `.strict()`: unknown keys → 422. Generated columns are never input. Errors follow RFC 9457. PG errors are mapped rather than pre-queried: 23505 → 409; 23503/23502/22P02 → 422.
**Why:** fixes larablend's mass assignment and open-by-default exposure.

### D4 note: P1.2 spike result (2026-09-13)
`c.json(problem, status, { 'Content-Type': 'application/problem+json' })` keeps its `TypedResponse`, so `hc` sees the Problem body under its status, and Hono sends our Content-Type instead of `application/json`. Regression test: `packages/hono/test/spikes/p1-2-problem-json.test.ts`.

## D5: TypeScript 7.0.2 + typescript6 compiler API (2026-09-13)
`tsc` is TS 7.0.2 (native compiler). It needs `"types": ["bun"]` explicitly; `baseUrl` and `node10` resolution are gone. TS 7.0 has no programmatic compiler API, so the CLI's review step uses `@typescript/typescript6` to read `calculate`'s source and return type.
**Revisit:** switch to TS 7.1's API when it ships. Fallback if a type test ever diverges: pin `typescript@6.0.3`.

### D5 note: P1.7 spike result (2026-09-13)
`@typescript/typescript6` 6.0.2 (`import ts from '@typescript/typescript6'`) runs under Bun. A program over one hook file, the checker, and the AST walk take about 0.4 s. The extraction works like this:
- Find every `calculate` property or method.
- Name its action from the enclosing property.
- Take `getText()` as the literal source.
- Derive `writes` from the signature's return type as the **union of keys across all return shapes**: a union type is flattened, spreads resolve through the checker, and every `return` of a block body counts.

Verified for an object literal, a spread over `prev`, a conditional, and a method with two returns. The dependency stays in `@blendx/cli` only. Regression test: `packages/cli/test/spikes/p1-7-calculate-writes.test.ts`.

## D6: Drizzle 0.45 pinned (2026-09-13)
drizzle-orm 0.45.2, drizzle-kit 0.31.10, drizzle-zod 0.8.3. Drizzle 1.0 is still a release candidate. All drizzle-zod imports stay in one module. (D20: now drizzle-orm and drizzle-kit 1.0.0-rc.4, with `drizzle-orm/zod` in place of drizzle-zod.) Don't generate `relations()`.
**Revisit:** todo P12.6.

### D6 note: P1.3 spike result (2026-09-13)
drizzle-zod 0.8.3 schemas are plain zod 4 objects: `instanceof z.ZodObject`, and `.strict()` / `.extend()` work with the app's `z`. Confirmed mapping:

| Column | Rule |
|---|---|
| `varchar(n)` | `.max(n)` |
| `integer` | int32 |
| `doublePrecision` | number |
| `pgEnum` | enum |
| string-mode `timestamp` | string |

`generatedAlwaysAsIdentity` columns are left out of insert and update. Defaulted columns become optional on insert.
**Finding:** drizzle-zod's types reference Node's `Buffer`. Without it, the portable check silently loses schema precision. `types/portable-globals.d.ts` declares a type-only `interface Buffer` for tsconfig.portable.json only. There is still no `Buffer` value, so the gate holds. Regression test: `packages/core/test/spikes/p1-3-drizzle-zod.test.ts`.

## D7: Default DB driver `pg` (2026-09-13)
node-postgres on Bun and Node. PGlite in tests. `bun-sql` is opt-in because of open Drizzle issues (JSON serialization, timezones). drizzle-kit is never bundled into the compiled CLI. (There is no compiled CLI in v1: D17.)

### D7 note: P1.5 spike result (2026-09-13)
drizzle-kit 0.31.10 runs on Bun with `bun x --bun drizzle-kit generate` (about 0.2 s), so migrations don't need Node installed. drizzle-kit#5122 is about bundling drizzle-kit into a compiled binary, not about running it. drizzle's PGlite migrator applies the generated folder inside `bun test`. Postgres errors keep their SQLSTATE through drizzle and PGlite (somewhere on the `cause` chain):

| SQLSTATE | Meaning |
|---|---|
| 23505 | unique violation |
| 22001 | value too long for varchar(n) |
| 22P02 | invalid enum text |

P5.7 therefore also maps 22001 to 422. Regression test: `packages/core/test/spikes/p1-5-pglite-migrate.test.ts`.

### D7 note: P7.7 createDatabase (2026-09-13)
`createDatabase(config)` lives in the `blendx` facade, not in core: drivers are runtime-specific (bun-sql needs Bun) and core stays portable. Each driver package is imported only when chosen and is an optional peer dependency of `blendx`, so an app installs only its own driver; a missing one is a `BlendxConfigError` that names the package. Server drivers read `config.database.url`, then `DATABASE_URL`. PGlite reads only `config.database.url`: none or `memory://` is in memory, anything else is a data folder.

## D8: Own OpenAPI generator (2026-09-13)
Walk the endpoint definitions and use `z.toJSONSchema` (draft 2020-12, which is OpenAPI 3.1). `@hono/zod-openapi` is rejected: it needs a hand-written spec per route and would bloat `routes.gen.ts`.

### D8 note: P1.6 spike result (2026-09-13)
zod 4.6.2 converts drizzle-zod schemas and hand-written rules to draft 2020-12 JSON Schema with no unrepresentable types, in both directions.

**What the OpenAPI builder must handle:**
- **`~standard` is safe.** The result carries zod's Standard Schema payload as a non-enumerable own property. `JSON.stringify` and spread skip it, so nothing leaks into openapi.json. Bun's snapshot printer does show it, so snapshot JSON-serialized data.
- **Mappings as observed:**

  | Zod / column | JSON Schema |
  |---|---|
  | nullable | `anyOf [..., { type: 'null' }]` |
  | enum | `{ type: 'string', enum }` |
  | int | `integer` with int32 bounds |
  | strict objects and select schemas | `additionalProperties: false` |

**Quirks to decide on in P4.1 / P9.1:**
- **double bounds.** drizzle-zod gives `doublePrecision` bounds of ±2^47, so `1e20` is rejected.
- **timestamp format.** String-mode timestamps are plain `type: string`, with no `format: date-time`.

Regression test: `packages/core/test/spikes/p1-6-json-schema.test.ts`.

### D8 note: P9.1 builder (2026-09-13)
- Request bodies and query parameters come from each endpoint's resolved rules (zod's input side). Replies use one public-record component per table (`recordSchema`, the output side), minus hidden columns.
- Date columns get `format: date`. String-mode timestamps stay plain strings: Postgres returns them as `2026-09-13 04:35:38.784` (a space, and no offset without a time zone), which is not an RFC 3339 date-time, so `format: date-time` would promise a shape the API does not send.
- A reply blendx can't describe gets an empty schema and a warning: the result of a collection action's calculate, and any reply an action's own respond hook builds. P9.3 adds the respond `schema` override.
- Problem replies are listed by rule: 400 with a body, 401 when the policy needs an identity, 403 when the policy or an authorize hook can refuse, 404 on member routes, 409 on writes, 422 everywhere (input is strict).

## D9: Generation and review (2026-09-13)
`blendx generate` writes `src/generated/` (`schema.gen.ts`, thin `routes.gen.ts` exporting `AppType`, `register.gen.ts`, `drizzle.config.gen.ts`, `openapi.json`). `run()` declares its return type explicitly (hono#4498 history). There is no YAML input; `blendx review` writes `review/*.yaml` (mechanically derived, with provenance), while `*.examples.yaml` is human-owned and runs as tests.

### D9 note: P1.1 spike result (2026-09-13)
Confirmed with hono 4.13.7: an explicitly typed `readonly [MiddlewareHandler, Handler]` tuple spread into a chained route keeps `hc` types (request input, 201 body, 422 Problem body, status narrowing). Status generics must be constrained to hono's `StatusCode`. Runtime tests use `testClient` from `hono/testing`, because `hc`'s `fetch` option is typed as `typeof fetch`, and Bun's `fetch` type carries an extra `preconnect` member. Regression test: `packages/hono/test/spikes/p1-1-rpc-tuple.test.ts`.

### D9 note: P7.1 and P7.2 generated files (2026-09-13)
- `routes.gen.ts` imports only from `blendx` (`router()` and `run()`), so an app needs no direct hono dependency. Tables sort by name, and endpoints keep the `toEndpoints()` order. A table named like a JS reserved word, `router` or `run` gets a `_` suffix on its import binding.
- `register.gen.ts` augments `declare module "blendx"`. The augmentation reaches `Register` in `@blendx/core` through the facade's re-export, so apps never import `@blendx/core`. `packages/cli/test/register` is its own tsconfig project and fails without the golden.
- `drizzle.config.gen.ts` is a plain object (no drizzle-kit import) with paths relative to the app root, where drizzle-kit runs. It holds no credentials: `migrate generate` is offline and `migrate up` uses blendx's own migrator, so no database URL lands in a committed file.
- (Superseded by D18: the bin now lives in `@blendx/cli`, a dev dependency.) The `blendx` bin lives in the facade package, because `bunx blendx` resolves the package named `blendx`. It is a two-line file calling `main()` from `@blendx/cli`, so the facade depends on the CLI. `@blendx/cli` keeps `src/bin.ts`, which its tests spawn, but declares no bin of its own. (It was meant as the `bun build --compile` entry for P12.4, dropped in D17.)
- The `schema.gen.ts` that `blendx generate` writes imports its builders from `blendx/drizzle`, which re-exports drizzle-orm's pg-core and `sql`. An app then needs no drizzle-orm dependency of its own, and can't end up with a second drizzle-orm copy whose types differ from the one blendx is built on. `emitDrizzle` keeps plain drizzle-orm imports unless given `importFrom`, which is what the package goldens use.
- `blendx migrate generate` runs the drizzle-kit that `@blendx/cli` pins, by its bin path, from the app root with `drizzle.config.gen.ts`. It refuses while `schema.gen.ts` is out of date, so a migration never comes from a stale schema. On a real terminal drizzle-kit inherits it, so its rename prompts still work. `blendx migrate up` applies migrations with `createDatabase(config).migrate()`, the configured driver's own drizzle migrator.
- `blendx generate` also writes `openapi.json` (P9.3), from the blends and the app module's `defineApp()`. Each reply the document can't describe prints as a `warning:` line on stderr; warnings never fail `generate` or `--check`.
- Clients import `hc` and its inference types from `blendx/client`, a facade subpath over `hono/client`. `AppType` is built from the hono that blendx depends on, so a client on that same copy can't drift from it; the facade depends on hono for this. Tests drive `hc` through `server.request`, casting its `fetch` option as the P1.1 note explains.

### D9 note: P10.1 review model (2026-09-13)
`reviewResource(resource, app)` is the plain data behind `review/<resource>.yaml`. Per resource: `format: 1`, the resource, its hidden columns, and the fields of a record in a reply (listed once). Per action, in route order: the route; the input, one line per field, described from the resolved rules' JSON Schema (for example `string, at most 255 characters, or null`); every stage with `from` (the cascade levels that shaped it, `schema` first) and what the schema level does in words, where authorize's default is the policy's description; and the reply's status and body, or why it is not described. The default wording mirrors the engine's `defaultEffects`. The review never runs a hook: the CLI adds calculate's source and writes (P10.2).

### D9 note: P10.3 review YAML (2026-09-13)
`review/<resource>.yaml` renders the review model with the `yaml` package (2.9.1, a new CLI dependency, pinned; its Document API carries the comments). A header comment says the file is generated and that an edit is a fix request. Top level: `format: 1`, `resource`, `source` (the blend file), `hidden` when there are any, `record`, then `actions` in route order with a blank line between them. Each action: `route`, `input` (when it takes any), `stages` (one line each; a stage shaped by more than the schema carries `# from: schema, action`), `calculate` (the hook as a dedented literal block with its `writes`, or `returns` for a collection action; without a hook, the default's writes), and `reply`. Output is deterministic: no timestamps, no line folding.

### D9 note: P10.5 review examples (2026-09-13)
`review/<resource>.examples.yaml` is human-owned. It maps action names to lists of examples; each gives `input` (and `record` for member actions) and then `writes` (what calculate must return), `returns` (the same, for a collection action) or `rejects` (the JSON pointers, or query parameters, that validation must reject), plus an optional `name`. `runExamples` (core, no database) checks them the way the engine runs an action: the resolved rules validate, calculate runs with the engine's default `prev`, writes pass `assertWritable`, and the result is compared as sorted JSON. Each failure is one line naming the file, action, example number and name, what came out and what was expected. `blendx review --check` runs them; an app's tests call `checkExamples(appRoot)` from `blendx/examples`, a subpath so that importing `blendx` at runtime never loads the CLI. (D18 moves it to `@blendx/cli/examples`.)

### D9 note: P15.1 the identity's type (2026-09-13)
`defineApp` infers the identity's type from `auth` and types the app hooks with it directly. `App` is generic over that type, `App<Auth>`, where it was generic over the whole spec, and `RegisteredAuth` reads it from the registered `App<Auth>`. Through `RegisteredAuth`, an app hook that read `auth` made `typeof app` depend on itself (TS2502). Policies and resource and action hooks still take the type through `Register`. Consequences:
- App hooks are declared as methods, as resource hooks are, so an `App<User>` still fits `App`.
- `app.spec` is typed as `AppSpec<Auth>`, not as the literal spec, so `app.spec.auth` is optional in its type.
- `auth` comes before `hooks` in `defineApp`, as `rules` comes before `calculate` in an action (D12): inference reads the object in order, and written the other way round the hooks see `never`.

## D10: Out of scope for v1 (2026-09-13)
Composite PKs, `?include=` relations, force-delete, PUT, and a post-commit side-effect stage (future: outbox or an `after` stage). The React adapter is the next phase.

## D11: P1 spikes confirm the plan, with amendments (2026-09-13)
All seven spikes passed and stay as regression tests (`packages/*/test/spikes/`). D1, D3, D8, D9 and D10 stand as written. These amendments supersede the original text:

- **D2:** (removed by D21) `@dbml/core` is loaded only through `loadDbmlCore()` (workaround for oven-sh/bun#42512, tracked by `packages/dbml/test/bun-42512.test.ts`).
- **D4:** the Postgres error mapping also sends 22001 (value too long) to 422: 23505 → 409; 23503, 23502, 22P02 and 22001 → 422.
- **D5:** `@typescript/typescript6` is a dev dependency of `@blendx/cli` for the spike. It becomes a runtime dependency when the review step lands (P10.2).
- **D6:** the portability gate includes `types/portable-globals.d.ts` (type-only `Buffer`) so drizzle-zod types stay precise.
- **D7:** the CLI runs drizzle-kit as `bun x --bun drizzle-kit`, so Node is not required. drizzle-kit stays external to the compiled CLI. (No compiled CLI in v1: D17.)

Open questions carried forward are in the todo Inbox (double bounds, timestamp format, removing the Bun workaround).

## D12: Authoring shape, one call per action (2026-09-13)
Supersedes the plan's keyed form (`actions: { index: true, store: { rules, calculate } }`). A resource lists its actions as calls on a typed builder:

```ts
export default blend(models.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.show(),
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.destroy(),
    a.restore(),
  ],
});
```

**Why:** the P3.0 spike (`packages/core/test/types/inference.spike.types.test.ts`). The keyed form relies on reverse mapped type inference, which is fragile:
- `index: true`, or `index: {}` next to a spec that has `rules`, turns every `input` into `unknown`.
- An action-specific `prev` can't be typed, because the key isn't a literal during inference.

One generic call per action infers correctly in every case tested:
- replacing the rules
- extending `prev`
- omitting `rules` (so the defaults apply)
- mixed action lists
- custom member actions
- rejecting unknown columns

**Consequences:**
- The array is the explicit exposure list (default-deny).
- Each action name is written once.
- `a.restore()` exists only on soft-delete models.
- Custom actions are `a.member(name, spec)` and `a.collection(name, spec)`.
- When `rules` is omitted, TS falls back to the type parameter's constraint, not to a generic default. The types therefore swap in the action's defaults with a conditional (`Resolved<S, Defaults>`).
- Inside one spec, `rules` still comes before `calculate`.

## D32: An include nests the includes of its target (2026-09-13)
`?include=user.team` follows a path: each segment is an include of the blend the segment before it reached, belongs-to and has-many alike, so `notes.author` nests each note's author. The legal paths are derived from the blends, and nothing new is declared: a target blend already says what its show nests, and an included row is what its show gives. Asking a path asks its prefixes, so `?include=user.team` carries `user` with `team` inside it. Each level goes through its own blend's show, row by row, as D28 and D31 have it: a refused or missing belongs-to is null and nests nothing below it; a dropped has-many row nests nothing; a has-many's limit and sort apply at its level, so at most `limit` rows per parent at each level. The rows of one path are loaded in one query for the whole reply, as the rows of one relation are today. An unknown segment, at any position, answers 422 on `include`. The reply types carry each nested include as an optional field of the included record, recursively; OpenAPI inlines an included record that has includes of its own; the review lists one line per path, `user.team: teams, through its show: ...`, beside the direct includes; `client.gen.ts` keeps its flat map of include name to table, and the React adapter walks a query's paths through it, so a write to any table a query holds refetches it. D28's and D31's "nesting waits" sentences are superseded.
**Why derived:** the blend graph is acyclic, since a blend must exist before another includes it, so the paths are finite; a parent that re-declared what its target may nest would say it twice, and the two could disagree. **Why no depth cap:** the paths are those the blends allow, a reviewer sees them all on the parent's review, and each has-many level is bounded by its limit. **Why one line per path in the review:** the review is per resource, and the reviewer of orders should not have to open users to learn that `user.team` is reachable through it.
**Consequences:** P16.14 (the rule, the reply types, the engine and the spec) and P16.15 (OpenAPI, the review, the React adapter, the conformance fixture and its cases, and the docs).

## D31: A blend includes the rows that point at it, bounded (2026-09-13)
`?include=` also nests has-many relations: for each name, every row of the reply carries the live rows of another table whose foreign key points at it, as an array, never null. Nothing in the DBML names the inverse of a foreign key, so the blend names it: `includes: { notes: { blend: order_notes, limit: 10 } }`, and the target's model must have exactly one single-column foreign key to this table. When it has more than one, as expenses has with `user_id` and `approved_by_id`, the blend says which: `{ submitted: { blend: expenses, by: 'user_id', limit: 10 } }`. The name must not be a column of the table nor one of its belongs-to relations. Every has-many include declares its bound, `limit`, and may declare its order, `sort: '-created_at'`, else the target's primary key ascending. A bare blend, `{ user: users }`, stays a belongs-to include, so the two forms tell the two kinds apart. The rows of one relation are loaded in one query for the whole reply, at most `limit` per parent row, by a window function over the foreign key. Each row goes through the target's show as the belongs-to rows do: its policy and authorize hooks, hidden columns removed, live rows only, no show load hook allowed. A row show refuses is dropped, not nulled. The reply types, OpenAPI and the review carry each as an array of the target's public record; the review names its limit and order. Nesting (`user.team`) stays out.
**Why the app names it:** `user_id` names its belongs-to on its own; the inverse has no column to take a name from, and one table may point at another twice. The blend's key is the name, and `by` settles the column when the target's constraints leave it open.
**Why a required limit:** a has-many relation is unbounded, which is why D28 left it out. An include is for a row's bounded children, an order's notes or its lines, and a reviewer should see the number. A user's orders stay on `GET /orders?user_id=1`, which pages. A default would hide the bound from the review and let a list grow past what the author had in mind.
**Why an array, not a page:** a page (`{ data, meta: { total } }`) would tell the client whether the list was cut, at a count query per relation, and make a has-many look unlike a belongs-to. The array keeps one shape for a nested row and a nested list; the guide says what the limit means, and a client that needs the total asks the target's index.
**Why refused rows are dropped:** a belongs-to is one row, so null says it was refused or gone; a list of nulls says nothing a shorter list does not. A dropped row still counts against the limit, since the bound is applied in the query, before authorize; so a list may hold fewer than `limit` rows while more exist.
**Consequences:** P16.11 (the declaration: types and `blend()`), P16.12 (the engine and DR-INCLUDE) and P16.13 (OpenAPI, the review, conformance, the docs and the React client map, whose `includes` records the target table as it does for a belongs-to, so N.8's invalidation follows it unchanged; D30 leaves nested rows alone either way).

## D30: Optimistic updates in the React adapter, opt-in per mutation (2026-09-13)
A mutation may say `mutationOptions({ optimistic })`, and the adapter then changes the cached rows of its table before the request is sent, so the page shows the result at once. What each action does: update merges its `json` into every cached copy of the row, the show queries for that id and the row inside every index page, plain and infinite, matched by primary key. Destroy and purge remove the row from every page and lower `meta.total` by one, and leave the show queries alone: the invalidation after the reply refetches them, and they 404 as they would for any deleted row. A custom member action, and restore, take `optimistic: (row, input) => row`, since only the app knows what they change. Store puts a new row into the cached lists: those of its table whose filters all match the input by string equality, and none that filters on a column the input leaves out; at the top when the list's sort is descending, else at the end; in the first page of a plain query and the last loaded page of an infinite one when it has no next page; and `total` grows by one. The row holds the input and a temporary key, with `optimistic: true`, or also what `optimistic: (input) => partial` returns, and the server's row replaces it when the reply arrives. Rows nested by an include in another table's queries are left alone; the N.8 invalidation corrects them after the reply. Before writing the cache the adapter cancels the table's running queries, so an earlier refetch cannot land on top of the optimistic state. It runs inside the mutation function, as the invalidation does, so an app's spread `onMutate` and `onSuccess` keep it. A failure invalidates the table's queries instead of restoring a snapshot. `client.gen.ts` records each table's primary key, `key: { column, type }`, and a temporary key is a negative counter for a number key and a random UUID for a string key.
**Why opt-in:** an optimistic change shows a state the server has not confirmed, which suits a list of one's own notes and not a payment. The app decides per mutation.
**Why lists are guessed, and only from the input:** the adapter cannot evaluate a filter against typed values, a scope against an identity, or a sort by a column the row does not hold yet. The optimistic row lives only until the reply, and the refetch that follows corrects any wrong guess, so a simple rule beats a precise one. For the same reason the row carries no column defaults: recording them in `client.gen.ts` would grow the file for a row that lives a few hundred milliseconds, and calculate's writes are unknowable anyway. What the adapter cannot derive, the page renders from TanStack's `mutation.variables`.
**Why invalidate on failure:** a snapshot restored after a second mutation or a retry puts back stale data. The server's rows are the truth, and a refetch gets them.
**Consequences:** N.10 (the mechanism: update, destroy, purge and the function form; the key in `client.gen.ts`), N.11 (store) and N.12 (the guide and the example).

## D29: Force-delete is a purge action on soft-delete tables (2026-09-13)
A soft-delete table may expose `a.purge()`, a built-in action served as `DELETE /<table>/:id/purge` that answers 204 with no body. It loads the row whether it is soft-deleted or not, locked `FOR UPDATE`, authorizes, and deletes it for good in the action's transaction. Like every action it has its own policy, so a blend can leave destroy to a row's owner and purge to an administrator. A row other rows still reference answers 409, as destroy does on a table without soft delete. `after` and `later` receive the deleted row as `saved`. The types and `blend()` refuse it on a table without soft delete, where destroy already deletes for good, and it takes no `reveal`, since its reply has no body.
**Why an action, not a flag:** `DELETE /orders/1?force=true` would give one route two meanings and one policy, and DR-MEMBER-EMPTY says destroy takes nothing. An action of its own gets its own policy, its own hooks and its own line in the review, where a reviewer can see who may delete for good.
**Why any row, not only trashed ones:** restore loads only trashed rows because it has nothing to do with a live one. Purge has: skipping the trash is what a force-delete is for, and the caller should not have to restore a row to purge it. Emptying the trash is `?trashed=only` and a purge per row.
**Why 204:** as destroy: the row is gone, and there is nothing to return.
**Consequences:** P16.10. DR-MEMBER-EMPTY covers purge. The route table, the review, OpenAPI and the React adapter treat it as destroy, a DELETE that answers 204, so a purge mutation resolves to `null`. A table without soft delete has no purge; destroy already deletes for good there.

## D28: A blend includes the rows its foreign keys point to (2026-09-13)
index and show accept `?include=user,order`: for each name, every row of the reply carries the row its foreign key points to, nested under that name, or `null`. This first version covers belongs-to relations only, one level deep. The relations are the table's single-column foreign keys whose column ends in `_id`, named by the column without it (`user_id` gives `user`, `approved_by_id` gives `approved_by`), so they are derived from the schema. A blend lists what may be included, naming the target's blend: `includes: { user: users }`. The types check that the name is a relation of the table and that the blend is of the table it points to; `blend()` checks the same, and that the target exposes show, has no show load hook, and that no column already has the relation's name. An unknown name in `?include=` answers 422, as any unknown query key does.
An included row goes through the target's show as `GET /users/:id` would: the target's policy and authorize hooks decide, row by row, and its hidden columns are removed. A row that show would refuse or not find (soft-deleted, or gone) comes back as `null`, so including a row never reveals more than show does. The rows of one relation are loaded in one query for the whole page (`where id in (...)`), after authorize and before respond, and respond receives the record with its includes. An included row is the target's public record: the target's respond hook and `reveal` do not apply to it.
**Why belongs-to first:** one row per key, one query per relation, and nothing to page. A has-many relation (a user's orders) is unbounded, needs its own limits and pages, and `GET /orders?user_id=1` already answers it. Nesting (`user.team`) waits for the same reason.
**Why through show:** the target's blend already says who may see its rows. Letting whoever may read an order see its user would publish every user to anyone who can list orders.
**Consequences:** P16.7 (relations, and includes declared), P16.8 (the parameter and the engine) and P16.9 (OpenAPI, the review, conformance and the docs). The reply types, `AppType`, OpenAPI and the review carry each include as an optional, nullable field. Two blends cannot include each other, since their files would import each other.

## D27: later hooks run from an outbox, at least once (2026-09-13)
An action that writes may also have `later` hooks, for effects that must not be lost, such as a payment provider's webhook. A later hook does not run in the request. The engine writes one entry per level that has a later hook into the `blendx_outbox` table, inside the action's transaction, so an entry exists exactly when the write commits. A worker runs the entries: `drainOutbox()` runs every due entry once, for tests, cron routes and serverless hosts, and `startOutbox()` drains on an interval in a long-running server. An entry holds its resource, action and level, and the hook's context as JSON (`saved`, `record`, `input`, `auth`); the hook receives that context, `db`, the entry's `id` and the `attempt`. An entry that succeeds is deleted. A failure is reported to `onError`, and the entry runs again after a growing delay; after the last attempt it stays in the table, marked failed, with its last error. Workers claim entries with `FOR UPDATE SKIP LOCKED` and hold them for a lease, so several can share the table, and an entry whose worker died runs again when its lease ends. A later hook therefore runs at least once and may run twice; it must tolerate that, and its `id`, the same on every attempt, serves as an idempotency key. The app, resource and action levels each get their own entry, run in no set order.
**Why a separate hook:** after runs in the request, at most once; later runs outside it, at least once, possibly well after the reply and more than once. One name for two guarantees would hide which one a reader is looking at, and the review lists them apart.
**Why the table is derived:** an app writes no `blendx_outbox` in schema.dbml. core defines the table, and `blendx generate` writes `src/generated/outbox.gen.ts`, which re-exports it once any app, resource or action later hook exists and exports nothing otherwise. drizzle.config.gen.ts lists that file beside schema.gen.ts, so `blendx migrate generate` creates the table in the migration that comes with the first later hook, and an app without later hooks has no outbox table.
**Why JSON:** an entry outlives the request, so its context is stored rather than kept in memory. Rows, input and identity come back as JSON: string timestamps and numerics are already strings (D8), and bigint columns are numbers. The identity is stored as the JSON of what `auth` returned, so it should hold only JSON values.
**Consequences:** P16.3 (the hook and its entries), P16.4 (the worker, which finds hooks through the resources `routes.gen.ts` exports), P16.5 (the table's generation) and P16.6 (the review and the docs).

## D26: An after stage runs once a write has committed (2026-09-13)
An action that writes (store, update, destroy, restore and custom member actions) may have side effects once its transaction has committed: an email, a webhook, a message to another system. `after` runs after the commit and before respond, and the engine waits for it. It receives `saved` (the row as saved, hidden columns included, since none of it goes back to the client), `record` (the row as loaded before the write; none for store), the validated `input`, `auth`, and `db`, the database outside the transaction. App and resource hooks run too, for every action that writes: the app's, then the resource's, then the action's, each with the same context, and none replaces another. A level that throws is reported to the server's `onError` (console.error by default); the other levels still run, and the reply is the success it would have been, because the write has committed. Reads (index, show and collection actions) have no after: the types refuse it and `blend()` throws.
**Why in process:** D10 named two ways, an outbox or an after stage. An outbox writes each effect in the transaction and a worker runs it with retries, so it survives a crash and runs each effect at least once, but it needs a table, a worker and a way to deploy that worker. In process is simple and covers most apps; an effect is lost if the process dies between the commit and the hook, so each runs at most once. An outbox can later sit behind the same hook.
**Why every level runs:** after has no default work to replace. Under the rule of load and save, where the most specific hook replaces the others unless it calls `runDefault()`, an action's own after would silently switch off an app-wide audit log. So after is a third kind of stage, beside value and effect stages.
**Why before respond, and awaited:** a test can check the effect when the reply arrives, and a failing effect cannot race the response. A hook that must not delay the reply starts its work without awaiting it.
**Consequences:** P16.1 (the types, the engine, and the pipeline and cascade specs) and P16.2 (the review lists `after` only on actions where a hook sets it, so apps without one keep their review files; the guide and a cookbook pattern). Writes that must be atomic with the action still belong in save.

## D25: The React adapter calls actions by name and gives TanStack Query options (2026-09-13)
`@blendx/react` reaches each action by its table and name, `api.expenses.submit`, not by its route (`client.expenses[':id'].submit.$post`). It gives TanStack Query options rather than hooks: a GET action gives `queryOptions(input)`, any other method gives `mutationOptions()`.
**Why names:** blendx talks in actions, and routes would put segments such as `[':id']` into every call. A client cannot work out an action's route from its name: a custom action's method, and whether it acts on a record or on the collection, are in its blend. So `blendx generate` writes `src/generated/client.gen.ts`, a map from table and action to `METHOD /path` that imports nothing, and a web app loads it without loading the server. The client's types come from looking each entry up in `AppType`, so an action's input and replies are exactly `hc`'s.
**Why options:** one options object serves `useQuery`, `useSuspenseQuery`, `prefetchQuery`, `ensureQueryData` and a router's loaders, so the adapter wraps none of them. TanStack Query v5 is built around `queryOptions`, and tRPC v11 moved its React integration to the same shape.
**Consequences:** N.1 splits into N.1a (the map) and N.1b (the package). Proposed with this decision, and settled in N.1b and N.2: a query or mutation resolves to the body of the action's success status and throws a `ProblemError` carrying the Problem Details otherwise; keys are `[table, action, input]`, and a mutation invalidates its table's queries; the package takes `hc` from `blendx/client` (D9 note), with react and @tanstack/react-query as peer dependencies.

### D25 note: N.1b the package (2026-09-13)
- `createBlendxClient(client, endpoints)` takes the app's `hc<AppType>(url, options)`, not `<AppType>` with `{ baseUrl, headers }`: TypeScript cannot infer the map's type once the app's is written out (it has no partial inference), and with the client passed as a value neither type is written. The client carries the base URL, the headers and `fetch`, and it comes from `blendx/client`, so it is the Hono that built AppType. There is no QueryClient option yet: N.2 decides whether invalidation needs one, or takes it from the mutation's context.
- An action's types are hc's: its input is the first parameter of the route's hc function, and its data is `InferResponseType` over the 2xx statuses. One difference: an input none of whose parts has a required key is optional, where hc makes index take `{ query: {} }`.
- Keys are `[table, action, input]` for a query (no input is `{}`) and `[table, action]` for a mutation.
- A reply that is not 2xx rejects with a `ProblemDetailsError`, which has `status` and `problem`. It is not named `ProblemError`, which core already uses for one entry of `errors`, nor `HttpProblem`, which a hook throws on the server. A reply without Problem Details, such as a proxy's 502, gets `{ type: 'about:blank', title: <its status text>, status }`. A 204 resolves to `null`, as hc types it.
- Pins: @tanstack/react-query 5.102.8, a dev dependency, with the peer range `^5.102.8` (the version `mutationOptions` and the tests were checked against), and react 19.3.0, a dev dependency only: the adapter never imports React, and react-query declares React as its own peer. `@blendx/react` depends on `blendx` for the types of `blendx/client`; its imports of `blendx` are type-only, so none of it reaches a browser bundle.

### D25 note: N.2 invalidation (2026-09-13)
- Once its request succeeds, a mutation invalidates every query of its table (the key prefix `[table]`). `mutationOptions({ invalidates: ['users'] })` adds other tables, named as in the map. Replies carry no relations (D10), so a reply holds only rows of its own table: the other tables a write can change are the ones a save hook writes, which a client cannot see.
- The invalidation runs inside the mutation function, with the QueryClient that TanStack hands it (`MutationFunctionContext.client`), and the mutation resolves once the active queries have refetched. So `createBlendxClient` takes no QueryClient, and an app can spread its own `onSuccess` over the options without losing the invalidation. A failed mutation invalidates nothing: its transaction rolled back.
- Every action that is not GET invalidates, a POST collection action that only calculates included: the map does not say which actions write, and a refetch is harmless.

### D25 note: N.3 field errors (2026-09-13)
- Every action has `fieldErrors(error)`: the first problem with each field of a refused input, for a form to show, and `{}` for any other error (a refusal without `errors`, an error that is not a `ProblemDetailsError`, or none). It reads `errors` whatever the status, so a 409 on a unique column names that column as a 422 names a field.
- A body field is named by its pointer's segments joined with dots, RFC 6901's `~1` and `~0` unescaped (`/tags/0` is `tags.0`, the form react-hook-form takes); a query parameter by its name. A field gets one message, the first, because a form shows one; every entry stays in `error.problem.errors`.
- The keys are typed by the action's input: the fields of its body, with `field.${string}` below a field that holds an object or an array, and its query parameters. A misspelt field is a type error.

### D25 note: N.5 the web example (2026-09-13)
- `examples/addition/web` is a React page over the addition API: its form is the store action's mutation, its list the index query, which a store invalidates, and a refused field shows its `fieldErrors`. It is a workspace package of its own (`examples/*/web`), so the API example keeps only API dependencies, and a tsconfig project of its own (JSX, and the app's register.gen.ts). It imports `AppType` type-only from `../server.ts` and `endpoints` from the generated `client.gen.ts`, so no server code reaches the bundle.
- Its end-to-end test is Playwright in Chromium, chosen over happy-dom inside `bun test`, which would test components rather than the page a browser loads. It serves the app's routes on in-memory PGlite (`e2e/api.ts`, port 3100) and the page through Vite (port 5180), so each run starts from an empty table and never touches `./.data`. The test files are `*.e2e.ts`, because `bun test` would pick up `*.spec.ts`. It is not part of `bun run check`, which stays browser-free: `bun run e2e:web` runs it, and CI's `e2e-web` job installs Chromium first.
- Pins: vite 8.3.0, @vitejs/plugin-react 6.1.1, react and react-dom 19.3.0 with @types/react and @types/react-dom 19.3.0, @playwright/test 1.63.0, and @electric-sql/pglite 0.5.8 for the test API.

### D25 note: N.8 invalidation follows includes (2026-09-13)
- Since D28 a query with `?include=` holds rows of another table, so a write to that table must refetch it: after `users.update`, an `orders.index` query that included `user` would keep the old user. A mutation that succeeds now invalidates the queries of its own table (and of the tables `invalidates` names), and among the tables that include one of those, the queries whose input's `include` asks for that relation. A query that did not include it keeps its data.
- `client.gen.ts` therefore records, per table, what it includes: `export const tables = { orders: { actions: { index: 'GET /orders', ... }, includes: { user: 'users' } }, ... }`, and `createBlendxClient(client, tables)` takes it. The flat `endpoints` map is gone: the file now holds facts about a table besides its actions, includes today and its primary key once optimistic updates come (D30), so it is one object per table rather than a second export an app could forget to pass. `includes` is always present, `{}` when the blend declares none, so its shape is the same for every table. It still imports nothing.
- The include a query asked for is read from its key: the third element is the input, and `query.include` holds the comma-separated names, as the server takes them.
- Found on the way: the hono RPC types gave show no query even when its blend declares includes, so `hc` could not ask for one. Now every GET action's query comes from its rules, and an action whose rules accept nothing takes no query, as P15.6 did for bodies. `hc` then requires `query: {}` on such a show, as it does on index; the adapter lets any part of an input with nothing required be left out, not only the whole input.

### D25 note: N.9 infinite index (2026-09-13)
Every index also gives `infiniteQueryOptions(input)`: the same listing page by page, with `page` left out of its input (a type error), page 1 first, and the next page `meta.page + 1` while `page * per_page < total`. Its key is `[table, 'index', input, 'infinite']`: TanStack says not to share a key between a query and an infinite query, since their data differ in shape; the prefix keeps it under the table for invalidation, and the input stays third, where the include it asked for is read (N.8). Numbered pages need nothing new: the plain query with `page` in its input, and TanStack's `placeholderData: keepPreviousData` to keep the last page on screen. Both page by offset, so a newest-first list repeats a row inserted between two pages; cursor paging would change the server's contract, so it is a P16 candidate of its own.

### D25 note: N.7 cancellation (2026-09-13)
A query hands TanStack's abort signal to its request as the call's `init: { signal }`, so a query TanStack cancels aborts its request. hc merges a call's options into the client's with a deep merge, so the client's own `init` (its `credentials`, say) still applies. That merge copies any object key by key, an AbortSignal included, so a client given an `init.signal` of its own would send a plain object in its place; the guide says to give the client none. Mutations pass no signal: TanStack does not cancel them.

## D24: An action reveals the hidden columns its reply carries (2026-09-13)
An action that replies with one record (store, show, update, restore or a member action) may list `reveal: ['api_token']`: hidden columns its reply carries. Every other reply, index pages included, still leaves them out, and index still cannot filter or sort by them. A revealed column must be one of the resource's `hidden`, which the types and `blend()` check. Index, destroy and collection actions take no `reveal`: a page would reveal the column for many rows at once, destroy replies with no body, and a collection action replies with what it calculates. The action's reply type, its OpenAPI reply schema and its review say which columns it reveals.
**Why:** a secret the server makes, such as an API token, reaches its owner in one reply, the one that creates it, and must stay hidden everywhere else. `hidden` applied to the whole resource and respond saw only the public record, so examples/expenses left `api_token` visible and exposed users through store and an owner-only show. Rejected: handing respond the full row, where any respond hook could leak a column and the review could not tell; and a per-action `hidden` override, which says what to hide rather than what to show and is easy to get backwards.
**Consequences:** P15.8. "A hidden column never leaves the server" becomes "a hidden column leaves only in the replies of the actions that reveal it, and the review lists them".

## D23: Date and timestamp input is checked by its format (2026-09-13)
Supersedes DR-DATE-STRING's "any string". A `date` column accepts `YYYY-MM-DD` naming a real day. A `timestamp` or `timestamptz` column accepts two forms, each naming a real day and time: ISO 8601 (`2026-09-13T12:48:14.595Z`: a `T`, an optional fraction and an optional offset) and the text form PostgreSQL replies with (`2026-09-13 12:48:14.595`: a space, an optional fraction and an optional offset such as `+00`). SQLSTATE 22007 (invalid datetime format) and 22008 (datetime field overflow) answer 422 with a pointer, for values that still reach the database through a hook's writes or an app's own rule. PostgreSQL names no column in these errors, so the engine finds the field: the date and time values of the input and of calculate's writes that are in none of these forms. A value it did not see, such as one a save hook adds, gives a 422 without a pointer.
**Why both forms:** replies carry PostgreSQL's text form (D8 note, D15), so a client that sends back a value it read must be accepted, and ISO 8601 is what clients produce by default. Everything else PostgreSQL would read (`yesterday`, `now`, day-first orders) is refused, so what an input means never depends on the database's settings. Found while building examples/expenses, where `2026-02-30` answered 500.
**Consequences:** P15.2 (the SQLSTATE mapping) and P15.3 (the derived rules, with a new rule id, a conformance case, and OpenAPI and the review describing the forms). In OpenAPI and the review, a date input has `format: date` (RFC 3339's full-date), and a timestamp input has `format: timestamp`, a name blendx gives the two forms, with a `pattern` for them: neither form is an RFC 3339 date-time. Replies are unchanged.

## D22: A listing is scoped by declared equalities, not by SQL in a load hook (2026-09-13)
index takes `scope`, a function of the identity that returns column values: `a.index({ scope: ({ auth }) => ({ user_id: auth?.id }) })`. Each value becomes an equality that the default load adds to the query's filters, so pages and `meta.total` count only the rows in scope, and `?user_id=` filters still apply on top. A value that is `undefined` or `null` matches no row, so a scope that cannot be worked out fails closed; `{}` scopes nothing (`auth?.is_approver ? {} : { user_id: auth?.id }`). The returned object is typed by the model: its keys are columns, its values their types. The review shows the scope's source, as it shows calculate's. Only an action sets it, like load.
**Why not `runDefault({ where })`:** a Drizzle condition in a blend is SQL, and the review could only say that the action changed the load. Equalities on columns cover the owner case, stay derived, and read in the review as the rows they select. A `where` escape hatch can still come later if equalities are not enough.
**Consequences:** P15.7. Cookbook pattern 7, which filters one page after loading it, is rewritten to use `scope`. The same scope may later apply to member loads, so that another user's row answers 404 rather than 403; that is not part of P15.7.

## D21: blendx parses DBML itself (2026-09-13)
@dbml/core is replaced by `packages/dbml/src/parser.ts`, a lexer and recursive-descent parser for the DBML blendx accepts (`packages/spec/dbml.md`). @dbml/core bundled VS Code platform code into every app's toolchain, and under Bun that code kept the process alive (oven-sh/bun#42512), which took a workaround and a special way of loading it. blendx reads a small part of DBML, so owning the parser is less than carrying that, and its errors can name blendx's own rules.

- Kept: the schema IR and every message blendx reported before. The kitchen-sink snapshot of the IR is unchanged.
- Checked: before the swap, the new parser tests ran against @dbml/core. Every test of accepted syntax passed there too, so the two parsers agree on what both accept.
- New in the parser: unknown tables and columns in refs and indexes, and a table, column, enum value or ref defined twice. @dbml/core's binder caught these; now blendx does, pointing at the name. Problems are listed in source order.
- Changed: syntax errors are worded by blendx (`expected "," or "]" but found "}"`). `default: 'null'` is now the string `null`; @dbml/core read it as SQL null.
- Removed: `loadDbmlCore()` and its Bun workaround, the test tracking the Bun bug, and the P1.4 spike with its snapshot of @dbml/core's model.

## D20: Drizzle 1.0.0-rc.4 now, without waiting for the release (2026-09-13)
Replaces D19's wait. Waiting for 1.0.0 only moves a breaking upgrade onto a later, larger codebase, and with exact pins a release candidate cannot change under us. The pins are drizzle-orm 1.0.0-rc.4 and drizzle-kit 1.0.0-rc.4; drizzle-zod is dropped for `drizzle-orm/zod`. Moving on to 1.0.0, or to a later rc, is a pin change like any other: an entry here and the whole matrix.

What changed, following the D19 checklist:
- `derive-rules.ts` and `rules.ts` import `drizzle-orm/zod`. The derivation rules are unchanged.
- `Db` is `PgAsyncDatabase<PgQueryResultHKT>`. `Model` takes a `PgTable`, which `getTableConfig` now requires; blendx is PostgreSQL only. `getTableColumns` is deprecated in 1.0, so the core uses `getColumns`.
- Migrations use drizzle-kit 1.0's layout: one `<timestamp>_<name>/` folder per migration, holding `migration.sql` and `snapshot.json`, and no journal. The committed folders were converted with `drizzle-kit up`, and the blendx test fixture, which had no snapshot, by hand (the migrator reads only `migration.sql`). `blendx migrate up` looks for those folders and refuses the 0.x layout with a message saying how to convert it. Databases migrated under 0.45.2 upgrade in place (D19, point 6).
- The Node smoke test imports `drizzle-kit/api-postgres`, whose `generateDrizzleJson` is now async.

The whole matrix passes on rc.4: `bun run check` (Bun with PGlite), the `BLENDX_TEST_DB=pg` run (Bun with pg and with bun-sql, PostgreSQL 18.6), the Node smoke test, and the conformance suite on Node 24 with pg (28 of 28).

## D19: Stay on Drizzle 0.x until 1.0.0 is released (2026-09-13)
Superseded by D20: blendx moved to 1.0.0-rc.4 without waiting. The checklist below is what D20 followed.

No-go for now. On npm, `latest` is still drizzle-orm 0.45.2, drizzle-kit 0.31.10 and drizzle-zod 0.8.3. Drizzle 1.0 exists only under the `rc` tag (1.0.0-rc.4) and `beta`, with newer rc.5 snapshot builds. Pins are exact (D5), and a release candidate can still change. The upstream question, drizzle-team/drizzle-orm#5660, is open with no date. Go when 1.0.0 is on `latest`.

The spike ran the whole suite on drizzle-orm and drizzle-kit 1.0.0-rc.4, in a scratch worktree. The upgrade is small and mechanical. When 1.0.0 is out:
1. Pin drizzle-orm and drizzle-kit to 1.0.0 (core, dbml, hono, blendx, cli) and drop drizzle-zod. It is now `drizzle-orm/zod`, with the same `createInsertSchema`, `createSelectSchema` and `BuildSchema`. Only `derive-rules.ts` and `rules.ts` import it (plus the P1.3 and P1.6 spikes), which is what keeping it in one module was for. Every derivation rule test passes unchanged.
2. `Db` in `hooks.ts`: `PgDatabase` is now `PgAsyncDatabase`.
3. `getTableConfig` now takes a `PgTable`, not a `Table`: narrow the model's table type, or cast in `indexRules`.
4. The Node smoke test: `drizzle-kit/api` is now `drizzle-kit/api-postgres`, and `generateDrizzleJson` returns a promise.
5. Migration folders. The v1 migrator refuses the old layout ("run drizzle-kit up"). `drizzle-kit up`, run once per app with the kit's own binary, turns `0000_init.sql` plus `meta/_journal.json` into `<timestamp>_init/migration.sql` plus `snapshot.json`, and `migrate generate` writes that layout from then on. Convert the committed folders (`examples/addition`, the shop fixture, `packages/blendx/test/fixtures`). `blendx migrate up` looks for `meta/_journal.json` before migrating; look for any migration folder instead, and tell an app with the old layout to run `drizzle-kit up`. Tests that name `0000_init.sql` or `meta` change with it.
6. Existing databases upgrade in place. Checked on PGlite: a database migrated by 0.45.2, then migrated by rc.4 from the converted folder, kept its rows and did not run the migration again. The migrator matched it by hash, filled the new `name` column and left `applied_at` null. `database.migrate()` counts rows in `drizzle.__drizzle_migrations`, which still works.

Unchanged: the generated schema (the goldens typecheck and run), string-mode timestamps and numerics, identity, enums, soft delete, the engine, and the conformance suite on Bun with PGlite. With steps 1 to 4 the suite gave 439 pass and 8 fail, all 8 about the migration layout. After `drizzle-kit up`, only the tests that assert the old layout failed. The spike did not run the pg, bun-sql and Node rows of the matrix; the upgrade runs them.

## D18: The CLI is a dev dependency of its own (2026-09-13)
`blendx` is the runtime package: what an app imports and serves with. The `blendx` command and the review examples runner live in `@blendx/cli`, which an app adds as a dev dependency (`bun add blendx`, then `bun add -d @blendx/cli`). Before this, the `blendx` package declared the bin and so depended on the CLI, and every production install also pulled in drizzle-kit, typescript6 and yaml, which only matter while developing. `bunx blendx` still works: it finds the `blendx` bin that `@blendx/cli` links into the app's `node_modules/.bin`. Tests import `checkExamples` from `@blendx/cli/examples`; the `blendx/examples` subpath is gone. The CLI depends on `blendx` (for `createDatabase`), and nothing depends the other way.

## D17: No compiled CLI binary in v1 (2026-09-13)
The CLI ships only as a package bin (`bunx blendx`; the bin is `@blendx/cli`'s since D18), not as a `bun build --compile` binary; P12.4 is closed on this decision. Probed with Bun 1.4.2, both shapes failed. A binary bundling everything (120 MB) could not start, even for `--version`. One that kept blendx external (81 MB) could not find `@blendx/cli`. A compiled binary resolves its external packages inside itself (`/$bunfs/root`), not in the app. Beyond that, a bundled binary carries its own copy of blendx and zod beside the app's installed one: the app's blends are built with the app's copy and processed with the binary's, and `instanceof` checks fail across copies, so `generate --check` could disagree with the installed CLI. An app installs `blendx` anyway, because its blends import it, so a binary would only save installing Bun. If that ever matters, the shape to build is a launcher that finds the app's installed `@blendx/cli` by absolute path and runs it, so only one copy of blendx exists.

## D16: bun-sql stays opt-in; its errors carry the SQLSTATE elsewhere (2026-09-13)
P11.6 ran the conformance suite on Bun 1.4.2 with the bun-sql driver against PostgreSQL 18.6: 27 of 28 cases pass. ERR-409 fails: a duplicate email answers 500 instead of 409. Bun's `PostgresError` puts the SQLSTATE in `errno` (`23505`) and uses `code` for its own name (`ERR_POSTGRES_SERVER_ERROR`), while the engine's `databaseError` looks for a five-character SQLSTATE in `code`, where node-postgres and PGlite put it. So on bun-sql every mapping from a database error is lost, not only the one the suite caught: 23505 (409), 23503 (422, or 409 on a destroy), 23502, 22P02 and 22001 (422), and 22P02 on a member load (404) all become 500. Everything else the cases reach behaves as on pg and PGlite. bun-sql stays opt-in until `databaseError` also reads `errno` (Inbox); then the suite runs on it again.

### D16 note: P11.7 (2026-09-13)
`databaseError` now takes the SQLSTATE from `code` or, failing that, `errno`, and hands the rest of the engine the same fields for every driver. All 28 cases pass on bun-sql, which joins the gated matrix (`BLENDX_TEST_DB=pg` runs the suite on Bun with pg and with bun-sql; Node with pg runs through `conformance:node`). pg remains the default driver (D7); bun-sql is a supported choice, no longer a caveat.

## D15: Conformance cases are JSON, and timestamps match as PostgreSQL writes them (2026-09-13)
Conformance case files (packages/spec/conformance.md) are JSON: every language reads it without a dependency. A case is ordered steps from a reset database; a step's `capture` saves a value by JSON pointer for later paths. Bodies match partially: objects on the keys a case names, arrays element by element. The planned `$iso8601` matcher is `$timestamp` instead: string-mode timestamps come back in PostgreSQL's text form (`2026-09-13 04:35:38.784`, a space and no offset; D8 note), which is not ISO 8601, so the matcher accepts that form and the `T`-and-offset form. The others are `$any`, `$int` and `$absent`, and `$$` escapes a literal dollar string.

## D14: Reply schemas are declared on the action (2026-09-13)
OpenAPI needs a schema for the replies blendx can't derive: a collection action's calculate result, and anything a respond hook builds. An action declares it as `reply`: a zod schema for the body (at the action's default status), or `{ status, body }` when respond returns another status. It is type-checked against the actual reply: every body the action can send must fit the schema, the keys must match, and the status must be the one respond returns. `blendx generate` reads it without running any hook. Chosen over calling respond at generate time, which runs user code on fake input and still misses collection actions without a respond hook. `Reply.schema`, which nothing read, is removed. A reply that is neither declared nor derivable stays a warning. A mismatch is a type error on the action's call that names the reason (`ReplyError<"...">`). The check runs on the builder's return type, after inference: placed anywhere in the spec's type, it made TypeScript fix R and Result (while typing respond and calculate) before they were inferred.

## D13: Double precision columns are unbounded (2026-09-13)
drizzle-zod bounds `doublePrecision` to plus or minus 2^47, so a real double such as `1e20` was rejected. The default rules replace that bound with `z.number()`, using drizzle-zod's callback refine. The callback keeps drizzle-zod's null and optional handling; a plain schema refine drops it, so a nullable double would reject `null`.
Rule id DR-DOUBLE-UNBOUNDED. This closes the Inbox item from the D8 note.
