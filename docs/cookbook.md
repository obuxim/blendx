# Blend cookbook

Fifteen patterns that cover most of what a blend ever says. Each shows only what differs from the defaults; everything left out is derived from the schema. Every pattern links to the test that pins its behaviour.

The examples use the `shop` tables: `users` (with a `password`), and `orders` (with a `user_id` and soft delete). Every snippet also compiles, with a typed identity, in [the cookbook, compiled](../packages/core/test/register/cookbook.types.test.ts).

## 1. Expose a table read-only, hiding a column

```ts
export default blend(models.users, {
  policy: allow.public,
  hidden: ['password'],
  actions: (a) => [a.index(), a.show()],
});
```

Only listed actions get routes. A hidden column leaves the server only in the reply of an action that reveals it (`a.store({ reveal: ['password'] })`, never on index), and it cannot be filtered or sorted on.

- [hidden columns never leave, row by row](../packages/core/test/engine-load.test.ts)
- [store answers 201 with the saved row and no hidden columns](../packages/core/test/engine-respond.test.ts)

## 2. A policy per action, and the owner rule

```ts
export default blend(models.orders, {
  policy: {
    default: allow.owner('user_id'),
    index: allow.public,
    store: allow.authenticated,
  },
  actions: (a) => [a.index(), a.store(), a.show(), a.update(), a.destroy()],
});
```

`allow.owner('user_id')` passes when the record's `user_id` equals the identity's `id`. A policy that needs an identity answers 401 before the input is read.

- [an owner policy allows the owner and refuses everyone else](../packages/core/test/authorize.test.ts)
- [requiresAuth comes from each action policy](../packages/core/test/authorize.test.ts)

## 3. A column computed from the input

```ts
a.store({
  rules: () => z.object({ a: z.number(), b: z.number() }),
  calculate: ({ input }) => ({ result: input.a + input.b }),
}),
```

`rules` replaces the default input; `calculate` turns the input into the columns to write. Write `rules` first: `calculate`'s input type comes from it.

- [POST { a: 4, b: 3 } answers 201 with the saved record](../packages/core/test/engine.test.ts)

## 4. Add a field to the default rules

```ts
a.store({
  rules: ({ prev }) => prev.extend({ coupon: z.string().optional() }),
  calculate: ({ input }) => ({
    total: input.coupon === 'HALF' ? (Number(input.total) / 2).toFixed(2) : input.total,
  }),
}),
```

Using `prev` keeps every derived rule and adds to it; returning a new object replaces them. Either way, unknown keys are still refused unless the object says `.loose()`.

- [calculate is typed from rules, the loaded record and the model](../packages/core/test/blend.test.ts)
- [an action can replace the defaults; a plain object is made strict](../packages/core/test/cascade.test.ts)

## 5. A member action that writes

```ts
a.member('refund', {
  rules: () => z.object({ reason: z.string().min(3) }),
  calculate: () => ({ status: 'refunded' as const }),
}),
```

`POST /orders/:id/refund` loads the order (locked for the update), checks the policy, saves what calculate returns and replies with the record.

- [a custom member action saves what calculate returns](../packages/core/test/engine-save.test.ts)

## 6. A collection action with a declared reply

```ts
a.collection('quote', {
  method: 'get',
  rules: () => z.object({ quantity: z.string() }),
  calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
  reply: z.object({ total: z.number() }),
}),
```

A collection action loads and saves nothing: calculate's result is the reply. `reply` describes it for OpenAPI and the review, and it is type-checked against what calculate returns.

- [a collection action answers 200 with what calculate returned](../packages/core/test/engine-respond.test.ts)
- [OpenAPI describes declared replies, at their status, and warns about the rest](../packages/core/test/reply.test.ts)

## 7. Scope a listing to the requester

```ts
a.index({ scope: ({ auth }) => ({ user_id: auth?.id }) }),
```

`scope` returns column values, and the default load adds each as an equality, so pages and `meta.total` count only the requester's rows; filters from the query still apply within them. A value that is `undefined` or `null` matches no row, so a scope that cannot be worked out lists nothing, and `{}` scopes nothing: `auth?.is_admin ? {} : { user_id: auth?.id }`.

- [scope (D22): only the rows in scope, and pages and totals count only those](../packages/core/test/engine-load.test.ts)
- [scope: a missing value matches no row; an empty scope scopes nothing](../packages/core/test/engine-load.test.ts)

## 8. Reshape the reply

```ts
a.member('rename', {
  rules: () => z.object({ display_name: z.string() }),
  calculate: ({ input }) => ({ display_name: input.display_name }),
  respond: ({ prev, record }) => ({ ...prev, status: 202, body: { renamed: record.display_name } }),
  reply: { status: 202, body: z.object({ renamed: z.string().nullable() }) },
}),
```

`respond` receives the default reply and the public record (hidden columns already removed). When it builds a new body, `reply` declares it; a status other than the default goes in `{ status, body }`.

- [see only the public record, and may change the status and body](../packages/core/test/engine-respond.test.ts)
- [another status is declared with { status, body }](../packages/core/test/types/reply.types.test.ts)

## 9. One more authorization rule

```ts
a.store({
  // An order is placed for oneself.
  authorize: ({ prev, auth, input }) => prev && input.user_id === auth?.id,
}),
```

`authorize` receives the policy's decision as `prev`. Keeping `prev &&` adds a rule on top of the policy; dropping it replaces the policy for this action.

- [the policy decides first, then app, resource and action hooks run in order](../packages/core/test/cascade.test.ts)
- [the conformance fixture's orders blend](../packages/conformance/fixtures/shop/blends/orders.ts)

## 10. Soft delete, restore and trashed rows

```ts
export default blend(models.orders, {
  // The owner rule needs a record, so index (which has none) gets a policy of its own.
  // Deleting for good is not for owners: purge has a policy of its own.
  policy: {
    default: allow.owner('user_id'),
    index: allow.authenticated,
    purge: allow.when(({ auth }) => auth?.role === 'admin'),
  },
  actions: (a) => [a.index({ trashed: true }), a.show(), a.destroy(), a.restore(), a.purge()],
});
```

On a table with a nullable `deleted_at`, destroy sets it instead of deleting, and the row disappears from index and show. `restore` clears it. `index({ trashed: true })` accepts `?trashed=with` or `?trashed=only`. `purge` (`DELETE /orders/:id/purge`) deletes a row for good, whether it is soft-deleted or not, and answers 204; a row other rows still reference answers 409. Both exist only on a soft-delete table: elsewhere destroy already deletes for good (docs/decisions.md D29).

- [destroy soft-deletes: 204, the row stays with deleted_at set, show no longer finds it](../packages/core/test/engine-save.test.ts)
- [restore clears deleted_at](../packages/core/test/engine-save.test.ts)
- [purge deletes a soft-deleted row for good: 204, and restore no longer finds it](../packages/core/test/engine-save.test.ts)
- [23503 on purge: a row other rows still reference answers 409 and stays](../packages/core/test/engine-errors.test.ts)
- [?trashed works only where the resource enables it](../packages/core/test/engine-load.test.ts)

## 11. Do something once a write has committed

```ts
a.member('refund', {
  rules: () => z.object({ reason: z.string().min(3) }),
  calculate: () => ({ status: 'refunded' as const }),
  // Once the refund has committed, tell the customer.
  after: ({ saved, input }) => notify(saved.user_id, `Your order was refunded: ${input.reason}`),
}),
```

`after` runs once the action's write has committed, before the reply, with the row as saved (`saved`), the row as loaded (`record`), the input, the identity and the database. Only actions that write have one. The reply waits for it; what it throws goes to `createServer`'s `onError`, and the reply stands. App and resource `after` hooks run too, each in turn, so an app-wide audit log belongs in `defineApp({ hooks: { after } })`. `notify` stands for the app's own mailer.

- [after runs once the write has committed, with the saved row, the loaded row and the input](../packages/core/test/after.test.ts)
- [a failing after is reported, the other levels still run, and the reply stands](../packages/core/test/after.test.ts)
- [app, resource and action after run in that order, none replacing another](../packages/core/test/after.test.ts)

## 12. An effect that must not be lost

```ts
a.member('refund', {
  rules: () => z.object({ reason: z.string().min(3) }),
  calculate: () => ({ status: 'refunded' as const }),
  // From the outbox, at least once: the provider ignores a repeat with the same key.
  later: ({ saved, id }) => payments.refund(saved.id, { idempotencyKey: `refund-${id}` }),
}),
```

A `later` hook does not run in the request. The write leaves an outbox entry in its own transaction, so the entry exists exactly when the refund does, and the worker that `startOutbox({ app, db, resources })` starts in the server runs it: at least once, retrying until it succeeds or its tenth attempt fails. It may run twice, so give the other system the entry's `id` as an idempotency key. The first later hook brings the outbox table with it: run `blendx generate`, then `blendx migrate generate`. `payments` stands for the app's own client.

- [a write leaves one outbox entry per level, with the hook's context as JSON](../packages/core/test/later.test.ts)
- [a failing entry is reported, keeps its last error, and runs again once its delay has passed](../packages/core/test/outbox-worker.test.ts)
- [an entry a stopped worker held runs again once its lease ends](../packages/core/test/outbox-worker.test.ts)

## 13. Nest a related row

```ts
import users from './users.ts';

export default blend(models.orders, {
  policy: { default: allow.owner('user_id'), index: allow.public },
  includes: { user: users },
  actions: (a) => [a.index(), a.show()],
});
```

`GET /orders?include=user` gives every order its `user`, the row `user_id` points to: a relation is named after its foreign key column without `_id`. Each nested row is what the users blend's show would reply to the same requester, hidden columns removed, or `null` where it would refuse or find nothing. The target must expose show, and two blends cannot include each other.

- [show nests the row its foreign key points to, without its hidden columns](../packages/core/test/engine-include.test.ts)
- [each included row goes through the target's show: a row it refuses is null](../packages/core/test/engine-include.test.ts)
- [one query per relation, for the whole page](../packages/core/test/engine-include.test.ts)

## 14. Nest the rows that point at a row

```ts
import orderNotes from './order_notes.ts';

export default blend(models.orders, {
  policy: { default: allow.owner('user_id'), index: allow.public },
  includes: { notes: { blend: orderNotes, limit: 10, sort: '-created_at' } },
  actions: (a) => [a.index(), a.show()],
});
```

`GET /orders/1?include=notes` gives the order its `notes`, the rows of `order_notes` whose `order_id` points at it, newest first, at most ten, as an array that is `[]` when there are none. The blend names the include, since the schema does not name the inverse of a foreign key; `by: 'author_id'` picks the column when the target points at the table twice. The limit is required: a has-many include is for a row's bounded children, and a list that pages belongs on the target's index. Each row goes through the target's show as a belongs-to row does, and a row it refuses is dropped.

- [show nests the rows that point at it, at most its limit, in its order, without their hidden columns](../packages/core/test/engine-include.test.ts)
- [a row the target's show refuses is dropped, and still counts against the limit](../packages/core/test/engine-include.test.ts)
- [by names the foreign key, and is required when the target points at the table twice](../packages/core/test/includes.test.ts)

## 15. Nest an included row's own includes

```ts
import orders from './orders.ts';

export default blend(models.order_notes, {
  policy: allow.authenticated,
  includes: { order: orders },
  actions: (a) => [a.index(), a.show()],
});
```

Nothing more is declared: once the orders blend includes `user` (pattern 13), `GET /order_notes/1?include=order.user` gives the note its order, and the order its user. A path follows the includes of the included blends, as far as they go, and asks its prefixes on the way. Each level goes through its own blend's show, so an order the requester may not see is `null` with nothing below it, and a has-many's limit applies at its level. The review of `order_notes` lists every path a request can follow, `order.user: users, through its show: ...`, so a reviewer sees what a note can reach without opening the orders blend. The conformance fixture does it the other way round, its notes including their `author`, so `GET /orders/1?include=notes.author` nests an author into each of an order's notes.

- [a dotted path nests the include of an included row, and asks its prefixes](../packages/core/test/engine-include.test.ts)
- [a refused or missing belongs-to nests nothing below it](../packages/core/test/engine-include.test.ts)
- [a has-many under a has-many is bounded at each level](../packages/core/test/engine-include.test.ts)
