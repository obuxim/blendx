# Blends

A blend exposes one table. It lives in `blends/<table>.ts` and default-exports `blend(model, spec)`. From [`examples/expenses`](../../examples/expenses/blends/users.ts):

```ts
import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  // Anyone may sign up. After that, a user sees only their own record.
  policy: { store: allow.public, show: allow.owner('id') },
  actions: (a) => [
    a.store({
      rules: ({ prev }) =>
        prev.pick({ email: true, name: true }).extend({ email: z.email().max(255) }),
    }),
    a.show(),
  ],
});
```

`models` comes from `src/generated/schema.gen.ts`, which `blendx generate` writes from `schema.dbml`: one model per table, carrying its columns and what blendx read from the schema (the primary key, the timestamps, soft delete, the constraints). The file's name must be the table's: `blendx generate` refuses `blends/people.ts` when it blends `users`. A table without a blend has no routes.

The spec has four keys:

| Key | |
|---|---|
| `policy` | Required. Who may run each action ([Policies](#policies)). |
| `actions` | Required. The actions to expose ([Actions](#actions)). |
| `hidden` | Columns never sent in a reply ([Hidden columns](#hidden-columns)). |
| `hooks` | Hooks that run for every action of this table ([Hooks](hooks.md#the-cascade)). |

## Actions

The `actions` callback receives a builder, `a`, and returns the list of actions to expose. Nothing else gets a route: an action you do not list does not exist, and a request for it is a 404.

| Call | Route | By default | Reply |
|---|---|---|---|
| `a.index()` | `GET /<table>` | a filtered, sorted page of rows | 200, `{ data, meta }` |
| `a.store()` | `POST /<table>` | validates the body and inserts a row | 201, the record |
| `a.show()` | `GET /<table>/:id` | loads the row | 200, the record |
| `a.update()` | `PATCH /<table>/:id` | validates a partial body and updates the row | 200, the record |
| `a.destroy()` | `DELETE /<table>/:id` | soft-deletes the row, or deletes it when the table has no `deleted_at` | 204, no body |
| `a.restore()` | `POST /<table>/:id/restore` | clears `deleted_at` on a soft-deleted row | 200, the record |
| `a.member(name, spec)` | `POST /<table>/:id/<name>` | loads the row and updates it with what `calculate` returns | 200, the record |
| `a.collection(name, spec)` | `POST /<table>/<name>` | loads and saves nothing | 200, what `calculate` returns |

- `a.restore()` exists only on a table with a nullable `deleted_at` timestamp. On any other table it is a type error.
- Each action is listed once. Every call takes an optional spec: the hooks where the action differs from the defaults ([Hooks](hooks.md)), and the options below.
- A collection action's route, such as `GET /expenses/quote`, is matched before `GET /expenses/:id`.

What each default does in detail (which columns store accepts, how index filters) is derived from the schema: see [The schema](schema.md) and [The HTTP API](http.md).

### Index options

`a.index({ trashed: true })` also accepts `?trashed=with` (live and soft-deleted rows) and `?trashed=only` (soft-deleted rows). It needs a soft-delete table.

### Custom actions

`a.member(name, spec)` acts on one record, and `a.collection(name, spec)` on the table. A name is lowercase letters, digits and `_`, and not a built-in action's name. Two options shape the route:

- `method`: `'get'`, `'post'`, `'patch'` or `'delete'`; `'post'` by default. A `get` action reads its input from the query string, the others from the JSON body.
- `path`: the path segment, the name by default.

A custom action starts from empty rules: it accepts `{}` and nothing else until its `rules` hook adds fields.

A member action runs like an update: it loads its row (locked for the update), checks the policy, saves what `calculate` returns and replies with the record.

```ts
a.member('reject', {
  rules: () => z.object({ note: z.string().min(3).max(500) }),
  authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
  calculate: ({ input }) => ({ status: 'rejected' as const, review_note: input.note }),
}),
```

A collection action loads and saves nothing. What `calculate` returns is the reply body, so it is not limited to columns, and `reply` describes it for OpenAPI and the review ([Declaring a reply](#declaring-a-reply)):

```ts
a.collection('quote', {
  method: 'get',
  rules: () => z.object({ amount, category: z.enum(expense_category.enumValues) }),
  calculate: ({ input }) => price(input.amount, input.category),
  reply: z.object({ tax: z.string(), total: z.string() }),
}),
```

## Policies

blendx is default-deny: every exposed action needs a policy, and `blend()` refuses one that has none.

| Policy | Allows | Needs an identity |
|---|---|---|
| `allow.public` | anyone | no |
| `allow.authenticated` | any request with an identity | yes |
| `allow.owner(column, authKey = 'id')` | the identity whose `authKey` equals the record's `column` | yes |
| `allow.when(check, { description, requiresAuth })` | whenever `check` returns true | when `requiresAuth` is true |
| `deny` | nobody | no |

Give one policy for every action, or one per action with `default` for the rest:

```ts
policy: {
  default: allow.owner('user_id'),
  index: allow.authenticated,
  store: allow.authenticated,
  approve: approvers,
  reject: approvers,
},
```

`blend()` refuses an action that gets no policy (no entry and no `default`), and an entry for an action the blend does not list.

- A policy that needs an identity answers 401 to a request without one, before the input is read. Every other refusal is a 403, and comes after validation and loading ([the order of failures](http.md#the-order-of-failures)).
- `allow.owner` needs a record, so it refuses index, store and collection actions: give those a policy of their own.
- `allow.when` receives `{ auth, record, input, action }`, where `record` is undefined for actions that load none. Give it a `description`: the review file shows it as the action's authorize line. Set `requiresAuth: true` when the rule cannot pass without an identity, so such requests get 401 rather than 403.

```ts
const approvers = allow.when(({ auth }) => auth?.is_approver === true, {
  requiresAuth: true,
  description: 'an approver',
});
```

`auth` is what your app's `auth` function returns, typed from it ([The app and identity](app.md)). A rule that also depends on the input or on the record's state, such as "only a draft can be submitted", is clearer as an [authorize hook](hooks.md#authorize), which receives the policy's decision as `prev`.

## Hidden columns

`hidden: ['password']` keeps a column out of every reply, index pages included, and out of the index filters and sorting. It is still a column: store and update accept it as input unless their rules drop it, and hooks see it on the record. `blend()` refuses a name that is not a column.

`hidden` applies to the whole resource. A column that one reply must carry and all others must hide, such as a token returned once at sign-up, cannot be expressed yet; the tutorial explains how [`examples/expenses`](tutorial.md#4-sign-up) deals with that.

## Declaring a reply

blendx describes every default reply in OpenAPI and in the review file. There are two replies it cannot derive: a collection action's result, and a body that a respond hook builds. Declare them with `reply`:

- `reply: z.object({ ... })`: the body, sent with the action's default status.
- `reply: { status: 202, body: z.object({ ... }) }`: when respond returns another status.

The declaration is type-checked against what the action sends: the keys must match, and every body must fit the schema. A mismatch is a type error on the action that names the reason. An undeclared reply is not an error: `blendx generate` prints a warning, and OpenAPI and the review describe the reply as unknown. ([Cookbook, pattern 8](../cookbook.md#8-reshape-the-reply).)

## Mistakes blend() refuses

`blend()` checks a definition when its file is imported, so `blendx generate`, the tests and the server all stop at once with `blend(<table>): ...`:

- an action listed twice;
- an action without a policy, or a policy for an action that is not listed;
- a hidden column that is not a column;
- a custom action that reuses a built-in name, has a name that is not lowercase letters, digits and `_`, or has an invalid path;
- `restore`, or `trashed` on index, on a table without soft delete;
- a `reply` that is neither a zod schema nor `{ status, body }`.

Mistakes in types, such as a `calculate` that returns a column the table does not have, are caught earlier, by `tsc`.
