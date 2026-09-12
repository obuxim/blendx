/**
 * P1.4 spike, kept as a regression test.
 *
 * Records how @dbml/core 10.1.1 models the DBML constructs blendx reads, so the
 * DBML to IR adapter (P2.2) is written against observed behavior instead of guesses.
 * The snapshots are the contract: a @dbml/core upgrade that changes them must be reviewed.
 */
import { describe, expect, test } from 'bun:test';
import { loadDbmlCore } from '@blendx/dbml';

const core = await loadDbmlCore();
const parse = (source: string) => core.Parser.parse(source, 'dbmlv2');
const fixture = (name: string) => Bun.file(`${import.meta.dir}/../fixtures/${name}`).text();

type Db = ReturnType<typeof parse>;
type Schema = Db['schemas'][number];
type Table = Schema['tables'][number];
type Field = Table['fields'][number];
type Index = Table['indexes'][number];
type Ref = Schema['refs'][number];

const projectField = (f: Field) => ({
  name: f.name,
  type: f.type,
  pk: f.pk,
  unique: f.unique,
  not_null: f.not_null,
  increment: f.increment,
  dbdefault: f.dbdefault,
  note: f.note,
  enum: f._enum?.name,
});

const projectIndex = (i: Index) => ({
  name: i.name,
  unique: i.unique,
  pk: i.pk,
  type: i.type,
  columns: i.columns.map((c) => ({ type: c.type, value: c.value })),
});

const projectRef = (r: Ref) => ({
  name: r.name,
  onDelete: r.onDelete,
  onUpdate: r.onUpdate,
  endpoints: r.endpoints.map((e) => ({
    schemaName: e.schemaName,
    tableName: e.tableName,
    fieldNames: e.fieldNames,
    relation: e.relation,
  })),
});

const projectTable = (t: Table) => ({
  name: t.name,
  note: t.note,
  fields: t.fields.map(projectField),
  indexes: t.indexes.map(projectIndex),
});

const project = (db: Db) =>
  db.schemas.map((schema) => ({
    schema: schema.name,
    tables: schema.tables.map(projectTable),
    refs: schema.refs.map(projectRef),
    enums: schema.enums.map((e) => ({
      name: e.name,
      values: e.values.map((v) => ({ name: v.name, note: v.note })),
    })),
  }));

describe('P1.4 @dbml/core 10.1.1 model', () => {
  test('addition fixture keeps the type names verbatim (double stays double)', async () => {
    const [schema] = project(parse(await fixture('addition.dbml')));
    const table = schema?.tables[0];
    expect(table?.name).toBe('addition_results');
    expect(table?.fields.map((f) => [f.name, f.type.type_name])).toEqual([
      ['id', 'int'],
      ['result', 'double'],
      ['created_at', 'timestamp'],
      ['updated_at', 'timestamp'],
      ['deleted_at', 'timestamp'],
    ]);
    expect(table?.fields[0]).toMatchObject({ pk: true, increment: true });
    expect(schema).toMatchSnapshot();
  });

  test('kitchen-sink fixture: fields, indexes, refs, enums, notes', async () => {
    expect(project(parse(await fixture('kitchen-sink.dbml')))).toMatchSnapshot();
  });

  test('syntax errors are CompilerError diagnostics with a line and column', () => {
    let caught: unknown;
    try {
      parse('Table broken {\n  id int [pk\n}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(core.CompilerError);
    const diags = (caught as InstanceType<typeof core.CompilerError>).diags;
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.map((d) => ({ message: d.message, start: d.location.start }))).toMatchSnapshot();
  });
});
