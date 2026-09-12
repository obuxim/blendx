# Decisions

Short ADR log. Newest last. Each entry: decision, why, consequences. Change a decision by adding a new entry that supersedes the old one.

## D1: Stack (2026-09-13)
TypeScript · Bun (runtime, test runner, workspaces) · Hono (+ RPC) · Drizzle · PostgreSQL · Zod (+ drizzle-zod) · Biome · PGlite for tests.
**Why:** TypeScript is the best balance of AI fluency and compile-time checking, and its type system can derive types from values (schemas). Bun bundles runtime, test runner and workspaces. Hono is built on web standards and runs on Bun and Node.
**Consequence:** `tsc --noEmit` is required, because Bun strips types without checking them.

## D2: Schema source is DBML (2026-09-13)
`schema.dbml` → generated Drizzle schema → drizzle-kit migrations + inferred types. Nothing inspects the database at runtime.
**Consequence:** DBML can't express hidden fields or exposure. Those live in blends.

## D3: Pipeline and hooks (2026-09-13)
Order: authenticate → validate → load → authorize → calculate → save → respond. One hook per stage. Cascade: schema → app → resource → action.
**Why load comes before authorize:** ownership policies need the record. 401 is still decided first, via the policy's `requiresAuth`.
**Why effect stages are lazy:** `load`/`save` receive `runDefault()` so an override can skip the default query entirely. Value stages receive `prev`.
**Consequence:** `calculate` is pure and sync, and its signature carries no db or request.

## D4: Default-deny, strict input, Problem Details (2026-09-13)
`policy` is required and actions are listed explicitly. Input schemas are `.strict()`: unknown keys → 422. Generated columns are never input. Errors follow RFC 9457. PG errors are mapped rather than pre-queried: 23505 → 409; 23503/23502/22P02 → 422.
**Why:** fixes larablend's mass assignment and open-by-default exposure.

## D5: TypeScript 7.0.2 + typescript6 compiler API (2026-09-13)
`tsc` is TS 7.0.2 (native compiler). It needs `"types": ["bun"]` explicitly; `baseUrl` and `node10` resolution are gone. TS 7.0 has no programmatic compiler API, so the CLI's review step uses `@typescript/typescript6` to read `calculate`'s source and return type.
**Revisit:** switch to TS 7.1's API when it ships. Fallback if a type test ever diverges: pin `typescript@6.0.3`.

## D6: Drizzle 0.45 pinned (2026-09-13)
drizzle-orm 0.45.2, drizzle-kit 0.31.10, drizzle-zod 0.8.3. Drizzle 1.0 is still a release candidate. All drizzle-zod imports stay in one module. Don't generate `relations()`.
**Revisit:** todo P12.6.

## D7: Default DB driver `pg` (2026-09-13)
node-postgres on Bun and Node. PGlite in tests. `bun-sql` is opt-in because of open Drizzle issues (JSON serialization, timezones). drizzle-kit is never bundled into the compiled CLI.

## D8: Own OpenAPI generator (2026-09-13)
Walk the endpoint definitions and use `z.toJSONSchema` (draft 2020-12, which is OpenAPI 3.1). `@hono/zod-openapi` is rejected: it needs a hand-written spec per route and would bloat `routes.gen.ts`.

## D9: Generation and review (2026-09-13)
`blendx generate` writes `src/generated/` (`schema.gen.ts`, thin `routes.gen.ts` exporting `AppType`, `register.gen.ts`, `drizzle.config.gen.ts`, `openapi.json`). `run()` declares its return type explicitly (hono#4498 history). There is no YAML input; `blendx review` writes `review/*.yaml` (mechanically derived, with provenance), while `*.examples.yaml` is human-owned and runs as tests.

### D9 note: P1.1 spike result (2026-09-13)
Confirmed with hono 4.13.7: an explicitly typed `readonly [MiddlewareHandler, Handler]` tuple spread into a chained route keeps `hc` types (request input, 201 body, 422 Problem body, status narrowing). Status generics must be constrained to hono's `StatusCode`. Runtime tests use `testClient` from `hono/testing`, because `hc`'s `fetch` option is typed as `typeof fetch`, and Bun's `fetch` type carries an extra `preconnect` member. Regression test: `packages/hono/test/spikes/p1-1-rpc-tuple.test.ts`.

### D4 note: P1.2 spike result (2026-09-13)
`c.json(problem, status, { 'Content-Type': 'application/problem+json' })` keeps its `TypedResponse`, so `hc` sees the Problem body under its status, and Hono sends our Content-Type instead of `application/json`. Regression test: `packages/hono/test/spikes/p1-2-problem-json.test.ts`.

## D10: Out of scope for v1 (2026-09-13)
Composite PKs, `?include=` relations, force-delete, PUT, and a post-commit side-effect stage (future: outbox or an `after` stage). The React adapter is the next phase.
