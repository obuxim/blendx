# The schema

`schema.dbml` describes the tables in [DBML](https://dbml.dbdiagram.io/docs/). blendx reads it with its own parser, which accepts the part of DBML listed in [`packages/spec/dbml.md`](../../packages/spec/dbml.md); anything else is an error with its line and column. From it, `blendx generate` writes the Drizzle tables in `src/generated/schema.gen.ts`, and blendx derives every default: what each action accepts, how rows are loaded, what a reply holds.

The schema says what the data is. Who may see or change it, and which actions exist, is not in the schema: that is what [blends](blends.md) say.

## Names

Names are kept as written, so use snake_case: `user_id` is `user_id` in the database, in TypeScript and in JSON. Table and enum names must be identifiers that are free in generated code; `blendx generate` says which ones are not.

## Conventions

| Column | What blendx does with it |
|---|---|
| `id int [pk, increment]` | The primary key, filled by the database. `increment` makes it an identity column, never accepted as input. Every table needs a single-column primary key. |
| `created_at` | Set to `now()` on insert. Never input. |
| `updated_at` | Set to `now()` on insert and on every update. Never input. |
| `deleted_at timestamp`, nullable | Soft delete. Destroy sets it instead of deleting the row, index and show skip such rows, and the blend may list `a.restore()` and `a.purge()`, which deletes for good. |

These are the generated columns: a request cannot set them (it gets a 422), and a calculate hook that returns one fails.

## Types

| DBML | In JSON | Accepted as input by default |
|---|---|---|
| `smallint`, `int` (`integer`), `serial` | number | an integer the column holds (`int`: 32 bits) |
| `bigint`, `bigserial` | number | an integer |
| `real`, `double` | number | a number |
| `numeric(p, s)`, `decimal` | string: `"12.50"` | a string, so no precision is lost |
| `varchar(n)`, `char(n)`, `text` | string | a string of at most `n` characters |
| `boolean` | boolean | a boolean |
| `uuid` | string | a UUID |
| `date` | string: `"2026-09-01"` | `YYYY-MM-DD`, naming a real day |
| `timestamp`, `timestamptz` | string, as PostgreSQL writes it: `"2026-09-13 12:48:14.595"` | ISO 8601 (`2026-09-13T12:48:14Z`) or PostgreSQL's text form, naming a real day and time |
| `time` | string | a string |
| `json`, `jsonb` | any JSON value | any JSON value |
| an enum of the schema | string | one of the enum's values |
| any of these with `[]`, such as `text[]` | array | an array of that type |

Timestamps are not ISO 8601: they come back with a space and, for `timestamp`, no offset, exactly as PostgreSQL writes them. As input, a client may send a timestamp back in that form, or in ISO 8601. Anything else PostgreSQL would read, such as `yesterday` or `now`, is refused with a 422, so what an input means never depends on the database's settings. Index filters on date and timestamp columns take the same forms.

The full list of type spellings, and the settings each column takes, is in [`packages/spec/dbml.md`](../../packages/spec/dbml.md). The input rules have ids and tests: [`packages/spec/derivation-rules.md`](../../packages/spec/derivation-rules.md).

## Required, optional, null

For `store`:

- A `not null` column without a default is required.
- A column with a default is optional, and the database fills it when it is left out.
- A nullable column is optional, and accepts `null`.

For `update` every column is optional: a PATCH sends only what changes. Neither accepts keys that are not columns, nor generated columns.

## Keys, references and indexes

```dbml
Table expenses {
  id int [pk, increment]
  user_id int [not null, ref: > users.id]
  status expense_status [not null, default: 'draft']
  spent_on date [not null]

  indexes {
    status
    spent_on
  }
}
```

- `unique`: a value that already exists answers 409, with a pointer to the column.
- `ref` (a foreign key): a value that refers to no row answers 422, pointing at the column. Destroying a row that other rows still reference answers 409, unless the reference cascades (`ref: > users.id [delete: cascade]` in a standalone `Ref`, or a `delete:` setting).
- Every primary key, unique, foreign key and indexed column can filter and sort an index: `GET /expenses?user_id=1&status=draft&sort=-spent_on`. To make a column filterable, index it.

A many-to-many reference (`<>`) is refused: add a join table. Composite primary keys and schemas other than `public` are out of scope for now.

## Enums

```dbml
Enum expense_status {
  draft
  submitted
  approved
  rejected
}
```

An enum column accepts only its values. `schema.gen.ts` exports each enum under its name, so a rule can reuse the values: `z.enum(expense_category.enumValues)`.

## Changing the schema

1. Edit `schema.dbml`.
2. `bunx blendx generate`. If a blend refers to something that changed (a column in `hidden`, `pick` or `allow.owner`), `tsc` points at it.
3. `bunx blendx migrate generate --name add_review_note`, and read the SQL it wrote in `drizzle/<timestamp>_add_review_note/migration.sql`. When a column disappeared and another appeared, drizzle-kit asks whether it was renamed.
4. `bunx blendx migrate up`, or restart a server that migrates when it starts.

The migrations are generated: never edit them. To undo a change, change the schema back and generate the next migration.
