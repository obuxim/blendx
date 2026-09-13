# Tutorial: an expenses API

This tutorial builds [`examples/expenses`](../../examples/expenses) from an empty folder. The app:

- lets people sign up, and gives each a bearer token;
- lets them file expense claims. A claim is priced from its category: meals include 10% tax, office supplies 20%, travel and everything else none;
- lets a claimant edit, delete and restore a claim while it is a draft, and then submit it;
- lets an approver approve a submitted claim, or reject it with a note, but never one they filed themselves.

Each step shows the code as it ends up in the example, and the replies are from a real run. It assumes you have done [Getting started](getting-started.md).

## 1. The folder

Set the folder up as in [Getting started](getting-started.md#install-blendx): `package.json`, `tsconfig.json`, and the same `server.ts`. In the repository, the app is `examples/expenses`, a workspace. Its config uses PostgreSQL when `DATABASE_URL` is set, and PGlite otherwise, so it runs anywhere:

```ts
// blendx.config.ts
import { defineConfig } from 'blendx';

export default defineConfig({
  database: process.env.DATABASE_URL ? { driver: 'pg' } : { driver: 'pglite', url: './.data' },
  openapi: { title: 'Expenses API', version: '1.0.0' },
});
```

## 2. The schema

`schema.dbml`:

```dbml
// Expense claims: people file what they spent, and approvers approve or reject it.

Enum expense_category {
  travel
  meals
  office
  other
}

Enum expense_status {
  draft
  submitted
  approved
  rejected
}

Table users {
  id int [pk, increment]
  email varchar(255) [not null, unique]
  name varchar(80) [not null]
  is_approver boolean [not null, default: false]
  api_token uuid [not null, unique, default: `gen_random_uuid()`]
  created_at timestamp [not null, default: `now()`]
  updated_at timestamp [not null, default: `now()`]
}

Table expenses {
  id int [pk, increment]
  user_id int [not null, ref: > users.id]
  description varchar(200) [not null]
  category expense_category [not null]
  amount numeric(10,2) [not null]
  tax numeric(10,2) [not null]
  total numeric(10,2) [not null]
  status expense_status [not null, default: 'draft']
  spent_on date [not null]
  review_note varchar(500)
  created_at timestamp [not null, default: `now()`]
  updated_at timestamp [not null, default: `now()`]
  deleted_at timestamp

  indexes {
    status
    spent_on
  }
}
```

What blendx reads from it ([The schema](schema.md)):

- `id`, `created_at` and `updated_at` are filled by the database and blendx, and never accepted as input.
- `email` is unique, so signing up twice with it is a 409.
- The database makes every user's `api_token` (`gen_random_uuid()`), and every user starts as a non-approver.
- Money is `numeric(10,2)`, so it travels as strings (`"40.00"`) and loses nothing to floating point.
- `deleted_at` makes claims soft-deleted: a deleted claim disappears from listings and can be restored.
- `status` and `spent_on` are indexed, and `user_id` is a foreign key, so all three can filter and sort the listing: `?status=submitted&sort=-spent_on`.

## 3. The identity

A request's identity is the user whose `api_token` it sends as `Authorization: Bearer <token>`. `src/app.ts`:

```ts
import { defineApp } from 'blendx';
import { sql } from 'blendx/drizzle';
import { models } from './generated/schema.gen.ts';

const BEARER = /^Bearer ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export default defineApp({
  /**
   * The identity is the user whose api_token is the request's bearer token. Without a token,
   * or with one nobody has, there is no identity, and actions that need one answer 401.
   */
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

The return type matters: from now on, `auth` in every policy and hook is `{ id: number; is_approver: boolean }`. The regular expression keeps anything that is not a UUID away from the `uuid` column, where PostgreSQL would fail on it ([The app and identity](app.md#the-identity)).

## 4. Sign-up

`blends/users.ts`:

```ts
import { allow, blend, z } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.users, {
  // Anyone may sign up. After that, a user sees only their own record.
  policy: { store: allow.public, show: allow.owner('id') },
  actions: (a) => [
    a.store({
      // Only the email and the name come from the request: is_approver and api_token keep
      // their schema defaults. The 201 reply carries the new api_token, the bearer token.
      rules: ({ prev }) =>
        prev.pick({ email: true, name: true }).extend({ email: z.email().max(255) }),
    }),
    a.show(),
  ],
});
```

- Two actions, and nothing else: there is no way to list, change or delete users through the API.
- `store` is public; `show` is for the user themselves (`users.id` equal to the identity's `id`).
- The default store rules would accept `is_approver` and `api_token`, since both are ordinary columns with defaults. `pick` keeps only `email` and `name`, so anyone who sends `is_approver: true` gets a 422 instead of a promotion. `extend` tightens `email` from "a string of at most 255 characters" to an email address.
- The reply to sign-up is the record, `api_token` included: that is how a user gets their token. `hidden` would keep the token out of every reply of the resource, sign-up's too, so instead no action shows a user to anyone else.

Generate the files, write the first migration and apply it:

```sh
bunx blendx generate
bunx blendx migrate generate --name init
bunx blendx migrate up
```

(`blendx generate` reads `src/app.ts` and the `blends/` folder as well as the schema, which is why they come first.)

Start the server with `bun server.ts` and sign up:

```
$ curl -s -X POST localhost:3000/users -H 'content-type: application/json' \
    -d '{"email":"ada@example.com","name":"Ada"}'
{"id":1,"email":"ada@example.com","name":"Ada","is_approver":false,"api_token":"c7dc1553-b4fd-4bb6-96ab-d83bcd5d1fbd","created_at":"2026-09-13 12:48:14.595","updated_at":"2026-09-13 12:48:14.595"}
```

Keep the token, and sign up Bob and Cy the same way:

```sh
ADA=c7dc1553-b4fd-4bb6-96ab-d83bcd5d1fbd
BOB=d3d4c8bf-b984-4c26-940e-e042d5d0edb4
CY=33abb775-6801-487a-86b7-70d671a1cff3
```

## 5. Filing a claim

Now the claims. `blends/expenses.ts` starts with the business rule, a plain function:

```ts
import { allow, blend, z } from 'blendx';
import { expense_category, models } from '../src/generated/schema.gen.ts';

type Category = (typeof expense_category.enumValues)[number];

/** The tax included in each category's claims. */
const TAX_RATES: Record<Category, number> = { travel: 0, meals: 0.1, office: 0.2, other: 0 };

/** Tax at the category's rate, and the total. Numeric columns are strings; sums run in cents. */
function price(amount: string, category: Category) {
  const cents = Math.round(Number(amount) * 100);
  const tax = Math.round(cents * TAX_RATES[category]);
  return { tax: (tax / 100).toFixed(2), total: ((cents + tax) / 100).toFixed(2) };
}

/** An amount that numeric(10,2) holds: 12.50, 7 or 0.99. */
const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be an amount such as 12.50');
```

`TAX_RATES` is typed by the enum: add a category to the schema, and `tsc` asks for its rate.

The first version of the blend files a claim and shows it:

```ts
export default blend(models.expenses, {
  policy: { default: allow.owner('user_id'), store: allow.authenticated },
  actions: (a) => [
    a.store({
      rules: ({ prev }) =>
        prev.pick({ description: true, category: true, spent_on: true }).extend({ amount }),
      calculate: ({ input }) => ({ ...input, ...price(input.amount, input.category) }),
      // The claimant is whoever is signed in. calculate never sees the identity; save does.
      save: ({ runDefault, writes, auth }) => runDefault({ ...writes, user_id: auth?.id }),
    }),
    a.show(),
  ],
});
```

Three hooks, one per stage that differs ([Hooks](hooks.md)):

- **rules**: a claim is described by four fields. `pick` takes `description`, `category` and `spent_on` with their derived rules (at most 200 characters; one of the enum's values; a real day as `YYYY-MM-DD`), and `extend` adds `amount` with a stricter rule than the schema gives: for `numeric` the schema only says "a string", and PostgreSQL would decide the rest. Everything else, `user_id`, `tax`, `total`, `status`, is refused.
- **calculate**: the input, plus `tax` and `total` from `price()`. calculate is pure: no database, no identity, no clock. That is why the review examples can replay it (step 10).
- **save**: the claimant is the signed-in user, never something the client sends. calculate cannot see the identity, so this happens in save, which can: it passes the writes to the default insert with `user_id` added.

`bunx blendx generate` again, and file a claim:

```
$ curl -s -X POST localhost:3000/expenses -H 'content-type: application/json' -H "authorization: Bearer $ADA" \
    -d '{"description":"Team lunch","category":"meals","amount":"40.00","spent_on":"2026-09-01"}'
{"id":1,"user_id":1,"description":"Team lunch","category":"meals","amount":"40.00","tax":"4.00","total":"44.00","status":"draft","spent_on":"2026-09-01","review_note":null,"created_at":"2026-09-13 12:48:15.212","updated_at":"2026-09-13 12:48:15.212","deleted_at":null}
```

Without a token, the policy needs an identity, so the request stops before its body is read:

```
{"type":"about:blank","title":"Unauthorized","status":401}
```

And a client that tries to set what it may not gets every mistake at once:

```
$ curl -s -X POST localhost:3000/expenses -H 'content-type: application/json' -H "authorization: Bearer $ADA" \
    -d '{"description":"Taxi","category":"travel","amount":12.5,"spent_on":"2026-09-01","total":"1.00"}'
{"type":"about:blank","title":"Unprocessable Content","status":422,"detail":"The request did not pass validation.","errors":[{"pointer":"/amount","detail":"Invalid input: expected string, received number"},{"pointer":"/total","detail":"is not an accepted field"}]}
```

## 6. Who sees what

The rules for seeing claims:

- a claim is its claimant's, and approvers see everyone's;
- anyone signed in can file one;
- approvers approve and reject.

The full policy:

```ts
const approvers = allow.when(({ auth }) => auth?.is_approver === true, {
  requiresAuth: true,
  description: 'an approver',
});

export default blend(models.expenses, {
  // A claim belongs to its claimant. Approvers also see and review everyone's.
  policy: {
    default: allow.owner('user_id'),
    index: allow.authenticated,
    store: allow.authenticated,
    quote: allow.authenticated,
    show: allow.when(
      ({ auth, record }) => auth?.is_approver === true || record?.user_id === auth?.id,
      { requiresAuth: true, description: 'the claimant, or an approver' },
    ),
    approve: approvers,
    reject: approvers,
  },
  actions: (a) => [
    a.index({
      // Approvers list every claim. Everyone else lists their own, with ?user_id=<their id>.
      authorize: ({ prev, auth, input }) =>
        prev && (auth?.is_approver === true || input.user_id === String(auth?.id)),
    }),
    // store and show as before, then the actions of the next steps
  ],
});
```

- `default: allow.owner('user_id')` covers every action without its own entry: update, destroy, restore and submit. The owner rule needs a record, so the actions without one (index, store, the `quote` of step 9) get their own policy.
- `allow.when` takes any rule. Its `description` is what the review file will show, and `requiresAuth: true` makes an anonymous request a 401 rather than a 403.
- Listing needs more than the policy: `allow.authenticated` lets anyone signed in list, and the authorize hook adds the rest. It receives the policy's decision as `prev`, and the validated query as `input`: approvers may list anything; anyone else must ask for `?user_id=` with their own id. (Index filter values are strings, hence `String(auth?.id)`.)

```
$ curl -s localhost:3000/expenses/1 -H "authorization: Bearer $BOB"
{"type":"about:blank","title":"Forbidden","status":403}

$ curl -s localhost:3000/expenses -H "authorization: Bearer $ADA"
{"type":"about:blank","title":"Forbidden","status":403}

$ curl -s 'localhost:3000/expenses?user_id=1' -H "authorization: Bearer $ADA"
{"data":[{"id":1,"user_id":1,"description":"Team lunch","category":"meals","amount":"40.00","tax":"4.00","total":"44.00","status":"draft","spent_on":"2026-09-01","review_note":null,"created_at":"2026-09-13 12:48:15.212","updated_at":"2026-09-13 12:48:15.212","deleted_at":null}],"meta":{"page":1,"per_page":25,"total":1}}
```

Asking for the filter is a workaround: the default listing cannot yet be scoped to the requester in a load hook without breaking its pages ([Known issues](known-issues.md#a-listing-cannot-be-scoped-to-the-requester)).

## 7. Drafts

A claimant may change, delete and restore a claim while it is a draft:

```ts
a.update({
  rules: ({ prev }) =>
    prev
      .pick({ description: true, category: true, spent_on: true })
      .extend({ amount: amount.optional() }),
  // Only a draft changes, and a new amount or category is priced again.
  authorize: ({ prev, record }) => prev && record.status === 'draft',
  calculate: ({ input, record }) => ({
    ...input,
    ...price(input.amount ?? record.amount, input.category ?? record.category),
  }),
}),
a.destroy({ authorize: ({ prev, record }) => prev && record.status === 'draft' }),
a.restore(),
```

- update's default rules are the store rules with every field optional, so the same `pick` and `extend` work, with optional fields.
- The authorize hooks add a state rule to the owner policy: `prev && record.status === 'draft'`. They can see the record because load runs before authorize.
- calculate prices the claim again, with whichever of amount and category the request did not change taken from the record.
- destroy soft-deletes (the table has `deleted_at`), and `restore` brings a claim back. It exists only because the table soft-deletes.

```
$ curl -s -X PATCH localhost:3000/expenses/1 -H 'content-type: application/json' -H "authorization: Bearer $ADA" \
    -d '{"amount":"50.00"}'
{"id":1,"user_id":1,"description":"Team lunch","category":"meals","amount":"50.00","tax":"5.00","total":"55.00","status":"draft",...}
```

## 8. Submitting and reviewing

Three custom actions move a claim through its states:

```ts
/** A claim waits for review, and nobody reviews their own. */
const reviewable = (record: { status: string; user_id: number }, auth: { id: number } | null) =>
  record.status === 'submitted' && record.user_id !== auth?.id;
```

```ts
a.member('submit', {
  authorize: ({ prev, record }) => prev && record.status === 'draft',
  calculate: () => ({ status: 'submitted' as const }),
}),
a.member('approve', {
  authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
  calculate: () => ({ status: 'approved' as const }),
}),
a.member('reject', {
  rules: () => z.object({ note: z.string().min(3).max(500) }),
  authorize: ({ prev, auth, record }) => prev && reviewable(record, auth),
  calculate: ({ input }) => ({ status: 'rejected' as const, review_note: input.note }),
}),
```

A member action is `POST /expenses/:id/<name>`. It loads the claim locked for the update, checks the policy and the authorize hook, saves what calculate returns, and replies with the claim. `submit` falls under the default owner policy; `approve` and `reject` have the `approvers` policy. `reject` takes a note; the others take no body.

Approvers are not made through the API. `scripts/make-approver.ts` makes one directly in the database, with the same config and generated models the app uses:

```ts
import { createDatabase } from 'blendx';
import { sql } from 'blendx/drizzle';
import config from '../blendx.config.ts';
import { models } from '../src/generated/schema.gen.ts';

const email = process.argv[2];
if (!email) {
  console.error('usage: bun scripts/make-approver.ts <email>');
  process.exit(2);
}

const database = await createDatabase(config);
const users = models.users.table;
const updated = await database.db
  .update(users)
  .set({ is_approver: true })
  .where(sql`${users.email} = ${email}`)
  .returning({ id: users.id });
await database.close();

console.log(updated.length === 1 ? `${email} is an approver` : `no user has the email ${email}`);
process.exit(updated.length === 1 ? 0 : 1);
```

With PGlite, stop the server first: only one process at a time can open the data folder.

```
$ bun scripts/make-approver.ts cy@example.com
cy@example.com is an approver
```

Then, with the server running again, Ada submits, and her claim is locked:

```
$ curl -s -X POST localhost:3000/expenses/1/submit -H "authorization: Bearer $ADA"
{"id":1,...,"status":"submitted",...}

$ curl -s -X PATCH localhost:3000/expenses/1 -H 'content-type: application/json' -H "authorization: Bearer $ADA" -d '{"amount":"1.00"}'
{"type":"about:blank","title":"Forbidden","status":403}
```

Cy finds it and approves it, once:

```
$ curl -s 'localhost:3000/expenses?status=submitted' -H "authorization: Bearer $CY"
{"data":[{"id":1,...,"status":"submitted",...}],"meta":{"page":1,"per_page":25,"total":1}}

$ curl -s -X POST localhost:3000/expenses/1/approve -H "authorization: Bearer $CY"
{"id":1,...,"status":"approved",...}

$ curl -s -X POST localhost:3000/expenses/1/approve -H "authorization: Bearer $CY"
{"type":"about:blank","title":"Forbidden","status":403}
```

## 9. A quote

Clients want to show the total before a claim is filed. A collection action computes it without loading or saving anything:

```ts
a.collection('quote', {
  method: 'get',
  rules: () => z.object({ amount, category: z.enum(expense_category.enumValues) }),
  calculate: ({ input }) => price(input.amount, input.category),
  reply: z.object({ tax: z.string(), total: z.string() }),
}),
```

What calculate returns is the reply, so `reply` declares its shape for OpenAPI and the review; `tsc` checks that it matches `price()`'s result. The same `price()` serves store, update and quote, so they cannot disagree.

```
$ curl -s 'localhost:3000/expenses/quote?amount=10&category=office' -H "authorization: Bearer $ADA"
{"tax":"2.00","total":"12.00"}

$ curl -s 'localhost:3000/expenses/quote?amount=10&category=food' -H "authorization: Bearer $ADA"
{"type":"about:blank","title":"Unprocessable Content","status":422,"detail":"The request did not pass validation.","errors":[{"parameter":"category","detail":"Invalid option: expected one of \"travel\"|\"meals\"|\"office\"|\"other\""}]}
```

The blend is complete: [`blends/expenses.ts`](../../examples/expenses/blends/expenses.ts).

## 10. The review

```sh
bunx blendx review
```

writes [`review/expenses.yaml`](../../examples/expenses/review/expenses.yaml) and [`review/users.yaml`](../../examples/expenses/review/users.yaml). They say, for each action, what it accepts and what each stage does, in words. Someone who does not read TypeScript can check that approvers review only what was submitted:

```yaml
  approve:
    route: POST /expenses/:id/approve
    stages:
      rules: nothing (an empty object)
      load: the row by id, not soft-deleted, locked for update
      authorize: an approver # from: schema, action
      calculate: the input's writable columns # from: schema, action
      save: update the row, touching updated_at, when there is something to write
      respond: 200 with the saved record
    calculate:
      source: |-
        () => ({ status: 'approved' as const })
      writes: [status]
```

and that filing a claim writes the priced columns and nothing else:

```yaml
    calculate:
      source: |-
        ({ input }) => ({ ...input, ...price(input.amount, input.category) })
      writes: [amount, category, description, spent_on, tax, total]
```

The people who own the rules write examples in [`review/expenses.examples.yaml`](../../examples/expenses/review/expenses.examples.yaml):

```yaml
store:
  - name: meals carry 10% tax
    input: { description: Team lunch, category: meals, amount: '40.00', spent_on: '2026-09-01' }
    writes:
      { description: Team lunch, category: meals, amount: '40.00', spent_on: '2026-09-01', tax: '4.00', total: '44.00' }
  - name: tax is rounded to the cent
    input: { description: Pens, category: office, amount: '0.99', spent_on: '2026-09-03' }
    writes:
      { description: Pens, category: office, amount: '0.99', spent_on: '2026-09-03', tax: '0.20', total: '1.19' }
  - name: the claimant and the totals are never sent
    input: { description: Taxi, category: travel, amount: '12.50', spent_on: '2026-09-04', user_id: 2, total: '1.00' }
    rejects: [/total, /user_id]
```

`bunx blendx review --check` fails if the review file no longer matches the code, or if an example does not hold. When a reviewer wants a change, say a 12% rate for meals, they change the example, the check fails, and the blend changes until it passes ([Review](review.md#asking-for-a-change)).

## 11. Tests

The example has three test files:

- [`test/api.test.ts`](../../examples/expenses/test/api.test.ts): the whole story over HTTP on PGlite, including every refusal: 401 without a token, 403 for someone else's claim, 403 for an approver's own claim, 422 for a smuggled `user_id`, 409 for a second sign-up.
- [`test/examples.test.ts`](../../examples/expenses/test/examples.test.ts): the review examples.
- [`test/client.test.ts`](../../examples/expenses/test/client.test.ts): the typed client.

[Testing](testing.md) explains the setup. Together with the typecheck and the two checks, they are what "done" means:

```sh
bunx blendx generate --check
bunx blendx review --check
bunx tsc --noEmit
bun test
```

## What you wrote

| File | Lines |
|---|---|
| `schema.dbml` | 46 |
| `src/app.ts` | 23 |
| `blends/users.ts` | 16 |
| `blends/expenses.ts` | 90 |

About 175 lines, plus a script and the tests. From them, blendx generated about 1,700 lines of routes, types, OpenAPI and review files, and serves these routes, each validated, authorized, transactional and documented:

| Route | Who |
|---|---|
| `POST /users` | anyone |
| `GET /users/:id` | the user |
| `GET /expenses` | approvers; others with `?user_id=<their id>` |
| `POST /expenses` | anyone signed in |
| `GET /expenses/quote` | anyone signed in |
| `GET /expenses/:id` | the claimant, or an approver |
| `PATCH /expenses/:id` | the claimant, while a draft |
| `DELETE /expenses/:id` | the claimant, while a draft |
| `POST /expenses/:id/restore` | the claimant |
| `POST /expenses/:id/submit` | the claimant, while a draft |
| `POST /expenses/:id/approve` | an approver, not the claimant, once submitted |
| `POST /expenses/:id/reject` | an approver, not the claimant, once submitted |

To keep going: the [cookbook](../cookbook.md) has more blend patterns, and the reference pages cover each part in full.
