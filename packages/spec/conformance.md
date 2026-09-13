# Conformance

The conformance suite defines blendx's behaviour over HTTP, independent of any language: cases of requests and the responses they must get. Every runtime runs the same cases against the same fixture app and must pass all of them. The TypeScript types and matchers are in `packages/conformance/src`.

## The shop fixture

`packages/conformance/fixtures/shop` is the app every runtime serves for the suite. It is the `shop` schema (users; orders with an enum, a foreign key, soft delete and indexes; order notes) and three blends. Between them they exercise:

- a hidden column (`users.password`) and a unique one (`users.email`);
- foreign keys, from orders to users and from order notes to orders;
- the owner policy: an order belongs to its `user_id`, and users update only themselves;
- an action-level authorize hook: an order can only be placed for oneself;
- index filters and sorting, soft delete, `?trashed` and restore;
- a custom member action (`POST /orders/:id/refund`) and a custom collection action (`GET /orders/quote`, with a declared reply).

The identity is the `x-user-id` request header: a positive integer is that user, anything else is no identity.

Before each case the database is reset: every table is truncated, identities restart, and `seed.sql` runs. The seed is users 1 (Ada) and 2 (Bob), and order 1, paid, of user 1. The cases live in `packages/conformance/cases/*.json`.

## Case files

A case file is JSON:

```json
{
  "format": 1,
  "fixture": "shop",
  "cases": [
    {
      "id": "DR-STORE-STRICT",
      "title": "store rejects keys the rules do not know",
      "steps": [
        {
          "request": {
            "method": "POST",
            "path": "/orders",
            "body": { "user_id": 1, "total": "9.50", "coupon": "x" }
          },
          "expect": {
            "status": 422,
            "headers": { "content-type": "application/problem+json" },
            "body": { "errors": [{ "pointer": "/coupon" }] }
          }
        }
      ]
    }
  ]
}
```

- `id` is unique across the suite: a derivation rule id (`DR-...`), an error status, or another stable name.
- Each case starts from a reset database, and its steps run in order.
- `request` has a `method` (`GET`, `POST`, `PATCH`, `DELETE`), a `path`, and optional `headers` and body: a JSON `body`, or `text` sent exactly as written (with `content-type: application/json`), for bodies that are not valid JSON. `{name}` in a path is replaced by a value captured earlier in the same case.
- `capture` (optional) maps names to JSON pointers (RFC 6901) into the response body: `{ "order": "/id" }` saves the new order's id for later steps.
- `expect` has the exact `status`, optional `headers` and an optional `body`. Header names match case-insensitively and values exactly, except that the parameters of `content-type` (after `;`) are ignored. Without `body`, the body is not checked.

## Matching a body

- An object matches when every expected key matches the actual value. Keys the case does not mention may be present, which keeps cases short.
- An array matches when it has the same length and each element matches, in order.
- Numbers, strings, booleans and null match by equality.
- A string that starts with `$` is a matcher:

| Matcher | Matches |
|---|---|
| `$any` | any value, null included, as long as the key is present |
| `$int` | an integer |
| `$timestamp` | a date-time string as PostgreSQL returns it, `2026-09-13 04:35:38.784`, or with `T` and a UTC offset |
| `$absent` | the key is not present, as for a hidden column |

- A literal string that starts with `$` is written with `$$`: `"$$5"` matches `"$5"`.
- A `body` of `"$absent"` means the response has no body, as for a 204.

Each mismatch names the JSON pointer where it happened, so a failing case says exactly what differed.
