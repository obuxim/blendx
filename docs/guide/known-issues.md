# Known issues

What does not work yet, or not as it should, and what to do instead. Each was found while building [`examples/expenses`](../../examples/expenses) and writing this guide, and each is planned for a fix in phase P15 of [`docs/todo.md`](../todo.md). When one is fixed, its entry leaves this page.

| Issue | Affects | Fixed by |
|---|---|---|
| [A listing cannot be scoped to the requester](#a-listing-cannot-be-scoped-to-the-requester) | index, load hooks | P15.7 |
| [A column cannot be shown once and hidden elsewhere](#a-column-cannot-be-shown-once-and-hidden-elsewhere) | `hidden` | P15.8 |
| [The review lists every column for a calculate that spreads prev](#the-review-lists-every-column-for-a-calculate-that-spreads-prev) | review files | P15.4 |
| [The review prints long patterns for string formats](#the-review-prints-long-patterns-for-string-formats) | review files | P15.5 |
| [Custom actions without a body still need an empty body in the typed client](#custom-actions-without-a-body-still-need-an-empty-body-in-the-typed-client) | the typed client | P15.6 |

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
