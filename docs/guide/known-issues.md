# Known issues

What does not work yet, or not as it should, and what to do instead. Each was found while building [`examples/expenses`](../../examples/expenses) and writing this guide, and each is an item in the Inbox of [`docs/todo.md`](../todo.md), where it will be triaged and fixed. When one is fixed, its entry leaves this page.

| Issue | Affects |
|---|---|
| [Invalid dates answer 500](#invalid-dates-answer-500) | date and timestamp columns |
| [App-wide hooks cannot read the identity](#app-wide-hooks-cannot-read-the-identity) | `defineApp({ hooks })` |
| [A listing cannot be scoped to the requester](#a-listing-cannot-be-scoped-to-the-requester) | index, load hooks |
| [A column cannot be shown once and hidden elsewhere](#a-column-cannot-be-shown-once-and-hidden-elsewhere) | `hidden` |
| [The review lists every column for a calculate that spreads prev](#the-review-lists-every-column-for-a-calculate-that-spreads-prev) | review files |
| [The review prints long patterns for string formats](#the-review-prints-long-patterns-for-string-formats) | review files |
| [Custom actions without a body still need an empty body in the typed client](#custom-actions-without-a-body-still-need-an-empty-body-in-the-typed-client) | the typed client |

## Invalid dates answer 500

**What happens.** The default rule for a `date` or `timestamp` column accepts any string, and PostgreSQL decides what it means. It reads words such as `yesterday` as dates, and a string it cannot read, such as `2026-02-30`, fails in the database with an error blendx does not map (SQLSTATE 22008, or 22007 when malformed), so the client gets a 500 instead of a 422.

**What to do.** Give the column a rule of its own wherever clients send it:

```ts
rules: ({ prev }) => prev.extend({ spent_on: z.iso.date() }),
```

`z.iso.datetime()` does the same for timestamps. [The schema](schema.md#types).

## App-wide hooks cannot read the identity

**What happens.** In an app whose `auth` returns an identity, an app-level `authorize` hook that reads `auth` does not typecheck: the identity's type comes from the app, and the hook is part of the app, so `tsc` reports a circular type (`'auth' is referenced directly or indirectly in its own type annotation`). Annotating the hook's parameter does not help. The hook runs correctly; only the types fail. App hooks that do not read `auth`, such as a respond hook or an authorize hook that looks at `action`, typecheck.

**What to do.** Put a rule about the identity in a policy, or in each resource's `hooks`, where `auth` has its type:

```ts
hooks: {
  authorize: ({ prev, auth, action }) =>
    prev && (action === 'index' || action === 'show' || auth?.suspended !== true),
},
```

[The app and identity](app.md#app-hooks).

## A listing cannot be scoped to the requester

**What happens.** A load hook's `runDefault()` takes no filter, so an index hook cannot ask the default query for "only this user's rows". [Cookbook pattern 7](../cookbook.md#7-scope-a-listing-to-the-requester) filters the page after it is loaded, which leaves `meta.total` counting every row and pages shorter than `per_page` once the rows span pages.

**What to do.** Ask the client for the filter, and check it in authorize. The column must be filterable: a key, a foreign key or an indexed column.

```ts
a.index({
  authorize: ({ prev, auth, input }) =>
    prev && (auth?.is_approver === true || input.user_id === String(auth?.id)),
}),
```

The client then lists its own rows with `GET /expenses?user_id=<its id>`, and anything else is a 403. [Tutorial, step 6](tutorial.md#6-who-sees-what).

## A column cannot be shown once and hidden elsewhere

**What happens.** `hidden` applies to every reply of a resource, and a respond hook sees only the public record. A value that one reply must carry and every other reply must hide, such as an API token returned once at sign-up, has no way to say so.

**What to do.** Leave the column visible and expose the table only through actions whose replies may carry it. The expenses app's `users` blend has only sign-up and a show that is for the user themselves, so no reply shows a token to anyone else. [Tutorial, step 4](tutorial.md#4-sign-up).

## The review lists every column for a calculate that spreads prev

**What happens.** The review file lists the columns a calculate writes, from its return type. `prev` is typed as any writable column of the table, so a calculate such as `({ prev, input }) => ({ ...prev, total })` is listed as writing every writable column, though at run time `prev` holds only the input's columns.

**What to do.** Spread `input` instead: `({ input }) => ({ ...input, total })` writes the same columns, and the review names exactly those. [Hooks](hooks.md#calculate).

## The review prints long patterns for string formats

**What happens.** An input field with a string format, such as `z.iso.date()`, `z.email()` or a `uuid` column, is described with its format and then zod's whole regular expression for it:

```yaml
spent_on: string (date), matching ^(?:(?:\d\d[2468][048]|\d\d[13579][26]|...
```

**What to do.** Nothing is wrong with the rule. Read the format in parentheses, `(date)`, and skip the pattern after it.

## Custom actions without a body still need an empty body in the typed client

**What happens.** In the typed client, a custom action that is not a GET takes a JSON body even when its rules accept nothing, so a call without one is a type error. Built-in actions without a body, such as `restore`, take only the path parameter.

**What to do.** Pass an empty body:

```ts
await client.expenses[':id'].submit.$post({ param: { id: '1' }, json: {} });
```

Over plain HTTP nothing changes: an empty body counts as `{}`. [The HTTP API](http.md#the-typed-client).
