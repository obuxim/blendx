# blendx todo

One item ≈ one focused session. Work top to bottom (see "Todo loop" in `CLAUDE.md`). Tick an item only when `bun run check` passes **and** its done-criterion is verified. One commit per item: `P5.3: <summary>`.

## P0 Scaffold
- [x] P0.1 git init, .gitignore, .editorconfig, root package.json (workspaces packages/*, examples/*), bunfig.toml (exact pins). Done: `bun install` succeeds.
- [x] P0.2 Package skeletons: blendx, spec, core, dbml, hono, cli, conformance. Done: each code package is importable by name from a test.
- [x] P0.3 tsconfig.base (TS 7, strict, bundler, verbatimModuleSyntax, noUncheckedIndexedAccess) + root tsconfig (types: ["bun"]) + tsconfig.portable.json (types: [], core + dbml src). Done: both `tsc --noEmit` runs pass, and a Bun global in core fails the portable check.
- [x] P0.4 biome.json: ignores generated paths; noRestrictedImports for bun/hono in core + dbml. Done: `biome check .` passes, and a restricted import is flagged.
- [x] P0.5 Scripts `check` / `fix` / `test` + first sample test. Done: `bun run check` passes.
- [x] P0.6 GitHub Actions workflow (check job + postgres:18 service job). Done: the workflow file exists and the same steps pass locally (no remote yet).
- [x] P0.7 CLAUDE.md, docs/todo.md, docs/decisions.md. Done: committed.

## P1 Spikes (kept as permanent regression tests)
- [x] P1.1 Explicitly typed `[validator, handler]` tuple + chained routes → `hc` types: json input, 201 body, 422 union. Done: expectTypeOf + @ts-expect-error pass under tsc, and a runtime call through `hc` works.
- [x] P1.2 `c.json(problem, 422, { 'Content-Type': 'application/problem+json' })` keeps its TypedResponse and the header. Done: runtime + type test.
- [x] P1.3 drizzle-zod 0.8.3 + zod 4.6.2 on a pgTable (varchar(n), pgEnum, identity, string-mode timestamp, double). Done: a max-length error test and a z.infer type test pass, and the schemas unify with the `zod` import.
- [x] P1.4 @dbml/core parses the addition DBML + a kitchen-sink DBML. Done: a snapshot of fields/refs/enums/indexes is committed.
- [x] P1.5 PGlite + drizzle-orm/pglite migrator applies a drizzle-kit-generated migration inside bun test. Done: test passes.
- [x] P1.6 `z.toJSONSchema` on drizzle-zod schemas (io input/output, draft 2020-12). Done: snapshot committed, no unrepresentable-type errors.
- [x] P1.7 @typescript/typescript6 extracts `calculate` source + return-type keys (literal, spread, conditional). Done: test returns the expected keys.
- [x] P1.8 Confirm or amend ADRs D5 to D8 with spike results. Done: decisions.md updated.

## P2 DBML → IR → Drizzle
- [x] P2.1 SchemaIR types + conventions (timestamps, soft delete via `deleted_at`, generated columns). Done: types + IR unit test.
- [x] P2.2 `parseDbml` → IR, errors with line/col. Done: addition, kitchen-sink and syntax-error tests.
- [x] P2.3 Type-mapping table (int/serial/bigint/varchar/char/text/bool/double/real/numeric/date/timestamp[tz]/time/uuid/json[b]/enum/arrays; unknown → error). Done: table-driven tests.
- [x] P2.4 IR validation (missing PK, composite PK, reserved query-name columns, identifier collisions). Done: tests.
- [x] P2.5 `emitDrizzle` → schema.gen.ts (pgEnum, pgTable, identity, references + onDelete, named uniques/indexes, `models` const + meta). Done: golden test.
- [x] P2.6 Generated schema passes tsc; drizzle-kit generates SQL; PGlite migrates. Done: integration test.
- [x] P2.7 `meta.constraints` (constraint name → kind, columns). Done: golden + test.

## P3 Authoring API & types (highest risk: type inference)
- [x] P3.0 Inference spike: choose the blend() authoring shape. Done: one call per action (`actions: (a) => [a.index(), a.store({ rules, calculate })]`) infers in every case; recorded as D12.
- [x] P3.1 Model / Row / Insert / Writes / Column / PublicRow helpers. Done: type tests against the P2 golden.
- [x] P3.2 Policies `allow.public | authenticated | owner(col) | when(fn)`, `deny`, `requiresAuth`. Done: unit + type tests.
- [x] P3.3 `blend()` + ResourceSpec with the D12 action builder (required policy, the actions array as the exposure list, `a.restore()` only with soft delete, real hidden columns, custom actions via `a.member` / `a.collection`). Done: positive + @ts-expect-error tests.
- [x] P3.4 Hook signatures: rules → calculate input inference (`() => z.object()` and `({prev}) => prev.extend()`), no db/request in calculate, unknown write key is an error, respond keeps its status literal. Done: type tests.
- [x] P3.5 `defineApp` (type-preserving app hooks, auth) + `Register` module augmentation. Done: type tests with a hand-written register.
- [x] P3.6 EndpointDefinition + `toEndpoints(resource)`, deterministic order. Done: unit test.
- [x] P3.7 `defineConfig` + config loader/validation. Done: tests.

## P4 Rules & cascade
- [x] P4.1 Default rules per action (store: strict insert minus generated; update: partial; index: query; member: none; custom: empty). Done: one test per derivation rule id.
- [x] P4.2 `packages/spec/derivation-rules.md` table mirroring the test ids. Done: every rule id links to a test.
- [x] P4.3 Cascade resolver schema → app → resource → action, `prev` vs `runDefault`, provenance recorded. Done: replace/extend tests at every level.
- [x] P4.4 Policy → authorize hook, schema-level deny. Done: tests.

## P5 Engine
- [ ] P5.1 ProblemDetails model + builders (400/401/403/404/409/422/500) + zod issues → JSON pointers. Done: unit tests.
- [ ] P5.2 `execute()` skeleton + early 401 + walking skeleton: addition store on PGlite. Done: 201 with the saved record (`result: 7`).
- [ ] P5.3 Default load: findOrFail, soft-delete scope, restore loads trashed rows, index list with pagination/sort/filter. Done: tests.
- [ ] P5.4 Default save: insert/patch/delete/soft delete/restore, timestamps, returning, writable-key guard. Done: tests.
- [ ] P5.5 Default respond: 201/200/204, index envelope, hidden fields stripped. Done: tests.
- [ ] P5.6 Transactions + `FOR UPDATE` on member mutations; respond after commit. Done: rollback test (lock test on real PG).
- [ ] P5.7 PG error mapping: 23505 → 409, 23503/23502/22P02/22001 → 422 with pointers. Done: tests.
- [ ] P5.8 Custom member/collection action defaults. Done: tests.

## P6 Hono adapter
- [ ] P6.1 BlendxEnv + `createServer` (db/auth injection, onError/notFound → problem, malformed JSON → 400). Done: app.request tests.
- [ ] P6.2 `run()` with explicit tuple types delegating to `execute`. Done: all addition actions work over hand-written routes.
- [ ] P6.3 RPC type tests (per-action input, status narrowing, problem type, 204). Done: tsc.
- [ ] P6.4 Node smoke test: @hono/node-server + pg driver. Done: script exits 0.

## P7 Generators & CLI
- [ ] P7.1 routes.gen.ts emitter (thin, sorted, collection customs before `/:id`, exports AppType). Done: golden + tsc.
- [ ] P7.2 register.gen.ts + drizzle.config.gen.ts emitters. Done: goldens.
- [ ] P7.3 CLI shell (util.parseArgs, help, exit codes). Done: `blendx --help` works.
- [ ] P7.4 `blendx generate`, two-phase (DBML → schema; then blends → routes/register/openapi). Done: fixture output equals goldens.
- [ ] P7.5 `generate --check` with unified diff. Done: drift exits 1.
- [ ] P7.6 `blendx migrate generate` (drizzle-kit subprocess) + `migrate up` (per-driver migrator). Done: applies on PGlite + local PG.
- [ ] P7.7 `createDatabase(config)` with dynamic driver imports (pg, postgres-js, bun-sql, pglite). Done: pglite + pg tests.

## P8 examples/addition
- [ ] P8.1 schema.dbml, blendx.config.ts, src/app.ts, blends/addition_results.ts, server.ts; generated artifacts committed. Done: `generate --check` passes.
- [ ] P8.2 E2E on PGlite: `{a:4,b:3}` → 201 `result: 7`; 422 bad type; 422 unknown key; 404 show; soft delete hides from index; restore. Done: bun test.
- [ ] P8.3 `hc<AppType>` typed + runtime client test. Done: tsc + test.
- [ ] P8.4 Same suite on local PostgreSQL 18 (`BLENDX_TEST_DB=pg`). Done: passes.

## P9 OpenAPI
- [ ] P9.1 OpenAPI 3.1 builder (paths, params, request bodies io:input, responses per status, Problem component, public-record components, sorted keys). Done: snapshot.
- [ ] P9.2 Validate the output with @readme/openapi-parser. Done: test.
- [ ] P9.3 Wire into generate / --check; `respond` schema override; untyped warning. Done: golden.

## P10 Review
- [ ] P10.1 Review model: resolved stages + provenance + compact rules from JSON Schema. Done: unit test.
- [ ] P10.2 `calculate` source + `writes` via the typescript6 program (default calculate → rules keys). Done: literal/spread/conditional tests.
- [ ] P10.3 YAML emitter (yaml Document API, `# from:` comments, `format: 1`, deterministic). Done: golden `review/addition_results.yaml`.
- [ ] P10.4 `blendx review` + `--check` (diff, exit codes). Done: drift test.
- [ ] P10.5 Examples runner (validate → calculate → deep-equal), usable from bun test and inside `--check`. Done: pass case + readable failure.
- [ ] P10.6 Fix-request workflow test (edit YAML → check fails → change blend → passes) + doc. Done: test + doc.

## P11 Conformance
- [ ] P11.1 Case format + matchers ($any, $int, $iso8601, $absent) in `packages/spec/conformance.md`. Done: doc + types.
- [ ] P11.2 `runConformance(cases, fetch, { reset })`. Done: unit tests.
- [ ] P11.3 Shop fixture (users: hidden password, unique email; orders: FK, enum, soft delete, owner policy, `refund` member action, `quote` collection action, filters). Done: `generate --check` passes.
- [ ] P11.4 One case per derivation rule and per error status. Done: coverage meta-test passes.
- [ ] P11.5 Matrix: Bun + PGlite, Bun + pg, Node + pg. Done: all three pass (locally, and as CI jobs).
- [ ] P11.6 bun-sql opt-in run, results recorded. Done: ADR entry.

## P12 Docs & polish
- [ ] P12.1 Spec docs: pipeline, cascade, errors, review-format (each linked to test ids). Done: docs exist, links resolve.
- [ ] P12.2 Final CLAUDE.md + app-author CLAUDE.md template in examples/addition. Done: dry-run "add a table + a custom action" using only the docs.
- [ ] P12.3 One-page blend cookbook (10 patterns). Done: doc.
- [ ] P12.4 `bun build --compile` CLI (drizzle-kit external). Done: binary runs generate/review in the example.
- [ ] P12.5 README + publish prep. Done: README.
- [ ] P12.6 Drizzle 1.0 GA migration spike (drizzle-orm/zod, kit folder format). Done: ADR go/no-go.

## Inbox
Discovered work goes here. Triage it into a phase before starting it.
- [ ] Remove the postMessage workaround in `packages/dbml/src/dbml-core.ts` once `packages/dbml/test/bun-42512.test.ts` fails (Bun fixed oven-sh/bun#42512).
- [x] P4.1: decide whether to drop drizzle-zod's ±2^47 bounds on `doublePrecision` columns (real doubles like 1e20 are rejected today). Decided in D13: dropped.
- [ ] P9.1: add `format: date-time` / `date` to string-mode timestamp and date columns in OpenAPI output. See D8 note.

## Next: React adapter (not in current scope; don't start until asked)
- [ ] N.1 `@blendx/react`: `createBlendxClient<AppType>()` → TanStack Query hooks per resource/action over `hc`.
- [ ] N.2 Query-key derivation + invalidation (store/update/destroy invalidate index/show).
- [ ] N.3 Problem Details pointers → form field errors helper.
- [ ] N.4 Type tests: hook input/output parity with `hc`.
- [ ] N.5 `examples/addition/web` (React + Vite) consuming `AppType` + e2e test.
