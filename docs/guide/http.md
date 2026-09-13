# The HTTP API

What a client of a blendx app sees. The replies below come from [`examples/expenses`](../../examples/expenses).

## Requests

- Bodies are JSON, sent with `content-type: application/json`. An action whose method is GET reads its input from the query string instead.
- Input is strict. A key the action's rules do not know is refused with 422, so a client cannot set a column it was not meant to, such as the `user_id` or `total` of an expense claim.
- A body that is not valid JSON is refused with 400. An empty body counts as `{}`.

## Routes

| Action | Route | Reply |
|---|---|---|
| index | `GET /<table>` | 200, a page |
| store | `POST /<table>` | 201, the record |
| show | `GET /<table>/:id` | 200, the record |
| update | `PATCH /<table>/:id` | 200, the record |
| destroy | `DELETE /<table>/:id` | 204, no body |
| restore | `POST /<table>/:id/restore` | 200, the record |
| purge | `DELETE /<table>/:id/purge` | 204, no body |
| member action | `POST /<table>/:id/<name>` | 200, the record |
| collection action | `POST /<table>/<name>` | 200, what it calculated |

Custom actions can use another method ([Blends](blends.md#custom-actions)). Only the actions a blend lists have routes; any other request is a 404.

## Records

A record holds the row's columns as the database returns them, minus the blend's hidden columns (unless the action reveals them), under their names in the schema:

```json
{
  "id": 1,
  "user_id": 1,
  "description": "Team lunch",
  "category": "meals",
  "amount": "40.00",
  "tax": "4.00",
  "total": "44.00",
  "status": "draft",
  "spent_on": "2026-09-01",
  "review_note": null,
  "created_at": "2026-09-13 12:48:15.212",
  "updated_at": "2026-09-13 12:48:15.212",
  "deleted_at": null
}
```

`numeric` columns are strings, and timestamps are in PostgreSQL's text form, not ISO 8601 ([The schema](schema.md#types)).

## Listing

`GET /expenses?user_id=1` answers a page:

```json
{
  "data": [{ "id": 1, "user_id": 1, "description": "Team lunch", "...": "..." }],
  "meta": { "page": 1, "per_page": 25, "total": 1 }
}
```

The query parameters:

| Parameter | |
|---|---|
| `page` | a positive integer; 1 by default |
| `per_page` | a positive integer; 25 by default, at most 100 (the app can change both: [paging](app.md#paging)) |
| `sort` | a filterable column, or `-column` for descending; the primary key, ascending, by default |
| a column | an exact match, for primary key, unique, foreign key and indexed columns: `?status=submitted` |
| `trashed` | `with` or `only`, when the blend enables it ([index options](blends.md#index-options)) |
| `include` | relations to nest, comma-separated, such as `user`, or paths through them, such as `notes.author`, when the blend declares includes ([Includes](#includes)) |

Soft-deleted rows are left out unless `trashed` says otherwise. Hidden columns can neither filter nor sort. Any other parameter is refused with 422. An index with a `scope` lists only the rows in it: in the expenses API, a claimant lists only their own claims, and asking for someone else's (`?user_id=2`) answers an empty page.

## Includes

A blend may let index and show nest the row a foreign key points to ([Blends](blends.md#includes)). In the conformance fixture, whose orders include their user, `GET /orders/1?include=user` from Ada answers:

```json
{
  "id": 1,
  "user_id": 1,
  "status": "paid",
  "...": "...",
  "user": { "id": 1, "email": "ada@example.com", "display_name": "Ada", "...": "..." }
}
```

- `include` takes the comma-separated names the blend declares; any other name is refused with 422, naming the parameter. show takes it too, as its only query parameter.
- An included row is what `GET /users/1` would answer the same requester: its hidden columns are left out, and a row that request would refuse or not find, such as a soft-deleted one, is `null`. Asked without an identity, the fixture's `user` is `null`, since its users need a signed-in requester.
- On index, every row of the page gets its own, and each relation's rows are loaded in one query.
- `AppType`, the React client and OpenAPI give each include as an optional, nullable field.

A has-many include ([Blends](blends.md#the-rows-that-point-at-a-row)) nests an array. The fixture's orders include their two newest notes, so `GET /orders/1?include=notes` from Ada answers:

```json
{
  "id": 1,
  "...": "...",
  "notes": [
    { "id": 3, "order_id": 1, "body": "third", "created_at": "..." },
    { "id": 2, "order_id": 1, "body": "second", "created_at": "..." }
  ]
}
```

- The array holds at most the include's limit, in its order, and is `[]` where there are none. It is never `null`.
- Each row is what `GET /order_notes/3` would answer the same requester; a row that request would refuse is left out. Without an identity the fixture's `notes` is `[]`, since its notes need a signed-in requester.
- `AppType`, the React client and OpenAPI give it as an optional array of the target's record.

A path follows an included row's own includes ([Blends](blends.md#includes)). The fixture's notes include their author, so `GET /orders/1?include=notes.author` from Ada answers:

```json
{
  "id": 1,
  "...": "...",
  "notes": [
    { "id": 3, "order_id": 1, "author_id": 2, "body": "third", "author": { "id": 2, "display_name": "Bob", "...": "..." } },
    { "id": 2, "order_id": 1, "author_id": null, "body": "second", "author": null }
  ]
}
```

- A path asks its prefixes: `notes.author` nests `notes`, with `author` inside each. `notes.author,user` asks for two paths.
- Each level is what its own show would answer the same requester, so a note Ada may not see is left out with its author, and an author she may not see is `null`.
- An unknown segment, at any position, is refused with 422 naming the parameter. The paths a blend accepts are listed in its review, and in the parameter's description in OpenAPI.
- Each path is one query for the whole reply.

## Errors

Every error is an RFC 9457 Problem Details object, served as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "The request did not pass validation.",
  "errors": [
    { "pointer": "/amount", "detail": "Invalid input: expected string, received number" },
    { "pointer": "/total", "detail": "is not an accepted field" }
  ]
}
```

- `errors` lists every problem, not only the first. In a body, each entry has a JSON `pointer` to the field; in a query string, it names the `parameter`:

  ```json
  { "parameter": "category", "detail": "Invalid option: expected one of \"travel\"|\"meals\"|\"office\"|\"other\"" }
  ```

- `type` is `about:blank`, or a URI under the app's `problems.typeBase` when it sets one, such as `https://api.example.com/problems/validation-error` ([The app](app.md#problem-types)).
- `title` is the status's standard reason phrase.

| Status | When |
|---|---|
| 400 | The body is not valid JSON. |
| 401 | The action's policy needs an identity, and the request has none. |
| 403 | The policy or an authorize hook refuses. |
| 404 | No route matches, or a member action's record does not exist (a soft-deleted one included). |
| 409 | A unique value already exists, or a destroy or purge hits a row other rows still reference. |
| 422 | The input is invalid, or the database refuses a value: a reference to a missing row, a required column left empty, a value its column cannot hold. |
| 500 | Anything else. The client gets no details; the server's `onError` gets the error. |

### The order of failures

A request stops at the first stage that fails, so the statuses come in a fixed order: 401, then 422, 404, 403, and finally 409 or 422 from the database. A client without a token learns nothing about the input or the record; a client whose input is invalid learns nothing about whether the record exists. The full rules are in [`packages/spec/errors.md`](../../packages/spec/errors.md) and [`pipeline.md`](../../packages/spec/pipeline.md).

## OpenAPI

`blendx generate` writes `src/generated/openapi.json`, an OpenAPI 3.1 document of every route: its parameters, its request body, and each reply by status, Problem Details included. Each operation's id is `<table>.<action>`, such as `expenses.submit`.

The document is a file. To serve it, add a route to the server:

```ts
import openapi from './src/generated/openapi.json' with { type: 'json' };

const server = createServer({ app, db: database.db, routes });
server.get('/openapi.json', (c) => c.json(openapi));
```

(The import needs `resolveJsonModule` in `tsconfig.json`.) Any OpenAPI tool can then read it: documentation, clients in other languages, contract tests.

## The typed client

For a TypeScript client, `AppType` from the generated routes gives a [Hono RPC](https://hono.dev/docs/guides/rpc) client each route's input, and its replies by status. From [`examples/expenses/test/client.test.ts`](../../examples/expenses/test/client.test.ts):

```ts
import { hc } from 'blendx/client';
import type { AppType } from './server.ts';

const client = hc<AppType>('http://localhost:3000', {
  headers: { authorization: `Bearer ${token}` },
});

const filed = await client.expenses.$post({
  json: { description: 'Team lunch', category: 'meals', amount: '40.00', spent_on: '2026-09-01' },
});
if (filed.status === 201) {
  const claim = await filed.json(); // claim.status is 'draft' | 'submitted' | 'approved' | 'rejected'
  await client.expenses[':id'].submit.$post({ param: { id: String(claim.id) } });
}

const quoted = await client.expenses.quote.$get({ query: { amount: '10', category: 'office' } });
```

- Input is typed by the action's rules: `category: 'food'` is a type error. An action whose rules accept nothing, like `submit`, takes only its path parameter.
- Checking `status` narrows the body: the record for 201, a problem for 422.
- An action the blend does not list is not on the client at all.

Import `hc` from `blendx/client`, not from `hono/client`: `AppType` is built with the Hono that blendx uses, and the client must use the same one.

For a React app, [The React client](react.md) turns this client into TanStack Query options for every action.
