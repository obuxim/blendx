# Derivation rules

How blendx derives each action's default validation rules from the schema. A resource only writes rules where an action differs from these defaults.

Every rule has an id. The test named with that id is the source of truth (`packages/core/test/derive-rules.test.ts`), and `packages/core/test/derivation-rules-doc.test.ts` fails if this table and the tests stop naming the same ids. Examples use the `shop` fixture (`packages/dbml/test/fixtures/shop.dbml`).

## store

| Id | Rule |
|---|---|
| DR-STORE-INSERT | `store` accepts the table's insert columns, as drizzle-orm/zod derives them from the generated schema. |
| DR-STORE-GENERATED | Generated columns are never input: the identity primary key, `created_at`, `updated_at` and `deleted_at`. |
| DR-STORE-STRICT | Unknown keys are rejected with 422, so a request cannot set columns it was not meant to (no mass assignment). |
| DR-STORE-REQUIRED | A NOT NULL column without a default is required. Nullable and defaulted columns are optional. |

## Column types

| Id | Rule |
|---|---|
| DR-NULLABLE | Nullable columns accept `null`. NOT NULL columns do not. |
| DR-VARCHAR-MAX | `varchar(n)` accepts at most n characters. |
| DR-INT32 | `integer` accepts 32-bit integers only. |
| DR-ENUM | An enum column accepts only its enum's values. |
| DR-NUMERIC-STRING | `numeric` takes a string, so no precision is lost on the way in or out. |
| DR-DATE-STRING | `date` and `timestamp` take strings. |
| DR-DATE-FORMAT | A `date` takes `YYYY-MM-DD` naming a real day. A `timestamp` takes ISO 8601 or the text form PostgreSQL replies with, naming a real day and time (docs/decisions.md D23). Index filters on such columns take the same. |
| DR-DOUBLE-UNBOUNDED | `double precision` takes any number (docs/decisions.md D13). |

## update

| Id | Rule |
|---|---|
| DR-UPDATE-PARTIAL | Every store rule becomes optional. Unknown keys are still rejected. |

## replace

`PUT /<table>/:id` replaces the public representation of a row (docs/decisions.md D34).

| Id | Rule |
|---|---|
| DR-REPLACE-BODY | `replace` takes the store rules without the key columns, which the path names: a NOT NULL column without a default is required, the rest may be left out, and unknown keys are rejected. A hidden column is optional even when store requires it: the client never saw it. |
| DR-REPLACE-RESET | A writable, visible column the body leaves out is reset: to its schema default when it has one, else to null. Key columns and hidden columns are left as they are, and a column `calculate` sets is not reset. |

## index

Query values arrive as strings and are parsed.

| Id | Rule |
|---|---|
| DR-INDEX-PAGE | `page` is a positive integer. |
| DR-INDEX-PER-PAGE | `per_page` is a positive integer, at most the app's `maxPerPage` (100 unless the app sets it). |
| DR-INDEX-FILTER | Primary key, unique, foreign key and indexed columns filter by exact value, for example `?user_id=42`. |
| DR-INDEX-SORT | The same columns sort: `?sort=created_at`, or `?sort=-created_at` for descending. |
| DR-INDEX-STRICT | Any other query parameter is rejected with 422. |
| DR-INDEX-HIDDEN | Hidden columns are neither filterable nor sortable. |
| DR-INDEX-TRASHED | `?trashed=with` or `?trashed=only` is accepted only when the resource enables it, and only on a soft-delete table. |

## Actions without a body

| Id | Rule |
|---|---|
| DR-MEMBER-EMPTY | `show`, `destroy`, `restore` and `purge` accept only an empty object, except show's `?include=` (DR-INCLUDE). |
| DR-INCLUDE | `index` and `show` take `?include=`, the comma-separated names of the blend's includes, belongs-to (docs/decisions.md D28) and has-many (D31) alike, when it declares any, or dotted paths through the includes of the included blends, `user.team` (D32); a path asks its prefixes; any other name or segment is rejected with 422. |
| DR-CUSTOM-EMPTY | Custom actions start from an empty object; their `rules` hook adds the fields they need. |

## Replies

| Id | Rule |
|---|---|
| DR-RECORD-PUBLIC | A reply holds a row's columns as the database returns them, minus the resource's hidden columns except those the action reveals (docs/decisions.md D24), with doubles unbounded. OpenAPI describes it as the table's component. |
