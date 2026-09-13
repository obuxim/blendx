# blendx

AI-first, API-only TypeScript framework. **The only code anyone writes is business logic; everything else is derived from `schema.dbml`.** That means fewer output tokens, a smaller codebase for every future task to read, and a smaller human review surface. Successor to larablend (Laravel, 2020).

Status: the framework is under construction. Work is driven by `docs/todo.md` (see "Todo loop"). Rationale: `docs/decisions.md`. Normative spec (grows over time): `packages/spec/`.

## Commands

- `bun install`
- `bun run check`: Biome, then `tsc --noEmit` (root, `tsconfig.portable.json`, and each project that augments `Register` and so needs a program of its own: `packages/core/test/register`, `packages/cli/test/register`, `packages/cli/test/fixtures/shop-app`, `examples/addition`, `examples/expenses`), then `blendx generate --check` on the examples, then `bun test`. Must pass before ticking any todo item.
- `bun run fix`: Biome autofix and format.
- `bun test <path>`: run a subset. Tests use in-process PGlite. `BLENDX_TEST_DB=pg DATABASE_URL=postgres://postgres@localhost:5432/blendx_test bun test` also runs the real-PostgreSQL tests (`*.pg.test.ts`); they reset that database's public schema, so use a scratch database.
- `DATABASE_URL=... bun run smoke:node`: the Node smoke test (Node 24, @hono/node-server, pg). It resets the same scratch database.
- `DATABASE_URL=... bun run conformance:node`: the conformance suite on Node with pg. Bun with PGlite runs in `bun test`, and Bun with pg in the `BLENDX_TEST_DB=pg` run. All three reset the scratch database.
- `bunx blendx generate [--check]`, `bunx blendx review [--check]`, `bunx blendx migrate generate|up`: the CLI. `--cwd <app>` runs it on another folder, such as `examples/addition`.

## Layout

`packages/blendx` (facade: the only runtime import for app code), `spec` (Markdown only), `core` + `dbml` (portable), `hono` (adapter), `cli` (the `blendx` command; apps add it as a dev dependency, D18), `conformance` (cases, the shop fixture and the harness); `examples/addition` (end-to-end proof) and `examples/expenses` (a fuller app: a bearer-token identity, an approver role, state rules and pricing).

Working on an app built with blendx rather than on the framework? Its own `CLAUDE.md` is the guide: `examples/addition/CLAUDE.md` is the template, with the recipes for adding a table and a custom action. `docs/cookbook.md` has ten blend patterns, each linked to the test that pins it.

## Who writes what

| Path | Owner |
|---|---|
| `schema.dbml`, `blends/*.ts`, `src/app.ts`, tests, `packages/**` source | you |
| `src/generated/**` (`*.gen.ts`, `openapi.json`), `drizzle/**` | generated. **Never read or edit.** Run `blendx generate`. |
| `review/<resource>.yaml` | generated review artifact. Never hand-edit. If a human edited it, the diff is a fix request: change blends until `blendx review --check` passes. |
| `review/<resource>.examples.yaml` | human-owned. Don't edit unless asked. |

## The pattern

- Pipeline per endpoint: **authenticate → validate → load → authorize → calculate → save → respond**. Error precedence 401 → 422 → 404 → 403 → 409.
- Cascade per hook: **schema default → app → resource → action**. Each level receives the result of the level above; the most specific wins.
- Actions: `index`, `show`, `store`, `update` (PATCH), `destroy` (204), `restore` (soft-delete tables only), plus custom actions (`on: 'member' | 'collection'`).
- Mutations run in one transaction (member loads `FOR UPDATE`); `respond` runs after commit.

## Hook rules

- One hook per stage: `rules`, `load`, `authorize`, `calculate`, `save`, `respond`.
- Value stages (`rules`, `authorize`, `calculate`, `respond`) receive `prev` and return the replacement. Ignore `prev` to replace it, use it to extend. Never mutate.
- Effect stages (`load`, `save`) receive `runDefault()`. Call it to extend, skip it to replace.
- `calculate({ prev, input, record })` is pure and synchronous: no db, no request, no I/O imports.
- Put `rules` before `calculate` in the object literal (type inference runs left to right).
- Override only the stage that differs from the default.
- A reply blendx can't derive (a collection action's calculate result, or what respond builds) declares `reply: z.object(...)` for OpenAPI, or `reply: { status, body }` when respond returns another status. `blendx generate` warns about any reply it can't describe.

## Conventions

- Default-deny: every `blend()` needs a `policy`, and only listed actions are exposed.
- Hidden fields (e.g. `password`) are declared in the blend, not in DBML.
- DBML names are kept verbatim (snake_case) in TS and JSON.
- Errors are RFC 9457 Problem Details. Input is strict: unknown keys → 422.
- App code imports only from `blendx` and uses its re-exported `z`.
- No YAML input. YAML is only the generated review output.

## Review fix requests

When `blendx review --check` fails, a human has asked for a change (`packages/spec/review-format.md`):
- A diff in `review/<resource>.yaml`: the `-` lines are what the reviewer wants, the `+` lines what the code does. Change the blend (policy, rule, hook, calculate) until the check passes. Never edit the YAML back.
- A failing example in `review/<resource>.examples.yaml`: the rules or calculate must change to produce it.
- Then run `blendx generate`, and `blendx review` if your change moved lines the reviewer did not edit.

## Framework development rules

- `packages/core` and `packages/dbml` stay portable: never import `bun`, `bun:*`, `hono` or Node-only APIs. Enforced by `tsconfig.portable.json` (no runtime globals) and Biome.
- Generators are deterministic and covered by golden tests.
- Every derivation rule has a test id, an entry in `packages/spec/derivation-rules.md`, and (from P11) a conformance case.
- Type-level guarantees live in `packages/*/test/types/*.types.test.ts` (`expectTypeOf` + `@ts-expect-error`) and are enforced by `tsc`.
- Relative imports use explicit `.ts` extensions (Node's type stripping needs them).
- blendx parses DBML itself (`packages/dbml/src/parser.ts`, D21). Syntax it starts to accept goes into `packages/spec/dbml.md` and `packages/dbml/test/parser.test.ts` with it.
- Dependency versions are exact pins. Changing one needs a `docs/decisions.md` entry.
- Record design decisions in `docs/decisions.md`.

## Todo loop

1. Take the first unchecked item in `docs/todo.md`. Triage Inbox items into a phase before working on them.
2. If an item is too big for one session, split it in the todo first.
3. Write tests first, then implement.
4. `bun run check` passes **and** the item's done-criterion is verified.
5. Tick the box and commit locally with the message `P5.3: <summary>`. One item per commit, then `git push` (origin is SSH: `git@github.com:obuxim/blendx.git`).
6. Put discovered work in Inbox, not into the current item. Stop and ask when an item raises a design question that `docs/decisions.md` doesn't settle.

Definition of done: `bun run check` passes. Besides Biome, tsc and the tests (the conformance suite on PGlite among them), it runs `blendx generate --check` on the examples and the conformance fixture, and `blendx review --check` on the examples.

## Roadmap

Current scope: API only. The next phase is the React adapter (`@blendx/react`: TanStack Query over `hc<AppType>`). See "Next" in `docs/todo.md`. Don't start it until asked.
