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
- [x] P5.1 ProblemDetails model + builders (400/401/403/404/409/422/500) + zod issues → JSON pointers. Done: unit tests.
- [x] P5.2 `execute()` skeleton + early 401 + walking skeleton: addition store on PGlite. Done: 201 with the saved record (`result: 7`).
- [x] P5.3 Default load: findOrFail, soft-delete scope, restore loads trashed rows, index list with pagination/sort/filter. Done: tests.
- [x] P5.4 Default save: insert/patch/delete/soft delete/restore, timestamps, returning, writable-key guard. Done: tests.
- [x] P5.5 Default respond: 201/200/204, index envelope, hidden fields stripped. Done: tests.
- [x] P5.6 Transactions + `FOR UPDATE` on member mutations; respond after commit. Done: rollback test (lock test on real PG).
- [x] P5.7 PG error mapping: 23505 → 409, 23503/23502/22P02/22001 → 422 with pointers. Done: tests.
- [x] P5.8 Custom member/collection action defaults. Done: tests.

## P6 Hono adapter
- [x] P6.1 BlendxEnv + `createServer` (db/auth injection, onError/notFound → problem, malformed JSON → 400). Done: app.request tests.
- [x] P6.2 `run()` with explicit tuple types delegating to `execute`. Done: all addition actions work over hand-written routes.
- [x] P6.3 RPC type tests (per-action input, status narrowing, problem type, 204). Done: tsc.
- [x] P6.4 Node smoke test: @hono/node-server + pg driver. Done: script exits 0.

## P7 Generators & CLI
- [x] P7.1 routes.gen.ts emitter (thin, sorted, collection customs before `/:id`, exports AppType). Done: golden + tsc.
- [x] P7.2 register.gen.ts + drizzle.config.gen.ts emitters. Done: goldens.
- [x] P7.3 CLI shell (util.parseArgs, help, exit codes). Done: `blendx --help` works.
- [x] P7.4 `blendx generate`, two-phase (DBML → schema; then blends → routes/register/openapi). Done: fixture output equals goldens.
- [x] P7.5 `generate --check` with unified diff. Done: drift exits 1.
- [x] P7.7 `createDatabase(config)` with dynamic driver imports (pg, postgres-js, bun-sql, pglite). Done: pglite + pg tests. (Before P7.6: `migrate up` opens the database through it.)
- [x] P7.6 `blendx migrate generate` (drizzle-kit subprocess) + `migrate up` (per-driver migrator). Done: applies on PGlite + local PG.

## P8 examples/addition
- [x] P8.1 schema.dbml, blendx.config.ts, src/app.ts, blends/addition_results.ts, server.ts; generated artifacts committed. Done: `generate --check` passes.
- [x] P8.2 E2E on PGlite: `{a:4,b:3}` → 201 `result: 7`; 422 bad type; 422 unknown key; 404 show; soft delete hides from index; restore. Done: bun test.
- [x] P8.3 `hc<AppType>` typed + runtime client test. Done: tsc + test.
- [x] P8.4 Same suite on local PostgreSQL 18 (`BLENDX_TEST_DB=pg`). Done: passes.

## P9 OpenAPI
- [x] P9.1 OpenAPI 3.1 builder (paths, params, request bodies io:input, responses per status, Problem component, public-record components, sorted keys). Done: snapshot.
- [x] P9.2 Validate the output with @readme/openapi-parser. Done: test.
- [x] P9.3 Wire openapi.json into generate / --check; replies it cannot describe print warnings. Done: golden.
- [x] P9.4 `reply` on an action (D14): a type-checked schema for a reply blendx can't derive, so OpenAPI describes it instead of warning. Done: type tests + OpenAPI snapshot.

## P10 Review
- [x] P10.1 Review model: resolved stages + provenance + compact rules from JSON Schema. Done: unit test.
- [x] P10.2 `calculate` source + `writes` via the typescript6 program (default calculate → rules keys). Done: literal/spread/conditional tests.
- [x] P10.3 YAML emitter (yaml Document API, `# from:` comments, `format: 1`, deterministic). Done: golden `review/addition_results.yaml`.
- [x] P10.4 `blendx review` + `--check` (diff, exit codes). Done: drift test.
- [x] P10.5 Examples runner (validate → calculate → deep-equal), usable from bun test and inside `--check`. Done: pass case + readable failure.
- [x] P10.6 Fix-request workflow test (edit YAML → check fails → change blend → passes) + doc. Done: test + doc.

## P11 Conformance
- [x] P11.1 Case format + matchers ($any, $int, $timestamp, $absent; `$timestamp` replaces the planned `$iso8601`, see D15) in `packages/spec/conformance.md`. Done: doc + types.
- [x] P11.2 `runConformance(cases, fetch, { reset })`. Done: unit tests.
- [x] P11.3 Shop fixture (users: hidden password, unique email; orders: FK, enum, soft delete, owner policy, `refund` member action, `quote` collection action, filters). Done: `generate --check` passes.
- [x] P11.4a Harness: serve the shop fixture in-process (committed migration, reset = truncate + `seed.sql`), load `cases/*.json`, raw `text` request bodies; one case per error status (400, 401, 403, 404, 409, 422). Done: the suite passes on Bun + PGlite.
- [x] P11.4b One case per derivation rule. Done: coverage meta-test (every DR id and every error status has a case) passes.
- [x] P11.5 Matrix: Bun + PGlite, Bun + pg, Node + pg. Done: all three pass (locally, and as CI jobs).
- [x] P11.7 `databaseError` also reads the SQLSTATE from `errno` when `code` is not one, as bun-sql's `PostgresError` has it (D16); bun-sql joins the conformance matrix. Done: all cases pass on bun-sql, and a unit test without a database.
- [x] P11.6 bun-sql opt-in run, results recorded. Done: ADR entry.

## P12 Docs & polish
- [x] P12.1 Spec docs: pipeline, cascade, errors, review-format (each linked to test ids). Done: docs exist, links resolve.
- [x] P12.2 Final CLAUDE.md + app-author CLAUDE.md template in examples/addition. Done: dry-run "add a table + a custom action" using only the docs.
- [x] P12.3 One-page blend cookbook (10 patterns). Done: doc.
- [x] P12.4 `bun build --compile` CLI. Decided against for v1 (D17): the CLI ships only as a package bin, `bunx blendx` (`@blendx/cli`'s since D18).
- [x] P12.5a Split the runtime from the CLI (D18): `blendx` drops its bin and its dependency on `@blendx/cli`, which owns the `blendx` bin and `@blendx/cli/examples`. Done: `bunx blendx` works from the repo and from the example, and `bun run check` passes.
- [x] P12.5b README. Done: README.
- [x] P12.6 Drizzle 1.0 GA migration spike (drizzle-orm/zod, kit folder format). Done: ADR go/no-go. Decided in D19: no-go until 1.0.0 is on npm `latest`; the upgrade checklist is in D19.

## P13 Own our dependencies' gaps (don't wait on upstream)
- [x] P13.1 Upgrade to Drizzle 1.0.0-rc.4 now, exactly pinned (D20 replaces D19's wait): `drizzle-orm/zod` instead of drizzle-zod, the type renames, migration folders converted with `drizzle-kit up`, `blendx migrate` on the 1.0 layout. Done: `bun run check`, plus the pg, bun-sql and Node rows of the matrix, pass.
- [x] P13.2 Our own DBML parser for the subset blendx accepts, replacing @dbml/core and the oven-sh/bun#42512 workaround (D21). Done: the DBML tests and goldens pass on it, @dbml/core and `loadDbmlCore()` are gone.
- [x] P13.3 An index on an expression marked `pk`, `` (`lower(id)`) [pk] ``, is refused with the same located error as any other expression index. Today it gives `primaryKey: ['lower(id)']`. (Found by the P13.2 review; the bug predates P13.2.) Done: the parser test refuses both kinds of expression index, each at its line.
- [x] P13.4 Composite refs that are the same relation written differently, `a.(x, y) > b.(p, q)` and `b.(q, p) < a.(y, x)`, are reported as defined twice. (P13.2 review.) Done: the parser test reports that pair, and not a ref that pairs the same columns differently.
- [x] P13.5 A `'''` string takes the escapes upstream DBML gives it, so it can end in a quote. Today the first `'''` closes the string, and `'''it is ''a''''` is reported as unterminated. (P13.2 review.) Done: `'''` strings take the escapes of `'...'` strings, and a `\` at the end of a line joins the next, as upstream's lexer does (`@dbml/parse`, `escapedString`).
- [x] P13.6 Strings take the rest of upstream's escapes: `\r`, `\0`, `\b`, `\v`, `\f` and `\uHHHH`, and `\ ` keeps its backslash. Today blendx reads each as the bare character (`\r` is `r`), in `'...'` and `'''...'''` strings alike. (Found while doing P13.5.) Done: the parser test reads each escape as upstream does, and refuses a `\u` without four hex digits, at its backslash.
- [x] P13.7 A `'''` string's escapes and its indentation removal run in the order upstream uses. Today blendx applies escapes first, so a `\n` escape starts a line that is dedented too. (Found while doing P13.5.) Done: upstream's `normalizeNote` (`@dbml/parse`, `core/utils/interpret.ts`) gets the lexer's value, escapes already read, so the order was already upstream's; a parser test pins it.
- [x] P13.8 Notes are trimmed as upstream trims them (`normalizeNote`, `@dbml/parse`'s `core/utils/interpret.ts`): leading blank lines dropped, then the common indentation, in either kind of string, and a trailing line break kept. Other strings are kept as written. Today blendx removes the first and last line break of every `'''` string, and its indentation. (Found while doing P13.7.) Done: `normalizeNote` is ported, and a parser test pins a note in each kind of string, one with CRLF, and a `'''` default kept as written.

## P14 A guide for app authors, and a second example
- [x] P14.1 `examples/expenses`, built from scratch as the guide will tell it: users who sign up for a bearer token, expense claims with an owner policy and an approver role, state rules on member actions, pure pricing in calculate, a `quote` collection action, review examples and end-to-end tests. Done: `bun run check` passes with the example in its typecheck, generate and review checks.
- [x] P14.2 `docs/guide/`, the app author's guide: getting started (in the monorepo, or in an app of its own through `bun link`), a tutorial that builds `examples/expenses`, and reference pages (schema, blends, hooks, the app and identity, the HTTP API and typed client, review, testing, configuration and deployment, the CLI). README and CLAUDE.md link to it. Done: every command and reply the guide shows was run, and every link resolves.
- [x] P14.3 `docs/guide/known-issues.md`: the Inbox findings of P14.1 and P14.2 that app authors meet, each with what happens and what to do instead, linked from the guide index, the README and the pages that mention them. An entry leaves the page when its Inbox item is fixed. Done: every link resolves, and each entry matches an Inbox item.

## P15 Fixes from the guide
Found while building `examples/expenses` and writing `docs/guide` (P14). Each item also removes its entry from `docs/guide/known-issues.md`, and updates the guide and the example where they work around it.
- [x] P15.1 App hooks type `auth` from the app's own `auth` function, not through `Register`: going through `Register` makes an app-level authorize hook that reads `auth` a circular type (TS2502). Done: a type test in the Register project, with an app authorize hook that reads `auth`, passes tsc; the guide shows app hooks reading the identity.
- [x] P15.2 SQLSTATE 22007 (invalid datetime format) and 22008 (datetime field overflow) answer 422 with a pointer, instead of 500 (D23). Done: an engine test, `packages/spec/errors.md`, and a conformance case.
- [x] P15.3 Date and timestamp columns check their format by default (D23): a date is `YYYY-MM-DD` naming a real day; a timestamp is ISO 8601 or PostgreSQL's text form. Done: a derivation rule id with its test, spec entry and conformance case; OpenAPI and the review describe the forms; `examples/expenses` drops its own `spent_on` rule.
- [ ] P15.4 calculate's `prev` is typed as the writable columns the input can carry, not all of `Writes<M>`, so the review of `({ prev }) => ({ ...prev, total })` names exactly those columns. Done: type tests, and a review test with a spread `prev`.
- [ ] P15.5 The review describes a string with a format by the format alone, without zod's pattern. Done: a json-schema test; the review goldens and the example review files updated.
- [ ] P15.6 An action whose rules are the empty object takes no body in its route type, as OpenAPI already gives it no request body. Done: an RPC type test; the expenses client test calls `submit` without `json: {}`.
- [ ] P15.7 index takes a declared `scope` (D22): column equalities the default load adds to its filters, failing closed on a missing value, with its source in the review. Done: tests that pages and totals count only the rows in scope, a spec entry and a conformance case, cookbook pattern 7 rewritten, and `examples/expenses` lists a claimant's own claims without `?user_id=`.
- [ ] P15.8 One action's reply may carry a hidden column, such as a token returned once at sign-up. Decide the shape first (D24; proposed during triage: a `reveal` list on the action). Done: D24; type tests; the engine, OpenAPI and the review show which replies carry the column; `examples/expenses` hides `api_token` except in the sign-up reply.

## Inbox
Discovered work goes here. Triage it into a phase before starting it.
- [x] Remove the postMessage workaround in `packages/dbml/src/dbml-core.ts` once `packages/dbml/test/bun-42512.test.ts` fails (Bun fixed oven-sh/bun#42512). Removed by D21 without waiting: blendx parses DBML itself.
- [x] P4.1: decide whether to drop drizzle-zod's ±2^47 bounds on `doublePrecision` columns (real doubles like 1e20 are rejected today). Decided in D13: dropped.
- [x] P9.1: add `format: date-time` / `date` to string-mode timestamp and date columns in OpenAPI output. Decided in the D8 P9.1 note: `format: date` on date columns only; Postgres timestamps are not RFC 3339, so they stay plain strings.
- [x] P12.5: the `blendx` facade depends on `@blendx/cli` for its bin (D9 note), so production installs also get the CLI's dependencies (drizzle-kit, typescript6 once review lands). Decide before publishing whether to make them optional or lazy. Decided in D18: split; now P12.5a.
- [x] Upgrade to Drizzle 1.0.0 once it is on npm `latest`, following the D19 checklist, with the new pins recorded (D5). Now P13.1, without waiting.
- [x] Date and timestamp columns accept any string (DR-DATE-STRING), and PostgreSQL decides. It reads words such as `yesterday` as dates, and a value it cannot read, such as `2026-02-30`, answers 500 (SQLSTATE 22008, or 22007 when malformed) instead of 422. Decide between a format in the derived rule, mapping 22007 and 22008 to 422, or both. (Found while building P14.1, whose `spent_on` rule is `z.iso.date()` for now.) Decided in D23, both: now P15.2 and P15.3.
- [x] The review lists every writable column under `writes` for a calculate that spreads `prev` (`({ prev }) => ({ ...prev, total })`): `prev` is typed as all of `Writes<M>`, though at run time it holds only the input's writable columns. Type `prev` from the input so the review names what is written. (P14.1 spreads `input` instead.) Now P15.4.
- [x] The review prints zod's whole regex after a string format: `spent_on: string (date), matching ^(?:(?:\d\d[2468]...`, and the same for `email` and `uuid`. The format alone says it. (P14.1.) Now P15.5.
- [x] An index scoped to the requester has no correct pages: a load hook's `runDefault()` takes no filter, and cookbook pattern 7 filters one page after loading it, so `meta.total` and the page sizes are wrong once rows span pages. Consider `runDefault({ where })` or a scope hook. (P14.1 asks non-approvers for `?user_id=` and checks it in authorize.) Decided in D22, a declared `scope`: now P15.7.
- [x] A column that one reply must carry and every other reply must hide, such as an API token returned once at signup, has no way to say so: `hidden` applies to the whole resource, and respond sees only the public record. (P14.1 leaves `api_token` visible and exposes users only through store and an owner-only show.) Now P15.8, which decides its shape first.
- [x] An app-level authorize hook that reads `auth` does not typecheck in a registered app: `RegisteredAuth` comes from `typeof app`, whose hook types need `RegisteredAuth`, so tsc reports TS2502 (`'auth' is referenced directly or indirectly in its own type annotation`), even with the hook's parameter annotated. It runs correctly, and resource hooks and policies read `auth` with its type. (Found while writing the P14.2 guide, which points app authors to resource hooks for now.) Now P15.1.
- [x] The typed client makes a custom POST action without rules take `json: {}` (`client.expenses[':id'].submit.$post({ param, json: {} })`), while built-in `restore` takes only `param`. Decide whether an action whose rules are the empty object should take no body in its route type. (P14.2's client test passes `json: {}`.) Decided: it takes none, as OpenAPI already says; now P15.6.

## Next: React adapter (not in current scope; don't start until asked)
- [ ] N.1 `@blendx/react`: `createBlendxClient<AppType>()` → TanStack Query hooks per resource/action over `hc`.
- [ ] N.2 Query-key derivation + invalidation (store/update/destroy invalidate index/show).
- [ ] N.3 Problem Details pointers → form field errors helper.
- [ ] N.4 Type tests: hook input/output parity with `hc`.
- [ ] N.5 `examples/addition/web` (React + Vite) consuming `AppType` + e2e test.
