# The blendx guide

This guide is for people, and AI agents, who build an API with blendx. It assumes TypeScript and HTTP, and nothing about blendx.

You write two things: `schema.dbml`, which describes the tables, and one small blend per table you expose, which says only what differs from the defaults. blendx derives everything else from them: validation, loading, authorization, saving, replies, routes, a typed client, an OpenAPI document, and a review file that someone who does not read TypeScript can check.

## Start here

1. [Getting started](getting-started.md): set up a project, expose a table and serve it.
2. [Tutorial: an expenses API](tutorial.md): build [`examples/expenses`](../../examples/expenses) from an empty folder. People sign up for a bearer token and file expense claims, each claim is priced from its category, and approvers approve or reject them.
3. [The walkthrough](../media/walkthrough/index.html): both examples in 27 narrated steps, with their real code and the replies the running apps sent. It plays in a browser; on GitHub, which shows only its source, open the file locally.

## Reference

| Page | What it covers |
|---|---|
| [The schema](schema.md) | `schema.dbml`, the column conventions, what each type accepts, keys and indexes, migrations |
| [Blends](blends.md) | `blend()`, the actions and their routes, policies, hidden columns, custom actions, declared replies |
| [Hooks](hooks.md) | the pipeline, each stage's hook and what it receives, the cascade, transactions, where logic goes |
| [The app and identity](app.md) | `defineApp`, the `auth` function, app-wide hooks, paging, problem types |
| [The HTTP API](http.md) | what a client sees: routes, index queries, replies, errors, OpenAPI, the typed client |
| [The React client](react.md) | `@blendx/react`: TanStack Query options for every action, keys and invalidation, errors and form field errors |
| [Review](review.md) | `review/<table>.yaml`, the examples, and how a reviewer asks for a change |
| [Testing](testing.md) | testing an app on PGlite or PostgreSQL, the review examples, the typed client |
| [Configuration and deployment](deployment.md) | `blendx.config.ts`, database drivers, migrations in production, serving on Bun and on Node |
| [The CLI](cli.md) | `blendx generate`, `blendx review` and `blendx migrate` |
| [Known issues](known-issues.md) | what does not work yet, and what to do instead |

## Elsewhere

- [`docs/cookbook.md`](../cookbook.md): eleven blend patterns, each linked to the test that pins it.
- [`packages/spec`](../../packages/spec): the normative spec: [pipeline](../../packages/spec/pipeline.md), [cascade](../../packages/spec/cascade.md), [errors](../../packages/spec/errors.md), [derivation rules](../../packages/spec/derivation-rules.md), [DBML](../../packages/spec/dbml.md) and [review format](../../packages/spec/review-format.md). This guide explains; the spec decides.
- [`docs/decisions.md`](../decisions.md): why blendx works the way it does.
- The examples: [`examples/addition`](../../examples/addition), a one-table app, and [`examples/expenses`](../../examples/expenses), the tutorial's app.

## Working with an AI agent

blendx is designed so that an agent writes little and a person reviews behaviour instead of code. Give your app a `CLAUDE.md` (or `AGENTS.md`): [`examples/addition/CLAUDE.md`](../../examples/addition/CLAUDE.md) is the template, and [`examples/expenses/CLAUDE.md`](../../examples/expenses/CLAUDE.md) shows one with the app's own rules added. It tells the agent which files are its to write, which are generated, and what "done" means: `blendx generate --check`, `blendx review --check`, `tsc --noEmit` and `bun test` all pass. A person then reads `review/*.yaml` and, to ask for a change, edits it ([Review](review.md)).

## Status

blendx is at version 0 and not yet on npm, so the API may still change. [Getting started](getting-started.md) shows the two ways to use it today, and [Known issues](known-issues.md) lists what does not work yet.
