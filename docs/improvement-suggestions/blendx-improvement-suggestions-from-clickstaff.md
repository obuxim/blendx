# Blendx improvement suggestions

## Windows outbox test schema discovery

- At pinned revision b863a847a06d76f3a866955f00886355ba762887, running `bun test packages/core/test/later.test.ts packages/core/test/outbox-worker.test.ts` on Windows fails before tests: drizzle-kit reports no schema file for the absolute backslash path constructed by `join` in `test/support/database.ts`.
- Teardown then throws because `database` was never initialized. Normalize schema/output paths to forward slashes for the CLI and guard failed setup in teardown.
- Application workaround: a separately generated outbox-only test fixture, generated using forward-slash paths, applied only to a random temporary PGlite database. Actual generated application selection route is exercised with a test-only later hook. No upstream edits.

Baseline: `b863a847a06d76f3a866955f00886355ba762887`. Local notes only; excluded via `.git/info/exclude`.

## Make index sort constraints visible in the typed React client

- Reproduction: create a `plan_entries` table with a non-indexed integer `position` column; call `api.plan_entries.index.queryOptions({ query: { sort: 'position' } })` through `@blendx/react`.
- Observed: application `tsc --noEmit` passed, but the live endpoint returned 422 with the allowed indexed-column sort values. This turned a populated plan into a failed UI query.
- Expected improvement: generated query types constrain `sort` to the exact runtime allowlist, or document this limitation prominently beside the React sorting examples.
- Application workaround: fetch the small, bounded S0 plan and sort its entries by position in the client. Treat an initial entries error as an error, not an empty plan.
- Suggested framework change: carry runtime filter/sort literal unions into the generated client metadata/type surface, with a compile-time test rejecting a non-sortable column.
- No upstream source changes made.

## Normalize embedded hook indentation in review YAML

- Reproduction: format a multiline scope/calculate hook with tabs, then run `blendx review` and `git diff --check`.
- Observed: generated YAML block scalars indent the source with spaces followed by original tabs. Git flags each line as `space before tab in indent`.
- Expected improvement: normalize embedded source indentation to spaces while preserving code meaning, so generated review artifacts are platform/editor-independent and whitespace-clean.
- Application workaround: format authored blends with spaces, then regenerate review YAML. Generated files were not edited by hand.
