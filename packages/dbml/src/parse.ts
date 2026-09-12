import { loadDbmlCore } from './dbml-core.ts';
import type {
  ColumnIR,
  DefaultValue,
  EnumIR,
  ForeignKeyIR,
  IndexIR,
  RefAction,
  SchemaIR,
  SourceLocation,
  TableIR,
} from './ir.ts';
import { mapColumnType } from './types.ts';

type DbmlCore = Awaited<ReturnType<typeof loadDbmlCore>>;
type Database = ReturnType<DbmlCore['Parser']['parse']>;
type Schema = Database['schemas'][number];
type Table = Schema['tables'][number];
type Field = Table['fields'][number];
type Ref = Schema['refs'][number];
type Endpoint = Ref['endpoints'][number];
type Token = Table['token'];

export interface DbmlDiagnostic extends SourceLocation {
  message: string;
}

/** Every problem found in schema.dbml, each with its line and column. */
export class DbmlError extends Error {
  readonly filename: string;
  readonly diagnostics: DbmlDiagnostic[];

  constructor(filename: string, diagnostics: DbmlDiagnostic[]) {
    super(diagnostics.map((d) => `${filename}:${d.line}:${d.column} ${d.message}`).join('\n'));
    this.name = 'DbmlError';
    this.filename = filename;
    this.diagnostics = diagnostics;
  }
}

const REF_ACTIONS: ReadonlySet<string> = new Set<RefAction>([
  'cascade',
  'restrict',
  'set null',
  'set default',
  'no action',
]);

const loc = (token: { start: SourceLocation } | undefined): SourceLocation => ({
  line: token?.start.line ?? 1,
  column: token?.start.column ?? 1,
});

/** Parses schema.dbml into the schema IR. Throws DbmlError listing every problem. */
export async function parseDbml(source: string, filename = 'schema.dbml'): Promise<SchemaIR> {
  const { Parser, CompilerError } = await loadDbmlCore();
  let db: Database;
  try {
    db = Parser.parse(source, 'dbmlv2');
  } catch (error) {
    if (!(error instanceof CompilerError)) throw error;
    throw new DbmlError(
      filename,
      error.diags.map((d) => ({ message: d.message, ...loc(d.location) })),
    );
  }

  const problems: DbmlDiagnostic[] = [];
  const report = (message: string, token: Token | undefined) =>
    problems.push({ message, ...loc(token) });
  const ir = toIR(db, report);
  if (problems.length > 0) throw new DbmlError(filename, problems);
  return ir;
}

type Report = (message: string, token: Token | undefined) => void;

function toIR(db: Database, report: Report): SchemaIR {
  const tables: TableIR[] = [];
  const enums: EnumIR[] = [];
  for (const schema of db.schemas) {
    if (schema.name !== 'public') {
      if (schema.tables.length > 0 || schema.enums.length > 0) {
        report(
          `schema "${schema.name}" is not supported; blendx v1 uses the public schema only`,
          schema.tables[0]?.token,
        );
      }
      continue;
    }
    enums.push(...schema.enums.map((e) => ({ name: e.name, values: e.values.map((v) => v.name) })));
    const enumNames = new Set(schema.enums.map((e) => e.name));
    const foreignKeys = foreignKeysByTable(schema, report);
    for (const table of schema.tables) {
      tables.push(tableIR(table, enumNames, foreignKeys.get(table.name) ?? [], report));
    }
  }
  return { tables, enums };
}

function tableIR(
  table: Table,
  enumNames: ReadonlySet<string>,
  foreignKeys: ForeignKeyIR[],
  report: Report,
): TableIR {
  const primaryKey = [
    ...table.fields.filter((f) => f.pk).map((f) => f.name),
    ...table.indexes.filter((i) => i.pk).flatMap((i) => i.columns.map((c) => String(c.value))),
  ];

  const columns: ColumnIR[] = [];
  for (const field of table.fields) {
    const column = columnIR(field, enumNames, report);
    if (column)
      columns.push(primaryKey.includes(column.name) ? { ...column, nullable: false } : column);
  }

  const indexes: IndexIR[] = [];
  for (const index of table.indexes) {
    if (index.pk) continue;
    if (index.columns.some((c) => c.type !== 'column')) {
      report(`expression indexes are not supported (table ${table.name})`, index.token);
      continue;
    }
    indexes.push({
      ...(index.name ? { name: index.name } : {}),
      columns: index.columns.map((c) => String(c.value)),
      unique: Boolean(index.unique),
    });
  }

  return {
    name: table.name,
    ...(table.note ? { note: table.note } : {}),
    columns,
    primaryKey,
    indexes,
    foreignKeys,
    loc: loc(table.token),
  };
}

function columnIR(field: Field, enumNames: ReadonlySet<string>, report: Report) {
  const typeName = String(field.type?.type_name ?? '');
  const mapped = field._enum?.name
    ? { type: { kind: 'enum', name: field._enum.name } as const, increment: false }
    : mapColumnType(typeName, enumNames);
  if (!mapped) {
    report(
      `unsupported column type "${typeName}" for ${field.table.name}.${field.name}`,
      field.token,
    );
    return undefined;
  }
  const dbDefault = defaultValue(field, report);
  const column: ColumnIR = {
    name: field.name,
    type: mapped.type,
    nullable: !(field.not_null || field.pk),
    increment: Boolean(field.increment) || mapped.increment,
    unique: Boolean(field.unique),
    ...(dbDefault ? { default: dbDefault } : {}),
    ...(field.note ? { note: field.note } : {}),
    loc: loc(field.token),
  };
  return column;
}

function defaultValue(field: Field, report: Report): DefaultValue | undefined {
  const raw: unknown = field.dbdefault;
  if (raw === undefined || raw === null) return undefined;
  const { type, value } = raw as { type?: unknown; value?: unknown };
  if (value === null || String(value).toLowerCase() === 'null') {
    return { kind: 'literal', value: null };
  }
  switch (type) {
    case 'expression':
      return { kind: 'expression', sql: String(value) };
    case 'number':
      return { kind: 'literal', value: Number(value) };
    case 'string':
      return { kind: 'literal', value: String(value) };
    case 'boolean':
      return { kind: 'literal', value: String(value).toLowerCase() === 'true' };
    default:
      report(`unsupported default for ${field.table.name}.${field.name}`, field.token);
      return undefined;
  }
}

/**
 * Turns refs into foreign keys on the table that holds them: the many side of a
 * one-to-many, or the side that is not the primary key of a one-to-one.
 */
function foreignKeysByTable(schema: Schema, report: Report): Map<string, ForeignKeyIR[]> {
  const pkOf = (tableName: string) => {
    const table = schema.tables.find((t) => t.name === tableName);
    return [
      ...(table?.fields.filter((f) => f.pk).map((f) => f.name) ?? []),
      ...(table?.indexes
        .filter((i) => i.pk)
        .flatMap((i) => i.columns.map((c) => String(c.value))) ?? []),
    ];
  };
  const isPk = (e: Endpoint) => {
    const pk = pkOf(e.tableName);
    return pk.length === e.fieldNames.length && e.fieldNames.every((f) => pk.includes(f));
  };

  const byTable = new Map<string, ForeignKeyIR[]>();
  for (const ref of schema.refs) {
    const [a, b] = ref.endpoints;
    if (!a || !b) continue;
    let holder: Endpoint | undefined;
    if (a.relation === '*' && b.relation === '*') {
      report('many-to-many refs are not supported; add a join table', ref.token);
      continue;
    }
    if (a.relation === '*') holder = a;
    else if (b.relation === '*') holder = b;
    else if (isPk(a) !== isPk(b)) holder = isPk(a) ? b : a;
    if (!holder) {
      report('one-to-one ref between two primary keys is ambiguous; use > or <', ref.token);
      continue;
    }
    const target = holder === a ? b : a;
    const fk: ForeignKeyIR = {
      columns: [...holder.fieldNames],
      references: { table: target.tableName, columns: [...target.fieldNames] },
    };
    for (const [key, raw] of [
      ['onDelete', ref.onDelete],
      ['onUpdate', ref.onUpdate],
    ] as const) {
      if (raw === undefined || raw === null) continue;
      const action = String(raw).toLowerCase();
      if (!REF_ACTIONS.has(action)) {
        report(`unknown ${key} action "${String(raw)}"`, ref.token);
        continue;
      }
      fk[key] = action as RefAction;
    }
    byTable.set(holder.tableName, [...(byTable.get(holder.tableName) ?? []), fk]);
  }
  return byTable;
}
