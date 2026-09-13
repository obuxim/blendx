# addition (a blendx app)

This app is built with blendx. **The only code anyone writes is business logic: the schema, the blends and a few hooks. Everything else is derived and generated.** Keep it that way: when something can be derived, do not write it.

## Who writes what

| Path | Owner |
|---|---|
| `schema.dbml` | you: the tables, columns, keys and indexes |
| `blends/<table>.ts` | you: one per exposed table, what differs from the defaults |
| `src/app.ts` | you: `defineApp`, the identity (`auth`) and app-wide hooks |
| `test/**` | you |
| `src/generated/**`, `drizzle/**` | generated. **Never read or edit.** Run `bunx blendx generate` or `bunx blendx migrate generate`. |
| `review/<table>.yaml` | generated for human review. Never edit it; a human edit is a fix request (below). |
| `review/<table>.examples.yaml` | the humans'. Do not edit unless asked. |

## Commands

- `bunx blendx generate`: after changing `schema.dbml`, a blend or `src/app.ts`. `--check` fails if anything is out of date.
- `bunx blendx migrate generate --name <what_changed>`: after changing `schema.dbml`, writes the next migration. `bunx blendx migrate up` applies it.
- `bunx blendx review`: rewrites `review/*.yaml`. `--check` fails on drift and runs the examples.
- `bunx tsc --noEmit`: typecheck. The hook types catch most mistakes before anything runs: calculate's input comes from `rules`, calculate may return only the table's columns, and a declared `reply` must match what the action sends.
- `bun test`: the app's tests, including `test/examples.test.ts`.
- `bun server.ts`: serves the API. It applies pending migrations on start.

Done means `bunx blendx generate --check`, `bunx blendx review --check`, `bunx tsc --noEmit` and `bun test` all pass.

## Add a table

1. Add the table to `schema.dbml`. Name it in snake_case. `id int [pk, increment]`, `created_at`, `updated_at` and a nullable `deleted_at timestamp` (soft delete) are recognised by name.
2. `bunx blendx generate`, then `bunx blendx migrate generate --name add_<table>`.
3. Write `blends/<table>.ts`. The file name is the table name:

   ```ts
   import { allow, blend, z } from 'blendx';
   import { models } from '../src/generated/schema.gen.ts';

   export default blend(models.notes, {
     policy: allow.authenticated,
     hidden: [],
     actions: (a) => [a.index(), a.store(), a.show(), a.update(), a.destroy()],
   });
   ```

   Only listed actions are exposed, and every action needs a policy: one for all, or `{ default, store: allow.public, ... }` per action. `allow.public`, `allow.authenticated`, `allow.owner('user_id')`, `allow.when(fn)` and `deny` are the choices.
4. `bunx blendx generate` again, for the routes and OpenAPI.
5. `bunx blendx review`, and ask a human to read `review/<table>.yaml`.
6. `bunx blendx migrate up`.

The defaults already validate input from the schema (unknown keys are refused), load rows, check the policy, save, and reply with the record minus hidden columns. Write a hook only where the action must behave differently.

## Add a custom action

On one record, `POST /<table>/:id/<name>`:

```ts
a.member('refund', {
  rules: () => z.object({ reason: z.string().min(3) }),
  calculate: () => ({ status: 'refunded' as const }),
}),
```

On the collection, here `GET /<table>/quote`:

```ts
a.collection('quote', {
  method: 'get',
  rules: () => z.object({ quantity: z.string() }),
  calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
  reply: z.object({ total: z.number() }),
}),
```

A collection action loads and saves nothing: calculate's result is the reply, so declare its `reply` schema for OpenAPI. A member action saves what calculate returns and replies with the record.

## Hook rules

- One hook per stage: `rules`, `load`, `authorize`, `calculate`, `save`, `respond`.
- `rules`, `authorize`, `calculate` and `respond` receive `prev` and return the replacement. Ignore `prev` to replace it, use it to extend it. Never mutate it.
- `load` and `save` receive `runDefault()`. Call it to extend the default, skip it to replace it.
- `calculate({ prev, input, record })` is pure and synchronous: no database, no request, no I/O. It returns only columns of its table.
- Put `rules` before `calculate` in the object: `calculate`'s input type comes from `rules`.
- A reply blendx cannot derive (a collection action's result, or what `respond` builds) declares `reply: z.object(...)`, or `reply: { status, body }` when `respond` returns another status.
- Import only from `blendx` (and `blendx/examples` in tests), and use its `z`.

## Review fix requests

When `bunx blendx review --check` fails, a human has asked for a change:

- A diff in `review/<table>.yaml`: the `-` lines are what the reviewer wants, the `+` lines what the code does. Change the blend (policy, rules, hook, calculate) until the check passes. Never edit the YAML back.
- A failing example in `review/<table>.examples.yaml`: the rules or calculate must change to produce it.
- Then run `bunx blendx generate`, and `bunx blendx review` if your change moved lines the reviewer did not edit.
