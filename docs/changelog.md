# Changelog

What each version changed, and what an app must do to upgrade. The six packages share one version (D35); bump `blendx`, `@blendx/cli` and, where used, `@blendx/react` together. Each entry is written before the tag, from the public API diff and the upgrade check of the release gate (`releasing.md`), not from memory.

## 0.2.0 (2026-09-25)

Phase P17: feedback from three apps built on 0.1.0 (`improvement-suggestions/`), decided in D36 to D39.

### To upgrade from 0.1.0

1. Bump the versions, then run `blendx generate` and `blendx review`. `client.gen.ts` has a new shape: each action is now an object (`route`, `writes`, and `sorts` on index) instead of a route string, and an `appActions` export follows the tables. The other generated files, the OpenAPI document and the review YAML are unchanged for an app that uses no new feature; the review YAML changes where a blend has custom `authorize` or `save` hooks, which it now shows with their source. Until you regenerate, `blendx generate --check` and `blendx review --check` fail, and `@blendx/react` 0.2.0 does not typecheck against the old `client.gen.ts`.
2. `database.migrate(folder)` now resolves to `{ schema, data }` (schema migrations applied, data-migration ids applied) instead of a count. Code that only awaits it, as the examples and the guide do, is unaffected.
3. Two types got stricter. In `@blendx/react`, an index query's `sort` is typed to the table's sort allowlist, so a sort that would have answered 422 at run time now fails to compile. `ProblemStatus` gained 413, which only matters to an exhaustive switch over it.

Verified by upgrading the addition example as committed at v0.1.0 to the packages on npm: install, generate, review, `tsc --noEmit` and its tests pass; `blendx migrate generate` finds no schema change.

### Added

- **Membership policies** (D36): `allow.member({ via, through })` scopes index and show to the caller's memberships with one `EXISTS` predicate, and validates store and update inside the transaction, including related ids. Rows an include nests are scoped the same way. The review names the root, the membership source and the related checks.
- **App actions** (D37): `defineApp({ actions: (a) => [a.action(name, { method, path, policy, input, reply, writes, handler })] })`, typed once and carried into `routes.gen.ts`, OpenAPI, `client.gen.ts` and `@blendx/react` (`api.appActions.<name>.queryOptions` or `mutationOptions`, with declared invalidation). Multipart input with `maxBytes` (413 when exceeded). Constraint violations from a handler's SQL map like the engine's: 23505 to 409, 23503 to 422, or 409 on DELETE.
- **Data migrations** (D38): `dataMigration({ id, up })` modules in `data-migrations/`, run by `blendx migrate up` and `database.migrate(folder, steps)` after the schema migrations, each in its own transaction, recorded in a ledger so a rerun skips it. `DataMigrationError` names the failed id.
- **Relation writes** (D39): `replaceRelation({ tx, through, owner, targets, eligible })` replaces a many-to-many set atomically with same-root validation; invalid ids roll the whole replacement back.
- **Declared writes**: `a.update({ writes: [models.users] })` and the like say which other tables a custom save touches; the review shows them and `@blendx/react` invalidates them.
- `blendx/drizzle` exports `eq`, `and`, `or`, `inArray`, `isNull` and the other common operators beside `sql`.
- The review YAML shows custom `authorize` and `save` stages with their source location and the readable hook source, indentation normalized; index sort allowlists reach `client.gen.ts` and the React input types.

### Fixed

- Rows nested by `?include=` under a member policy no longer bypass its scope.
- A member policy with `via: []` on `store` is refused at definition time instead of answering 403 forever.
- A multipart field named after an `Object.prototype` member (`constructor`, `toString`) is no longer reported as a duplicate.
- `blendx review` builds one TypeScript program instead of two.
- The error for a wrong key column in `replaceRelation`'s map names the column.
- Node: no constructor parameter property in the sources, and `erasableSyntaxOnly` guards the rest, so the packages run under Node's type stripping.

### Release process

Published through npm's staged publishing: the workflow stages the six tarballs with provenance and the maintainer approves each with 2FA (D35 note of 2026-09-25). The release gate in `releasing.md` is the rule from here: CI green on the tagged commit, the public API diff read, the upgrade check run, this entry written, before any tag.

## 0.1.0 (2026-09-14)

First release: the API (P0 to P15), `@blendx/react` (phase N) and the deferred features of P16 (the after stage, later hooks with their outbox, belongs-to, has-many and nested includes, purge, composite primary keys, PUT). Published by hand from the maintainer's machine (D35).
