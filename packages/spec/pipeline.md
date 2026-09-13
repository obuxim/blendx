# Pipeline

Every endpoint runs the same stages in the same order. A resource changes a stage only where it differs from the default; how the levels combine is in `cascade.md`.

| # | Stage | Receives | Returns | By default |
|---|---|---|---|---|
| 1 | authenticate | the request | the identity, or null | the app's `auth` function; without one, no identity |
| 2 | validate (`rules`) | the query (GET) or the JSON body | the parsed input | the derived rules (`derivation-rules.md`), strict |
| 3 | load | the parsed input and the path id | the record, a page, or nothing | a row by primary key, never a soft-deleted one (restore loads only those); for index, a filtered, sorted page, within the action's `scope` (docs/decisions.md D22) |
| 4 | authorize | the policy's decision, the identity, the record and the input | allowed or not | the resource's policy for the action |
| 5 | calculate | the default writes, the input and the record | the writes; for a collection action, the reply body | the input's writable columns |
| 6 | save | the writes and the record | the saved row | store inserts, update and custom member actions update, destroy soft-deletes or deletes, restore clears `deleted_at` |
| 7 | later | the saved row, the row as loaded, the input and the identity | nothing | nothing. Only actions that save have it: the engine writes an outbox entry for each level's hook in the transaction, and a worker runs the hook later, at least once (docs/decisions.md D27) |
| 8 | after | the saved row, the row as loaded, the input, the identity and the database | nothing | nothing. Only actions that save have it, and it runs once the write has committed (docs/decisions.md D26) |
| 9 | respond | the default reply, the public record and calculate's result | the reply | 201 for store, 204 for destroy, 200 otherwise; the page envelope for index; hidden columns removed |

Tests:
- [the addition example, end to end](../core/test/engine.test.ts)
- [show loads a row by primary key](../core/test/engine-load.test.ts)
- [a soft-deleted row is not found](../core/test/engine-load.test.ts)
- [restore loads only trashed rows](../core/test/engine-load.test.ts)
- [live rows sorted by primary key, with the page meta](../core/test/engine-load.test.ts)
- [store inserts, fills defaults and sets both timestamps](../core/test/engine-save.test.ts)
- [update writes the input and touches updated_at](../core/test/engine-save.test.ts)
- [destroy soft-deletes: 204, the row stays with deleted_at set, show no longer finds it](../core/test/engine-save.test.ts)
- [destroy deletes the row on a table without deleted_at](../core/test/engine-save.test.ts)
- [store answers 201 with the saved row and no hidden columns](../core/test/engine-respond.test.ts)
- [a collection action answers 200 with what calculate returned](../core/test/engine-respond.test.ts)
- [resolves the identity for every request and hands routes the database](../hono/test/server.test.ts)
- [scope (D22): only the rows in scope, and pages and totals count only those](../core/test/engine-load.test.ts)
- [scope: a missing value matches no row; an empty scope scopes nothing](../core/test/engine-load.test.ts)
- [scope: a load hook calling runDefault gets the scoped page](../core/test/engine-load.test.ts)
- [after runs once the write has committed, with the saved row, the loaded row and the input](../core/test/after.test.ts)
- [store has no loaded row, and the saved row keeps its hidden columns](../core/test/after.test.ts)
- [destroy: saved is the soft-deleted row, record the row before](../core/test/after.test.ts)
- [after runs before respond](../core/test/after.test.ts)
- [reads never run after: index, show and collection actions skip app and resource hooks](../core/test/after.test.ts)
- [a write leaves one outbox entry per level, with the hook's context as JSON](../core/test/later.test.ts)
- [store: the entry has no loaded row](../core/test/later.test.ts)
- [reads write no entry, even with app and resource later hooks](../core/test/later.test.ts)

## The order of failures

A request stops at the first stage that fails, so the statuses come in a fixed order:

1. 401: the action's policy needs an identity and the request has none. This is decided before the input is read.
2. 422: validation fails. Every invalid field is listed, not only the first.
3. 404: a member action's record does not exist, or its id cannot be a primary key.
4. 403: the policy, or an authorize hook, refuses.
5. 409, or 422: the database refuses the writes (`errors.md`).

A body that is not valid JSON never reaches the pipeline: the HTTP adapter answers it with 400.

Tests:
- [401 comes before validation when the policy needs an identity](../core/test/engine.test.ts)
- [422 lists each invalid field with a JSON pointer](../core/test/engine.test.ts)
- [404 when the record does not exist](../core/test/engine.test.ts)
- [403 when the policy refuses an identified request](../core/test/engine.test.ts)
- [malformed JSON is a 400 problem; an empty body is undefined](../hono/test/server.test.ts)

## Transactions

An action that saves (store, update, destroy, restore and custom member actions) runs load, authorize, calculate and save in one transaction. A member row is loaded `FOR UPDATE`, so calculate's read, change and write cannot race another request. A failure anywhere rolls back what the action wrote. The later hooks' outbox entries are written in that transaction too, so they exist only if the write commits. after and respond run after the commit, so a failing respond leaves the saved row, and a write that fails runs no after. Reads (index, show and collection actions) take no lock.

Tests:
- [a failing save rolls back what the action had already written](../core/test/engine-transaction.test.ts)
- [member mutations load their row FOR UPDATE; reads take no lock](../core/test/engine-transaction.test.ts)
- [respond runs after the commit: a failing respond leaves the saved row](../core/test/engine-transaction.test.ts)
- [a concurrent writer cannot lock the row while an update holds it](../core/test/engine-lock.pg.test.ts)
- [a write that fails runs no after](../core/test/after.test.ts)
- [a write that fails leaves no entry](../core/test/later.test.ts)
- [the entry is written in the transaction: without the outbox table, the write rolls back](../core/test/later.test.ts)

## after's failures

The write has committed before after runs, so what an after hook throws does not change the reply: the engine hands it to the server's `onError` (console.error when there is none), and the next level's hook still runs (docs/decisions.md D26). An effect is lost if the process stops between the commit and the hook.

Tests:
- [a failing after is reported, the other levels still run, and the reply stands](../core/test/after.test.ts)
- [without onError, a failing after goes to console.error](../core/test/after.test.ts)
- [an after hook's failure goes to the server's onError, and the reply stands](../hono/test/after.test.ts)

## calculate is pure

calculate is synchronous and receives only `prev`, `input` and `record`: no database, no request, no identity. It may return only writable columns of its table. Anything else fails loudly rather than being dropped, because it is a mistake in the code.

Tests:
- [calculate writing a generated or unknown column fails loudly instead of being dropped](../core/test/engine-save.test.ts)
- [a custom member action saves what calculate returns](../core/test/engine-save.test.ts)
