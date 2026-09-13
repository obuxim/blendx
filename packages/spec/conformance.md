# Conformance

The conformance suite defines blendx's behaviour over HTTP, independent of any language: cases of requests and the responses they must get. Every runtime runs the same cases against the same fixture app and must pass all of them. The TypeScript types and matchers are in `packages/conformance/src`.

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
- `request` has a `method` (`GET`, `POST`, `PATCH`, `DELETE`), a `path`, and optional `headers` and JSON `body`. `{name}` in a path is replaced by a value captured earlier in the same case.
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
