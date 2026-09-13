# The CLI

The `blendx` command comes from `@blendx/cli`, which an app adds as a dev dependency; it runs on Bun. Run it from the app's folder (`bunx blendx ...`), or from anywhere with `--cwd <app folder>`.

```
blendx <command> [options]

Commands:
  generate  Write the generated files from schema.dbml and the blends
  review    Write review/<resource>.yaml: what each action does, for a human to check
  migrate   generate: write the next migration; up: apply the pending ones
```

Every command accepts `--cwd <dir>` (run in that app folder) and `-h`, `--help`. Without a command, `-v`, `--version` prints the version.

Exit codes: 0 when the command succeeded, 1 when it failed (a `--check` that found drift included), and 2 for a usage error.

Every command starts from `blendx.config.ts` (or `.js`, `.mjs`) in the app folder, and resolves the paths it names against that folder ([Configuration](deployment.md#blendxconfigts)).

## blendx generate

Run it after every change to `schema.dbml`, a blend or `src/app.ts`. It works in two phases:

1. `schema.dbml` becomes `src/generated/schema.gen.ts`: the Drizzle tables and enums, and `models`. A schema error stops here, with its line and column (`schema.dbml:3:1 expected "," or "]" but found "}"`).
2. It imports every `blends/*.ts` (which import that schema) and the app module, and writes the rest:

| File | What it is |
|---|---|
| `routes.gen.ts` | the routes of every listed action, and `AppType` for the typed client |
| `client.gen.ts` | every action's method and path, by table and action name, for clients that call actions by name; it imports nothing, so a web app can load it |
| `register.gen.ts` | registers the app's type, so hooks and policies see the identity's type |
| `outbox.gen.ts` | the outbox table, once any hook is a `later` hook, so the next migration creates it; otherwise nothing |
| `drizzle.config.gen.ts` | the drizzle-kit config that `blendx migrate generate` uses: `schema.gen.ts` and `outbox.gen.ts` |
| `openapi.json` | the OpenAPI 3.1 document |

A file is written only when its content changes. A reply that OpenAPI cannot describe prints a `warning:` line on stderr; warnings never fail the command ([Declaring a reply](blends.md#declaring-a-reply)).

`--check` writes nothing. It prints a unified diff for each file that is out of date (or says it is missing) and exits 1. Run it in CI.

## blendx review

Writes `review/<table>.yaml` for every blend ([Review](review.md)).

`--check` writes nothing. It prints a diff for each review file that differs from what the blends say, fails on a review file whose blend is gone, runs every example in `review/*.examples.yaml`, and exits 1 if anything failed.

## blendx migrate

`blendx migrate generate [--name <name>]` writes the next migration into `drizzle/`, by comparing `schema.gen.ts` with the migrations already there. It runs the drizzle-kit version `@blendx/cli` pins, and refuses to run while `schema.gen.ts` is out of date, so a migration never comes from a stale schema: run `blendx generate` first. On a terminal, drizzle-kit may ask whether a column was renamed or replaced.

`blendx migrate up` applies the pending migrations, through the driver in `blendx.config.ts` and its own migrator. It prints `applied 1 migration from drizzle`, or `drizzle: no pending migrations`.

Migrations use drizzle-kit 1.0's layout: one `<timestamp>_<name>/` folder per migration, holding `migration.sql` and `snapshot.json`. `migrate up` refuses the older 0.x layout (`meta/_journal.json`) and says how to convert it.

A server can also apply migrations itself when it starts, with `database.migrate(folder)` ([Deployment](deployment.md#migrations-in-production)), so production needs no CLI.
