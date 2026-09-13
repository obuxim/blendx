# expenses (a blendx app)

People sign up for a bearer token and file expense claims. A claim is priced from its category, stays editable while it is a draft, and once submitted an approver approves or rejects it. Approvers are made with `bun scripts/make-approver.ts <email>`, never through the API.

This app is built with blendx. **The only code anyone writes is business logic: the schema, the blends and a few hooks. Everything else is derived and generated.** Keep it that way: when something can be derived, do not write it.

## Who writes what

| Path | Owner |
|---|---|
| `schema.dbml` | you: the tables, columns, keys and indexes |
| `blends/<table>.ts` | you: one per exposed table, what differs from the defaults |
| `src/app.ts` | you: `defineApp`, the identity (`auth`) and app-wide hooks |
| `scripts/**`, `test/**` | you |
| `src/generated/**`, `drizzle/**` | generated. **Never read or edit.** Run `bunx blendx generate` or `bunx blendx migrate generate`. |
| `review/<table>.yaml` | generated for human review. Never edit it; a human edit is a fix request (below). |
| `review/<table>.examples.yaml` | the humans'. Do not edit unless asked. |

## Commands

- `bunx blendx generate`: after changing `schema.dbml`, a blend or `src/app.ts`. `--check` fails if anything is out of date.
- `bunx blendx migrate generate --name <what_changed>`: after changing `schema.dbml`, writes the next migration. `bunx blendx migrate up` applies it.
- `bunx blendx review`: rewrites `review/*.yaml`. `--check` fails on drift and runs the examples.
- `bunx tsc --noEmit`: typecheck.
- `bun test`: the app's tests, including `test/examples.test.ts`.
- `bun server.ts`: serves the API on port 3000, applying pending migrations first. PostgreSQL when `DATABASE_URL` is set, PGlite in `./.data` otherwise.

Done means `bunx blendx generate --check`, `bunx blendx review --check`, `bunx tsc --noEmit` and `bun test` all pass.

## The rules of this app

- The identity is the user whose `api_token` is the request's `Authorization: Bearer` token (`src/app.ts`). It carries `id` and `is_approver`.
- `blends/users.ts`: signing up takes only `email` and `name`, and the 201 reply is how a user gets their token. A user sees only their own record. There is no listing of users, because a record carries its token.
- `blends/expenses.ts`: the claimant is the signed-in user (the store `save` hook), never the input. Tax and total are calculated from the category's rate and never sent. Only a draft is updated, deleted or submitted; only a submitted claim is approved or rejected, by an approver who did not file it. Non-approvers list their own claims with `?user_id=<their id>`.
- Money columns are `numeric(10,2)`, so they are strings in JSON; `price()` works in cents.

## Hook rules

- One hook per stage: `rules`, `load`, `authorize`, `calculate`, `save`, `respond`.
- `rules`, `authorize`, `calculate` and `respond` receive `prev` and return the replacement. Ignore `prev` to replace it, use it to extend it. Never mutate it.
- `load` and `save` receive `runDefault()`. Call it to extend the default, skip it to replace it.
- `calculate({ prev, input, record })` is pure and synchronous: no database, no request, no identity, no I/O. It returns only columns of its table. Anything that needs the identity or the clock goes in `save`.
- Put `rules` before `calculate` in the object: `calculate`'s input type comes from `rules`. Likewise, in `defineApp`, put `auth` before `hooks`: the app hooks' identity type comes from `auth`.
- A reply blendx cannot derive (a collection action's result, or what `respond` builds) declares `reply: z.object(...)`, or `reply: { status, body }` when `respond` returns another status.
- Import only from `blendx` and `blendx/drizzle` (and `@blendx/cli/examples` in tests), and use its `z`.

## Review fix requests

When `bunx blendx review --check` fails, a human has asked for a change:

- A diff in `review/<table>.yaml`: the `-` lines are what the reviewer wants, the `+` lines what the code does. Change the blend (policy, rules, hook, calculate) until the check passes. Never edit the YAML back.
- A failing example in `review/<table>.examples.yaml`: the rules or calculate must change to produce it.
- Then run `bunx blendx generate`, and `bunx blendx review` if your change moved lines the reviewer did not edit.

The guide for blendx apps is `docs/guide/` in the blendx repository; the blend patterns are in `docs/cookbook.md`.
