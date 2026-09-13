# schema.dbml

blendx reads `schema.dbml` with its own parser (D21). It accepts the part of DBML below; anything else is an error with its line and column. Validation then adds blendx's own rules, such as a primary key on every table and names that work in generated code.

## Tables

```dbml
Table orders as O [note: 'what an order is'] {
  id bigint [pk, increment]
  user_id int [not null, ref: > users.id]
  status order_status [not null, default: 'pending']

  indexes {
    created_at
    (user_id, status) [name: 'orders_user_status_idx']
  }

  Note: 'or here, in the body'
}
```

- A name is letters, digits and `_`, or quoted: `"order items"` parses, then fails validation because it is not an identifier. The only schema prefix accepted is `public.`.
- `as O` gives the table an alias that refs may use.
- Table settings: `note`, and `headercolor`, which is ignored. The body may hold a `Note: '...'` or `Note { '...' }`.
- Keywords and settings are case-insensitive. `//` and `/* */` are comments.

## Columns

A column is `name type [settings]`.

- Types: `smallint`, `int`, `bigint` (and `int2`, `int4`, `int8`, `integer`), the `serial` family (an increment), `real`, `double`, `"double precision"`, `numeric(p, s)` or `decimal`, `varchar(n)`, `char(n)`, `text`, `boolean`, `uuid`, `json`, `jsonb`, `date`, `time`, `timestamp`, `timestamptz`, an enum of the schema, and any of them as an array, `text[]`, with no space: in `text []` the bracket opens the settings, and an empty settings list is an error. A type of several words is quoted.
- Settings: `pk` or `primary key`, `increment`, `not null`, `null`, `unique`, `note: '...'`, `default: ...` and `ref: ...` (Refs, below).
- A default is a number (`1`, `-1`, `1.5`), a string (`'pending'`), a SQL expression in backticks (`` `now()` ``), `true`, `false` or `null`.
- Strings, `'...'` and `'''...'''` alike, take upstream DBML's backslash escapes: `\'` for a quote, `\\` for a backslash, `\n`, `\t`, `\r`, `\0`, `\b`, `\v`, `\f` and `\uHHHH` (four hex digits, or an error). `\ ` keeps its backslash; before any other character the backslash is dropped. A `'''` string may span lines, and a `\` at the end of a line joins the next one.
- A note, in either kind of string, is trimmed as upstream trims it (`normalizeNote`): after the escapes are read, its leading blank lines are dropped, then the common indentation of the rest. A trailing line break stays, and so does a `\r` from CRLF line endings. Any other string, such as a default, is kept as written.

## Indexes

Inside `indexes { }`, one per line: a column, or columns in parentheses, then optional settings: `pk` (a composite primary key), `unique`, `name: '...'`, `note` and `type`, which is ignored. An index on an expression in backticks is refused, as a primary key too.

## Enums

```dbml
Enum order_status {
  pending
  "in progress"
  paid [note: 'money received']
}
```

## Refs

Inline on a column (`ref: > users.id`), or standalone, one per `Ref:` or several in a `Ref name { }` block:

```dbml
Ref: orders.user_id > users.id [delete: cascade, update: no action]
Ref: memberships.(tenant_a, tenant_b) > tenants.(a, b)
```

- `>` is many-to-one, `<` one-to-many and `-` one-to-one. The foreign key goes on the many side, or on the side of a one-to-one that is not a primary key. `<>` (many-to-many) is refused: add a join table.
- `delete` and `update` take `cascade`, `restrict`, `set null`, `set default` or `no action`.
- A ref is the same relation from either side, with its column pairs in any order: `a.(x, y) > b.(p, q)` and `b.(q, p) < a.(y, x)` are one ref written twice.

## Ignored

`Project`, `TableGroup` and sticky `Note` blocks parse and are skipped.

## Errors

A syntax error stops at the first problem: `schema.dbml:3:1 expected "," or "]" but found "}"`. Past the syntax, every problem is listed at once, in source order: an unknown table or column in a ref or an index, a table, column, enum value or ref defined twice, an unsupported type, a schema other than `public`.

Tests:
- [comments, quoted names, and keywords in any case](../dbml/test/parser.test.ts)
- [column settings: primary key, null, a default of every kind, notes](../dbml/test/parser.test.ts)
- [types: arguments, arrays, and an enum by its schema-qualified name](../dbml/test/parser.test.ts)
- [refs: short and block forms, composite keys, aliases, and which side holds the key](../dbml/test/parser.test.ts)
- [table notes, from the settings or the body](../dbml/test/parser.test.ts)
- [a multi-line string takes backslash escapes, and a backslash ending a line joins the next](../dbml/test/parser.test.ts)
- [strings take the escapes upstream DBML takes](../dbml/test/parser.test.ts)
- [a multi-line string reads its escapes before its indentation is removed](../dbml/test/parser.test.ts)
- [a note is trimmed as upstream trims it; any other string is kept as written](../dbml/test/parser.test.ts)
- [Project, TableGroup and sticky notes are accepted and ignored](../dbml/test/parser.test.ts)
- [kitchen-sink fixture: types, defaults, keys, indexes, refs, enums](../dbml/test/parse.test.ts)
- [a syntax error names what was expected, where](../dbml/test/parser.test.ts)
- [every name must resolve, and be defined once](../dbml/test/parser.test.ts)
- [an index on an expression is refused, as a primary key too](../dbml/test/parser.test.ts)
- [another schema, many-to-many refs, ambiguous one-to-one refs and repeated refs are refused](../dbml/test/parser.test.ts)
- [a ref is the same written from either side, its column pairs in any order](../dbml/test/parser.test.ts)
- [reports every unsupported column at once, each with its location](../dbml/test/types.test.ts)
- [a table without a primary key is rejected](../dbml/test/validate.test.ts)
- [table and enum names must be free identifiers in generated code](../dbml/test/validate.test.ts)
