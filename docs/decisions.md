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
We keep @dbml/core 10.1.1. Under Bun a process that imports it never exits (oven-sh/bun#42512): VS Code code bundled in @dbml/parse adds a `message` listener to globalThis. `loadDbmlCore()` hides `postMessage` during the import, and `test/bun-42512.test.ts` fails once Bun fixes it. Behavior the adapter must handle (snapshot: `packages/dbml/test/spikes/__snapshots__/`):

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
drizzle-orm 0.45.2, drizzle-kit 0.31.10, drizzle-zod 0.8.3. Drizzle 1.0 is still a release candidate. All drizzle-zod imports stay in one module. Don't generate `relations()`.
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
node-postgres on Bun and Node. PGlite in tests. `bun-sql` is opt-in because of open Drizzle issues (JSON serialization, timezones). drizzle-kit is never bundled into the compiled CLI.

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
- The `blendx` bin lives in the facade package, because `bunx blendx` resolves the package named `blendx`. It is a two-line file calling `main()` from `@blendx/cli`, so the facade depends on the CLI. `@blendx/cli` keeps `src/bin.ts` as the `bun build --compile` entry (P12.4) but declares no bin of its own.
- The `schema.gen.ts` that `blendx generate` writes imports its builders from `blendx/drizzle`, which re-exports drizzle-orm's pg-core and `sql`. An app then needs no drizzle-orm dependency of its own, and can't end up with a second drizzle-orm copy whose types differ from the one blendx is built on. `emitDrizzle` keeps plain drizzle-orm imports unless given `importFrom`, which is what the package goldens use.
- `blendx migrate generate` runs the drizzle-kit that `@blendx/cli` pins, by its bin path, from the app root with `drizzle.config.gen.ts`. It refuses while `schema.gen.ts` is out of date, so a migration never comes from a stale schema. On a real terminal drizzle-kit inherits it, so its rename prompts still work. `blendx migrate up` applies migrations with `createDatabase(config).migrate()`, the configured driver's own drizzle migrator.
- `blendx generate` also writes `openapi.json` (P9.3), from the blends and the app module's `defineApp()`. Each reply the document can't describe prints as a `warning:` line on stderr; warnings never fail `generate` or `--check`.
- Clients import `hc` and its inference types from `blendx/client`, a facade subpath over `hono/client`. `AppType` is built from the hono that blendx depends on, so a client on that same copy can't drift from it; the facade depends on hono for this. Tests drive `hc` through `server.request`, casting its `fetch` option as the P1.1 note explains.

### D9 note: P10.1 review model (2026-09-13)
`reviewResource(resource, app)` is the plain data behind `review/<resource>.yaml`. Per resource: `format: 1`, the resource, its hidden columns, and the fields of a record in a reply (listed once). Per action, in route order: the route; the input, one line per field, described from the resolved rules' JSON Schema (for example `string, at most 255 characters, or null`); every stage with `from` (the cascade levels that shaped it, `schema` first) and what the schema level does in words, where authorize's default is the policy's description; and the reply's status and body, or why it is not described. The default wording mirrors the engine's `defaultEffects`. The review never runs a hook: the CLI adds calculate's source and writes (P10.2).

### D9 note: P10.3 review YAML (2026-09-13)
`review/<resource>.yaml` renders the review model with the `yaml` package (2.9.1, a new CLI dependency, pinned; its Document API carries the comments). A header comment says the file is generated and that an edit is a fix request. Top level: `format: 1`, `resource`, `source` (the blend file), `hidden` when there are any, `record`, then `actions` in route order with a blank line between them. Each action: `route`, `input` (when it takes any), `stages` (one line each; a stage shaped by more than the schema carries `# from: schema, action`), `calculate` (the hook as a dedented literal block with its `writes`, or `returns` for a collection action; without a hook, the default's writes), and `reply`. Output is deterministic: no timestamps, no line folding.

### D9 note: P10.5 review examples (2026-09-13)
`review/<resource>.examples.yaml` is human-owned. It maps action names to lists of examples; each gives `input` (and `record` for member actions) and then `writes` (what calculate must return), `returns` (the same, for a collection action) or `rejects` (the JSON pointers, or query parameters, that validation must reject), plus an optional `name`. `runExamples` (core, no database) checks them the way the engine runs an action: the resolved rules validate, calculate runs with the engine's default `prev`, writes pass `assertWritable`, and the result is compared as sorted JSON. Each failure is one line naming the file, action, example number and name, what came out and what was expected. `blendx review --check` runs them; an app's tests call `checkExamples(appRoot)` from `blendx/examples`, a subpath so that importing `blendx` at runtime never loads the CLI.

## D10: Out of scope for v1 (2026-09-13)
Composite PKs, `?include=` relations, force-delete, PUT, and a post-commit side-effect stage (future: outbox or an `after` stage). The React adapter is the next phase.

## D11: P1 spikes confirm the plan, with amendments (2026-09-13)
All seven spikes passed and stay as regression tests (`packages/*/test/spikes/`). D1, D3, D8, D9 and D10 stand as written. These amendments supersede the original text:

- **D2:** `@dbml/core` is loaded only through `loadDbmlCore()` (workaround for oven-sh/bun#42512, tracked by `packages/dbml/test/bun-42512.test.ts`).
- **D4:** the Postgres error mapping also sends 22001 (value too long) to 422: 23505 → 409; 23503, 23502, 22P02 and 22001 → 422.
- **D5:** `@typescript/typescript6` is a dev dependency of `@blendx/cli` for the spike. It becomes a runtime dependency when the review step lands (P10.2).
- **D6:** the portability gate includes `types/portable-globals.d.ts` (type-only `Buffer`) so drizzle-zod types stay precise.
- **D7:** the CLI runs drizzle-kit as `bun x --bun drizzle-kit`, so Node is not required. drizzle-kit stays external to the compiled CLI.

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

## D15: Conformance cases are JSON, and timestamps match as PostgreSQL writes them (2026-09-13)
Conformance case files (packages/spec/conformance.md) are JSON: every language reads it without a dependency. A case is ordered steps from a reset database; a step's `capture` saves a value by JSON pointer for later paths. Bodies match partially: objects on the keys a case names, arrays element by element. The planned `$iso8601` matcher is `$timestamp` instead: string-mode timestamps come back in PostgreSQL's text form (`2026-09-13 04:35:38.784`, a space and no offset; D8 note), which is not ISO 8601, so the matcher accepts that form and the `T`-and-offset form. The others are `$any`, `$int` and `$absent`, and `$$` escapes a literal dollar string.

## D14: Reply schemas are declared on the action (2026-09-13)
OpenAPI needs a schema for the replies blendx can't derive: a collection action's calculate result, and anything a respond hook builds. An action declares it as `reply`: a zod schema for the body (at the action's default status), or `{ status, body }` when respond returns another status. It is type-checked against the actual reply: every body the action can send must fit the schema, the keys must match, and the status must be the one respond returns. `blendx generate` reads it without running any hook. Chosen over calling respond at generate time, which runs user code on fake input and still misses collection actions without a respond hook. `Reply.schema`, which nothing read, is removed. A reply that is neither declared nor derivable stays a warning. A mismatch is a type error on the action's call that names the reason (`ReplyError<"...">`). The check runs on the builder's return type, after inference: placed anywhere in the spec's type, it made TypeScript fix R and Result (while typing respond and calculate) before they were inferred.

## D13: Double precision columns are unbounded (2026-09-13)
drizzle-zod bounds `doublePrecision` to plus or minus 2^47, so a real double such as `1e20` was rejected. The default rules replace that bound with `z.number()`, using drizzle-zod's callback refine. The callback keeps drizzle-zod's null and optional handling; a plain schema refine drops it, so a nullable double would reject `null`.
Rule id DR-DOUBLE-UNBOUNDED. This closes the Inbox item from the D8 note.
