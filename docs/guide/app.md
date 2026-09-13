# The app and identity

`src/app.ts` default-exports `defineApp(spec)`: who is making a request, and the settings that apply to every table. Every key is optional; `defineApp({})` is a working app in which every request is anonymous.

| Key | |
|---|---|
| `auth` | resolves the identity of a request ([below](#the-identity)) |
| `hooks` | rules, authorize and respond hooks for every table ([App hooks](#app-hooks)) |
| `index` | paging: `{ perPage, maxPerPage }` ([Paging](#paging)) |
| `problems` | `{ typeBase }`, the base URI of problem types ([Problem types](#problem-types)) |

## The identity

`auth({ request, db })` runs once for every request, before routing, and returns the identity, or `null` when there is none. It answers "who is this?" and nothing else: whether they may do something is for policies and authorize hooks to decide.

From [`examples/expenses`](../../examples/expenses/src/app.ts), where the identity is the user whose API token is the bearer token:

```ts
import { defineApp } from 'blendx';
import { sql } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

const BEARER = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export default defineApp({
  auth: async ({ request, db }): Promise<{ id: number; is_approver: boolean } | null> => {
    const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return null;
    const users = models.users.table;
    const [user] = await db
      .select({ id: users.id, is_approver: users.is_approver })
      .from(users)
      .where(sql`${users.api_token} = ${token}`)
      .limit(1);
    return user ?? null;
  },
});
```

- Annotate the return type. Whatever `auth` returns, minus `null`, is the type of `auth` in every policy and hook, so `auth?.is_approver` is a boolean there and `auth?.admin` is a type error.
- Check a token's shape before it reaches the database. `api_token` is a `uuid` column, and PostgreSQL fails on a string that is not a UUID; that failure happens outside any action, so it would be a 500.
- A request with no identity, or one that `auth` does not recognise, is anonymous. An action whose policy needs an identity answers it with 401.
- `db` is the app's database. `auth` can also verify a JWT from an identity provider and return its claims, or look up a session; blendx only needs the result.

The type reaches the hooks through `src/generated/register.gen.ts`, which `blendx generate` writes: it registers `typeof app` with blendx. If `auth` is `unknown` in a hook, run `blendx generate`.

For tests, an app can take its identity from a header, as the [conformance fixture](../../packages/conformance/fixtures/shop/src/app.ts) does with `x-user-id`. Keep that out of production ([Testing](testing.md#identities-in-tests)).

## App hooks

App hooks run for every action of every table, before the resource's and the action's hooks ([The cascade](hooks.md#the-cascade)). They can hook `rules`, `authorize` and `respond`, receive the action's name (`action`) and its `model`, and must return the type they receive. `authorize` also receives the identity, `auth`, typed from what the app's `auth` function returns.

```ts
type Identity = { id: number; suspended: boolean };

export default defineApp({
  // lookUp stands for finding the identity, as in the example above.
  auth: async ({ request, db }): Promise<Identity | null> => lookUp(request, db),
  hooks: {
    // A suspended account is refused everywhere, whatever the policies say.
    authorize: ({ prev, auth }) => prev && auth?.suspended !== true,
    // No reply is cached.
    respond: ({ prev }) => ({ ...prev, headers: { ...prev.headers, 'cache-control': 'no-store' } }),
  },
});
```

`action` lets a hook single out actions: `({ prev, action }) => prev && action !== 'destroy'` refuses every destroy, in every table.

Write `auth` before `hooks`. TypeScript reads the object in order, and the hooks' `auth` type comes from the `auth` function; written the other way round, `auth` is `never` in the hooks, and `tsc` reports the `auth` function as not assignable.

## Paging

```ts
defineApp({ index: { perPage: 50, maxPerPage: 200 } });
```

`perPage` is the page size when a request does not send `per_page`, 25 by default. `maxPerPage` is the largest `per_page` accepted, 100 by default; a larger one is a 422. Both are positive integers, and `perPage` cannot exceed `maxPerPage`: `defineApp` throws when they do.

## Problem types

```ts
defineApp({ problems: { typeBase: 'https://api.example.com/problems/' } });
```

By default a problem's `type` is `about:blank`. With `typeBase`, it is a URI under it, one per status: `.../bad-request`, `.../unauthorized`, `.../forbidden`, `.../not-found`, `.../conflict`, `.../validation-error` and `.../internal-error`. Publish a page at each if clients should be able to look them up. A problem that a hook builds with `problem()` has `about:blank` unless it passes `typeBase` itself ([Hooks](hooks.md#stopping-with-a-problem)).
