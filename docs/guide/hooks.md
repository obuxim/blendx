# Hooks

A blend changes behaviour through hooks. Each stage of the pipeline has one, and a hook replaces or extends only its stage; every other stage keeps its default. Write a hook only for the stage that differs.

## The pipeline

Every request to an action runs the same stages, in order:

| # | Stage | Hook | By default |
|---|---|---|---|
| 1 | authenticate | the app's `auth` ([The app](app.md)) | no identity |
| 2 | validate | `rules` | the rules derived from the schema, strict |
| 3 | load | `load` | the row by id; a page for index; nothing for store and collection actions |
| 4 | authorize | `authorize` | the action's policy |
| 5 | calculate | `calculate` | the input's writable columns |
| 6 | save | `save` | store inserts; update and member actions update; replace updates and resets what the body left out; destroy soft-deletes or deletes; restore clears `deleted_at`; purge deletes for good |
| 7 | later | `later` | nothing; only actions that write have it: the write leaves an outbox entry, and a worker runs the hook, at least once |
| 8 | after | `after` | nothing; only actions that write have it, and it runs once the write has committed |
| 9 | respond | `respond` | 201 for store, 204 for destroy and purge, 200 otherwise, with the record minus hidden columns |

The first stage that fails ends the request, so failures come in a fixed order: 401, 422, 404, 403, then 409 or 422 from the database ([The HTTP API](http.md#the-order-of-failures)).

## Two kinds of hook

**Value hooks**, `rules`, `authorize`, `calculate` and `respond`, receive `prev`, the value so far, and return the value to use. Use `prev` to extend it; ignore it to replace it. Never mutate it.

**Effect hooks**, `load` and `save`, receive `runDefault()`. Call it to run the default, doing more before or after it; don't call it to replace the default.

**later** and **after** are neither kind. They receive what the action wrote and return nothing, and every level's hook runs ([The cascade](#the-cascade)).

A hook goes in the action's spec. Put `rules` before `calculate` in the object: TypeScript types `calculate`'s input from `rules`, and it reads the object in order.

```ts
a.store({
  rules: ({ prev }) =>
    prev.pick({ description: true, category: true, spent_on: true }).extend({ amount }),
  calculate: ({ input }) => ({ ...input, ...price(input.amount, input.category) }),
  save: ({ runDefault, writes, auth }) => runDefault({ ...writes, user_id: auth?.id }),
}),
```

## rules

```ts
rules: ({ prev }) => schema
```

`prev` is the action's default rules: for store, a strict zod object of the insert columns; for update, the same with every field optional; for replace, the store rules without the key columns, hidden ones optional; for index, the query; for show, destroy, restore and custom actions, an empty object. Return the zod schema to validate with.

- Replace: `rules: () => z.object({ a: z.number(), b: z.number() })`.
- Narrow: `prev.pick({ email: true, name: true })` accepts only those columns, keeping their derived rules.
- Tighten: `.extend({ email: z.email().max(255) })` replaces a field's rule.
- Add a field that is not a column: `prev.extend({ coupon: z.string().optional() })`. calculate then turns it into columns, since only columns are written.

The object a hook returns is made strict, so unknown keys are still refused; `.loose()` opts out. A GET action's input comes from the query string, so its values are strings.

## load

```ts
load: async ({ runDefault, db, params, query, input, auth, lock }) => recordOrPage
```

Index and member actions load; store and collection actions don't. A member action whose load returns nothing answers 404.

- `runDefault()`: the row by primary key (never a soft-deleted one; restore loads only those, and purge loads both), or, for index, the filtered, sorted page.
- `db`: the database, or the action's transaction when it writes.
- `params`, `query`: the path parameters and the query string. `input`: the validated input.
- `lock`: true when the action will write. A load that replaces the default should then select the row `FOR UPDATE`, as the default does.

To limit a listing to the requester, give index a `scope` rather than filtering in a load hook: the default load adds the scope to its query, so pages and totals stay right ([Blends](blends.md#scope), [cookbook pattern 7](../cookbook.md#7-scope-a-listing-to-the-requester)). A load hook that calls `runDefault()` gets the scoped page.

## authorize

```ts
authorize: ({ prev, auth, record, input, action }) => boolean
```

`prev` is the policy's decision. `prev && ...` adds a condition to the policy; returning without `prev` replaces the policy for this action. False answers 403. It may be async.

authorize runs after validation and loading, so it can look at both: the input, and the record's current state. From [`examples/expenses`](../../examples/expenses/blends/expenses.ts):

```ts
// Only a draft is submitted.
a.member('submit', {
  authorize: ({ prev, record }) => prev && record.status === 'draft',
  calculate: () => ({ status: 'submitted' as const }),
}),

// Only a submitted claim is reviewed, and never by the person who filed it.
a.member('approve', {
  authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
  calculate: () => ({ status: 'approved' as const }),
}),
```

## calculate

```ts
calculate: ({ prev, input, record }) => writes
```

calculate turns the validated input, and the loaded record, into the columns to write. `prev` is the default: the input's writable columns. For a collection action, what it returns is the reply body instead.

calculate is pure and synchronous: no database, no request, no identity, and nothing that differs from call to call, such as the clock or random numbers. That is what lets the review examples replay it without a database ([Review](review.md#examples)). Anything that needs those goes in `save`.

It returns only writable columns of its table; anything else is a type error, and a generated column that slips through fails the request rather than being dropped. Logic worth naming goes in a plain function in the blend file, as `price()` does in the expenses blend, and every calculate that needs it calls it.

The review lists the columns a calculate writes, from its return type. `prev` is typed as the writable columns the rules accept, so `({ prev }) => ({ ...prev, total })` writes, and the review lists, exactly those columns and `total`. Spreading `input` instead also passes on fields that are not columns, which calculate may not return.

## Drizzle helpers

Import database builders and query helpers from `blendx/drizzle`. It keeps every app on the same pinned Drizzle copy as blendx, so an app does not need its own `drizzle-orm` dependency.

`blendx/drizzle` exports `outbox`, `sql`, and the full `drizzle-orm/pg-core` schema-builder surface. Its supported query helper surface is:

- Boolean and comparison: `and`, `or`, `not`, `eq`, `ne`, `gt`, `gte`, `lt`, `lte`.
- Membership and null: `inArray`, `notInArray`, `isNull`, `isNotNull`.
- Pattern and range: `like`, `ilike`, `notLike`, `notIlike`, `between`, `notBetween`.
- Subqueries and arrays: `exists`, `notExists`, `arrayContains`, `arrayContained`, `arrayOverlaps`.
- Ordering: `asc`, `desc`.

## save

```ts
save: async ({ runDefault, tx, writes, record, auth }) => row
```

- `runDefault(writes?)`: the default save, with calculate's writes or with the ones you pass.
- `tx`: the transaction the action runs in.
- `writes`: what calculate returned. `record`: the loaded row, for member actions. `auth`: the identity.

The identity, the clock and other queries belong here. The expenses blend makes the signed-in user the claimant:

```ts
save: ({ runDefault, writes, auth }) => runDefault({ ...writes, user_id: auth?.id }),
```

The writes a save hook passes to `runDefault` are not checked the way calculate's are, so pass only columns you mean to set.

A save hook can query a related table through its transaction. This store action refuses an order for an inactive user:

```ts
import { eq } from 'blendx/drizzle';

a.store({
  save: async ({ runDefault, tx, writes }) => {
    const users = models.users.table;
    const [user] = await tx
      .select({ is_active: users.is_active })
      .from(users)
      .where(eq(users.id, writes.user_id ?? -1))
      .limit(1);
    if (!user?.is_active) throw new Error('Orders need an active user.');
    return runDefault();
  },
}),
```

When persistence also changes another table, declare it on the action with that table's schema model. The action's own table is always implicit. The declaration makes review list the related write and makes `@blendx/react` refetch that table's queries after a successful mutation:

```ts
a.member('refund', {
  writes: [models.users],
  save: async ({ runDefault, tx }) => {
    const saved = await runDefault();
    // write models.users.table through tx
    return saved;
  },
});
```

`writes` takes one or more other models. It is available on non-GET actions, including one without a local `save` hook; it rejects the action's own model, duplicates, and GET actions.

## after

```ts
after: async ({ saved, record, input, auth, db }) => { ... }
```

after runs once the action's write has committed, before the reply is sent: send an email, call a webhook, tell another system. Only actions that write have one (store, update, replace, destroy, restore, purge and member actions); on index, show and collection actions it is a type error.

- `saved`: the row as saved, hidden columns included, since none of it goes back to the client.
- `record`: the row as loaded before the write, so `record` and `saved` show what changed. Store has none.
- `input`, `auth`: the validated input and the identity.
- `db`: the database, outside the committed transaction. Writes that must succeed or fail with the action go in `save`.

The reply waits for after, so a test sees its effect when the reply arrives; an effect that must not delay the reply can start its work without awaiting it. What after throws does not change the reply, because the write has already committed: it goes to `createServer`'s `onError` ([Configuration and deployment](deployment.md)), and the other levels' after hooks still run. If the process stops between the commit and the hook, the effect is lost ([cookbook pattern 11](../cookbook.md#11-do-something-once-a-write-has-committed)); an effect that must not be lost is a `later` hook.

## later

```ts
later: async ({ saved, record, input, auth, db, id, attempt }) => { ... }
```

later is for an effect that must not be lost, such as telling a payment provider to refund. The request does not run it: the write leaves one outbox entry per level with a later hook, in the action's transaction, so the entry exists exactly when the write commits, and a worker runs it ([Configuration and deployment](deployment.md#running-the-outbox-worker)). Only actions that write have one.

- `saved`, `record`, `input`, `auth`: after's context, stored with the entry as JSON. `auth` is the JSON of what the app's `auth` function returned.
- `db`: the worker's database.
- `id`: the entry's id, the same on every attempt. `attempt`: 1 on the first run, 2 on the first retry, and so on.

A later hook runs at least once, and may run twice: a worker that stops after the hook but before deleting the entry leaves it to run again. So make it safe to repeat, for example by passing `id` to the other system as an idempotency key. A failure is reported to `onError`, and the entry runs again after a delay that doubles; after the tenth attempt it stays in the `blendx_outbox` table, marked failed, with its last error.

The first later hook of an app brings the outbox table with it: run `blendx generate`, then `blendx migrate generate` ([The CLI](cli.md#blendx-generate), [cookbook pattern 12](../cookbook.md#12-an-effect-that-must-not-be-lost)).

## respond

```ts
respond: ({ prev, record, result }) => reply
```

`prev` is the default reply, `{ status, body }` (and `headers` when a hook set any). `record` is the saved or loaded record, hidden columns already removed; `result` is what calculate returned. Return the reply to send: change its status, its body or its headers. A body or status blendx cannot derive needs a declared `reply` ([Blends](blends.md#declaring-a-reply), [cookbook pattern 8](../cookbook.md#8-reshape-the-reply)).

respond runs after the transaction has committed: an error there leaves the saved row.

## The cascade

Four levels can set a stage, and each receives what the level above produced: the schema's default, then the app (`defineApp({ hooks })`), then the resource (`blend(model, { hooks })`), then the action. The most specific level has the last word, except for later and after: every level's hook runs, the app's, then the resource's, then the action's, and none replaces another, so an app-wide audit log keeps running when an action adds its own. Each level's later hook is an outbox entry of its own.

| Stage | App | Resource | Action |
|---|---|---|---|
| rules | yes | yes | yes |
| load | | | yes |
| authorize | yes | yes | yes |
| calculate | | | yes |
| save | | | yes |
| later | yes | yes | yes |
| after | yes | yes | yes |
| respond | yes | yes | yes |

App and resource hooks run for many actions, so each must return the type it receives, and they receive the action's name (`action`) and, at the app level, the `model`. load, calculate and save depend on one table's columns, so only an action sets them.

A resource hook runs for every action of its table. With an identity that carries a `suspended` flag:

```ts
export default blend(models.notes, {
  policy: { default: allow.public, store: allow.authenticated },
  hooks: {
    // A suspended account can read notes, and write none.
    authorize: ({ prev, auth, action }) =>
      prev && (action === 'index' || action === 'show' || auth?.suspended !== true),
  },
  actions: (a) => [a.index(), a.store(), a.show()],
});
```

App hooks are in [The app](app.md#app-hooks). The review marks every stage that a level beyond the schema changed. A custom `authorize` stage is a block that gives each hook's source file and readable inline source, and says that the policy is only its starting decision. Referenced, imported and spread hooks keep their file and explain that the hook must be inline before review can show it.

## Transactions

An action that writes (store, update, replace, destroy, restore, purge and member actions) runs load, authorize, calculate and save in one transaction, with its row locked `FOR UPDATE`: a calculate that reads the record and writes it back cannot race another request. An error anywhere rolls back everything the action wrote. The later hooks' outbox entries are written in that transaction, and after and respond run after the commit: a write that fails leaves no entry and runs no after. Reads (index, show and collection actions) take no lock and no transaction.

## Stopping with a problem

Any hook can end the request with a specific problem by throwing `HttpProblem`:

```ts
import { allow, blend, HttpProblem, problem } from 'blendx';
import { sql } from 'blendx/drizzle';

a.store({
  save: async ({ runDefault, tx, writes }) => {
    const notes = models.notes.table;
    const [same] = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(sql`${notes.body} = ${writes.body}`)
      .limit(1);
    if (same) throw new HttpProblem(problem(409, { detail: 'That note already exists.' }));
    return runDefault();
  },
}),
```

`problem(status, { detail })` builds the Problem Details for 400, 401, 403, 404, 409, 422 or 500. It does not know the app's `problems.typeBase`, so its `type` is `about:blank` unless you pass `typeBase` too. In an action that writes, the throw rolls the transaction back.

## Where logic goes

| To | Use |
|---|---|
| accept, refuse or reshape input | `rules` |
| decide who may run an action | a policy ([Blends](blends.md#policies)) |
| add a condition on the input or the record's state | `authorize` |
| compute columns from the input and the record | `calculate` |
| use the identity, the clock or another query while writing | `save` |
| limit a listing to the requester | `scope` on index |
| change what is loaded | `load` |
| change the status, the headers or the body | `respond`, with `reply` |
| send an email, call a webhook or tell another system once a write has committed | `after` |
| do something that must not be lost, such as a payment provider's refund | `later` |
| apply a rule to every action of a table | resource `hooks` |
| apply a rule to every table | app `hooks` |
