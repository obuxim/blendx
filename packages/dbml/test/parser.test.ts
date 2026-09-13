/**
 * P13.2: blendx parses DBML itself (D21). parse.test.ts covers the fixtures; these cover the
 * rest of the syntax blendx accepts, and the errors, each with its line and column.
 */
import { describe, expect, test } from 'bun:test';
import { DbmlError, parseDbml, type SchemaIR } from '@blendx/dbml';

const problems = (source: string) =>
  parseDbml(source).then(
    () => [],
    (error: unknown) => {
      if (!(error instanceof DbmlError)) throw error;
      return error.diagnostics;
    },
  );

const tableNamed = (schema: SchemaIR, name: string) => {
  const table = schema.tables.find((t) => t.name === name);
  if (!table) throw new Error(`no table ${name}`);
  return table;
};

const columnNamed = (schema: SchemaIR, tableName: string, name: string) =>
  tableNamed(schema, tableName).columns.find((c) => c.name === name);

describe('the DBML blendx accepts', () => {
  test('comments, quoted names, and keywords in any case', async () => {
    const schema = await parseDbml(
      [
        '// a line comment',
        '/* a block',
        '   comment */',
        'TABLE "users" {',
        '  "id" INT [PK, INCREMENT] // after a column',
        '  ratio "double precision" [NOT NULL]',
        '}',
      ].join('\n'),
    );
    expect(schema.tables.map((t) => t.name)).toEqual(['users']);
    expect(columnNamed(schema, 'users', 'id')).toMatchObject({
      type: { kind: 'integer' },
      nullable: false,
      increment: true,
      loc: { line: 5, column: 3 },
    });
    expect(columnNamed(schema, 'users', 'ratio')).toMatchObject({
      type: { kind: 'double' },
      nullable: false,
    });
  });

  test('column settings: primary key, null, a default of every kind, notes', async () => {
    const schema = await parseDbml(
      [
        'Table t {',
        '  id int [primary key]',
        '  a int [null, default: -1]',
        '  b numeric(5, 2) [default: 1.5]',
        "  c text [default: 'it\\'s']",
        '  d boolean [default: false]',
        '  e text [default: null]',
        '  f timestamp [default: `now()`]',
        "  g text [note: 'a note']",
        '}',
      ].join('\n'),
    );
    const column = (name: string) => columnNamed(schema, 't', name);
    expect(column('id')).toMatchObject({ nullable: false, increment: false });
    expect(tableNamed(schema, 't').primaryKey).toEqual(['id']);
    expect(column('a')).toMatchObject({ nullable: true, default: { kind: 'literal', value: -1 } });
    expect(column('b')).toMatchObject({
      type: { kind: 'numeric', precision: 5, scale: 2 },
      default: { kind: 'literal', value: 1.5 },
    });
    expect(column('c')?.default).toEqual({ kind: 'literal', value: "it's" });
    expect(column('d')?.default).toEqual({ kind: 'literal', value: false });
    expect(column('e')?.default).toEqual({ kind: 'literal', value: null });
    expect(column('f')?.default).toEqual({ kind: 'expression', sql: 'now()' });
    expect(column('g')?.note).toBe('a note');
  });

  test('types: arguments, arrays, and an enum by its schema-qualified name', async () => {
    const schema = await parseDbml(
      [
        'Enum public.mood {',
        '  happy',
        '  "so so"',
        '}',
        'Table t {',
        '  id int [pk]',
        '  m public.mood',
        '  ms mood[]',
        '  v varchar(20)[]',
        '  n int[] [not null]',
        '  ts timestamp(3)',
        '}',
      ].join('\n'),
    );
    expect(schema.enums).toEqual([
      { name: 'mood', values: ['happy', 'so so'], loc: { line: 1, column: 1 } },
    ]);
    const type = (name: string) => columnNamed(schema, 't', name)?.type;
    expect(type('m')).toEqual({ kind: 'enum', name: 'mood' });
    expect(type('ms')).toEqual({ kind: 'array', of: { kind: 'enum', name: 'mood' } });
    expect(type('v')).toEqual({ kind: 'array', of: { kind: 'varchar', length: 20 } });
    expect(type('n')).toEqual({ kind: 'array', of: { kind: 'integer' } });
    expect(columnNamed(schema, 't', 'n')?.nullable).toBe(false);
    expect(type('ts')).toEqual({ kind: 'timestamp', withTimezone: false });
  });

  test('refs: short and block forms, composite keys, aliases, and which side holds the key', async () => {
    const schema = await parseDbml(
      [
        'Table users as U {',
        '  id int [pk]',
        '}',
        'Table posts {',
        '  id int [pk]',
        '  author_id int',
        '  editor_id int',
        '}',
        'Table tenants {',
        '  a int',
        '  b int',
        '  indexes {',
        '    (a, b) [pk]',
        '  }',
        '}',
        'Table memberships {',
        '  id int [pk]',
        '  tenant_a int',
        '  tenant_b int',
        '}',
        'Table profiles {',
        '  id int [pk]',
        '  user_id int [unique]',
        '}',
        'Ref: posts.author_id > U.id [delete: set null]',
        'Ref post_editor {',
        '  U.id < posts.editor_id [update: cascade]',
        '}',
        'Ref: memberships.(tenant_a, tenant_b) > tenants.(a, b)',
        'Ref: profiles.user_id - U.id',
      ].join('\n'),
    );
    expect(tableNamed(schema, 'posts').foreignKeys).toEqual([
      {
        columns: ['author_id'],
        references: { table: 'users', columns: ['id'] },
        onDelete: 'set null',
      },
      {
        columns: ['editor_id'],
        references: { table: 'users', columns: ['id'] },
        onUpdate: 'cascade',
      },
    ]);
    expect(tableNamed(schema, 'memberships').foreignKeys).toEqual([
      { columns: ['tenant_a', 'tenant_b'], references: { table: 'tenants', columns: ['a', 'b'] } },
    ]);
    expect(tableNamed(schema, 'profiles').foreignKeys).toEqual([
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
    ]);
    expect(tableNamed(schema, 'tenants').primaryKey).toEqual(['a', 'b']);
  });

  test('table notes, from the settings or the body', async () => {
    const schema = await parseDbml(
      [
        "Table a [headercolor: #3498DB, note: 'from the settings'] {",
        '  id int [pk]',
        '}',
        'Table b {',
        '  id int [pk]',
        '  Note {',
        "    'from the body'",
        '  }',
        '}',
      ].join('\n'),
    );
    expect(tableNamed(schema, 'a').note).toBe('from the settings');
    expect(tableNamed(schema, 'b').note).toBe('from the body');
  });

  test('Project, TableGroup and sticky notes are accepted and ignored', async () => {
    const schema = await parseDbml(
      [
        'Project shop {',
        "  database_type: 'PostgreSQL'",
        "  Note: 'The shop'",
        '}',
        'Table a {',
        '  id int [pk]',
        '}',
        'TableGroup core {',
        '  a',
        '}',
        'Note overview {',
        "  'Read me first'",
        '}',
      ].join('\n'),
    );
    expect(schema.tables.map((t) => t.name)).toEqual(['a']);
  });
});

describe('errors', () => {
  test('a syntax error names what was expected, where', async () => {
    const cases: [string, { message: string; line: number; column: number }][] = [
      [
        'Table t {\n  id int [pk]\n',
        { message: 'expected a column or "}" but found the end of the file', line: 3, column: 1 },
      ],
      [
        "Table t {\n  id int [pk, note: 'open\n}",
        { message: 'unterminated string', line: 2, column: 21 },
      ],
      [
        'Tabel t {\n}',
        {
          message: 'expected Table, Enum, Ref, Project, TableGroup or Note but found "Tabel"',
          line: 1,
          column: 1,
        },
      ],
      [
        'Table t {\n  id int [pk, size: 3]\n}',
        { message: 'unknown column setting "size"', line: 2, column: 15 },
      ],
      [
        'Table t {\n  id int [pk]\n  @x int\n}',
        { message: 'unexpected character "@"', line: 3, column: 3 },
      ],
      [
        'Table t {\n  id int [pk]\n  a int []\n}',
        { message: 'expected a setting but found "]"', line: 3, column: 10 },
      ],
      [
        'Table t {\n  id int [pk]\n  a int [ ]\n}',
        { message: 'expected a setting but found "]"', line: 3, column: 11 },
      ],
    ];
    for (const [source, problem] of cases) {
      expect(await problems(source)).toEqual([problem]);
    }
  });

  test('every name must resolve, and be defined once', async () => {
    const source = [
      'Table users {',
      '  id int [pk]',
      '  id text',
      '}',
      'Table users {',
      '  id int [pk]',
      '}',
      'Enum e {',
      '  a',
      '  b',
      '  a',
      '}',
      'Table posts {',
      '  id int [pk, ref: > users.uid]',
      '  indexes {',
      '    missing',
      '  }',
      '}',
      'Ref: posts.id > ghosts.id',
    ].join('\n');
    expect(await problems(source)).toEqual([
      { message: 'column users.id is defined twice', line: 3, column: 3 },
      { message: 'table users is defined twice', line: 5, column: 1 },
      { message: 'enum e has the value "a" twice', line: 11, column: 3 },
      { message: 'ref to unknown column users.uid', line: 14, column: 28 },
      { message: 'index on posts names unknown column "missing"', line: 16, column: 5 },
      { message: 'ref to unknown table ghosts', line: 19, column: 17 },
    ]);
  });

  test('an index on an expression is refused, as a primary key too', async () => {
    const source = [
      'Table t {',
      '  id int',
      '  name text',
      '  indexes {',
      '    (`lower(name)`) [unique]',
      '    (`lower(id)`) [pk]',
      '  }',
      '}',
    ].join('\n');
    expect(await problems(source)).toEqual([
      { message: 'expression indexes are not supported (table t)', line: 5, column: 5 },
      { message: 'expression indexes are not supported (table t)', line: 6, column: 5 },
    ]);
  });

  test('another schema, many-to-many refs, ambiguous one-to-one refs and repeated refs are refused', async () => {
    expect(await problems('Table auth.users {\n  id int [pk]\n}')).toEqual([
      {
        message: 'schema "auth" is not supported; blendx v1 uses the public schema only',
        line: 1,
        column: 1,
      },
    ]);
    const tables = ['a', 'b', 'c'].map((name) => `Table ${name} {\n  id int [pk]\n}\n`).join('');
    const refs = ['Ref: a.id <> b.id', 'Ref: a.id - c.id', 'Ref: b.id < c.id', 'Ref: c.id > b.id'];
    expect(await problems(`${tables}${refs.join('\n')}`)).toEqual([
      { message: 'many-to-many refs are not supported; add a join table', line: 10, column: 1 },
      {
        message: 'one-to-one ref between two primary keys is ambiguous; use > or <',
        line: 11,
        column: 1,
      },
      { message: 'a ref between b.id and c.id is defined twice', line: 13, column: 1 },
    ]);
  });
});
