# Errors

Every failure is an RFC 9457 Problem Details object, served as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "The request did not pass validation.",
  "errors": [
    { "pointer": "/total", "detail": "Invalid input: expected string, received undefined" },
    { "pointer": "/coupon", "detail": "is not an accepted field" }
  ]
}
```

- `type` is `about:blank`, or a URI under the app's `problems.typeBase` when it sets one.
- `title` is the status's standard reason phrase.
- `errors` lists what is wrong. In a body, each entry has a JSON `pointer` (RFC 6901); in a query, each entry names its `parameter`. Every entry has a `detail`, and every unknown key is listed.

Tests:
- [each status has its title, and the type is about:blank by default](../core/test/problems.test.ts)
- [a detail, and a type URI from the app type base](../core/test/problems.test.ts)
- [is served as application/problem+json](../core/test/problems.test.ts)
- [follows RFC 6901, escaping ~ and /](../core/test/problems.test.ts)
- [body: one error per field, each with a pointer; every unknown key listed](../core/test/problems.test.ts)
- [query: errors name the parameter instead of a pointer](../core/test/problems.test.ts)

## Statuses

| Status | When |
|---|---|
| 400 | The body is not valid JSON. |
| 401 | The action's policy needs an identity and the request has none. |
| 403 | The policy or an authorize hook refuses. |
| 404 | No route matches, or a member action's record does not exist (an id that cannot be a primary key included). |
| 409 | A unique value already exists (SQLSTATE 23505), or a destroy or purge hits a row that other rows still reference (23503). |
| 422 | The input is invalid; or the database refuses a value: a reference to a missing row (23503), a NOT NULL column left null (23502), a value its column cannot hold (22P02), a value too long (22001), a date or time it cannot read (22007, 22008). |
| 500 | Anything else. The message is not sent to the client. |

A database error is recognised by its SQLSTATE, whichever driver raised it: node-postgres and PGlite put it in `code`, bun-sql in `errno` (docs/decisions.md D16). Pointers come from the columns of the constraint the error names, which the generated model lists by name. A date or time error (22007, 22008) names no column, so the engine finds the field itself: the date and time values of the input and of calculate's writes that are in none of the forms blendx accepts (docs/decisions.md D23), as pointers in a body or parameters in a query. A value it did not see, such as one a save hook adds, gives a 422 without `errors`.

Tests:
- [22008: a hook writing an impossible date answers 422, pointing at the column](../core/test/engine-errors.test.ts)
- [22007: an unreadable date in an index filter answers 422, naming the parameter](../core/test/engine-errors.test.ts)
- [a date or time error in a value blendx did not see answers 422 without errors](../core/test/engine-errors.test.ts)
- [YYYY-MM-DD naming a real day](../core/test/datetime.test.ts)
- [the text form PostgreSQL replies with](../core/test/datetime.test.ts)
- [refuses impossible days and times, offsets PostgreSQL refuses, and other forms](../core/test/datetime.test.ts)
- [23505: a duplicate unique value answers 409, pointing at the column](../core/test/engine-errors.test.ts)
- [23503: a reference to a missing row answers 422, pointing at the foreign key](../core/test/engine-errors.test.ts)
- [23503 on destroy: a row other rows still reference answers 409 and stays](../core/test/engine-errors.test.ts)
- [23503 on purge: a row other rows still reference answers 409 and stays](../core/test/engine-errors.test.ts)
- [23502: a hook writing null into a NOT NULL column answers 422](../core/test/engine-errors.test.ts)
- [22001: a hook writing past varchar(n) answers 422](../core/test/engine-errors.test.ts)
- [an id that cannot be a primary key names no record: 404](../core/test/engine-errors.test.ts)
- [22P02 elsewhere, like a filter value outside an enum, answers 422](../core/test/engine-errors.test.ts)
- [a unique violation from bun-sql answers 409, pointing at the column](../core/test/engine-errors-bun-sql.test.ts)
- [an error with no SQLSTATE anywhere is not hidden](../core/test/engine-errors-bun-sql.test.ts)
- [an unknown route answers a 404 problem](../hono/test/server.test.ts)
- [an unexpected error answers a 500 problem without leaking its message](../hono/test/server.test.ts)

Every status above except 500 also has a case in the conformance suite: [`packages/conformance/cases/errors.json`](../conformance/cases/errors.json).
