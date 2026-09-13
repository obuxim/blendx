/**
 * Parses schema.dbml into the schema IR. parser.ts reads the syntax (D21); this module
 * resolves names (aliases, refs, index columns), refuses what blendx v1 does not support, and
 * maps each column type. Every problem is reported at once, in source order.
 */
import { type DbmlDiagnostic, DbmlError } from './errors.ts';
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
import {
  type DbmlDocument,
  type DbmlEndpoint,
  type DbmlField,
  DbmlSyntaxError,
  type DbmlTable,
  parseDocument,
} from './parser.ts';
import { mapColumnType } from './types.ts';

const REF_ACTIONS: ReadonlySet<string> = new Set<RefAction>([
  'cascade',
  'restrict',
  'set null',
  'set default',
  'no action',
]);

type Report = (message: string, where: SourceLocation) => void;
type InPublic = (schema: string | undefined, where: SourceLocation) => boolean;

/** Parses schema.dbml into the schema IR. Throws DbmlError listing every problem. */
export async function parseDbml(source: string, filename = 'schema.dbml'): Promise<SchemaIR> {
  let document: DbmlDocument;
  try {
    document = parseDocument(source);
  } catch (error) {
    if (!(error instanceof DbmlSyntaxError)) throw error;
    throw new DbmlError(filename, [{ message: error.message, ...error.loc }]);
  }

  const problems: DbmlDiagnostic[] = [];
  const ir = toIR(document, (message, where) => problems.push({ message, ...where }));
  if (problems.length > 0) {
    throw new DbmlError(
      filename,
      problems.sort((a, b) => a.line - b.line || a.column - b.column),
    );
  }
  return ir;
}

function toIR(document: DbmlDocument, report: Report): SchemaIR {
  const otherSchemas = new Set<string>();
  const inPublic: InPublic = (schema, where) => {
    if (schema === undefined || schema === 'public') return true;
    if (!otherSchemas.has(schema)) {
      otherSchemas.add(schema);
      report(`schema "${schema}" is not supported; blendx v1 uses the public schema only`, where);
    }
    return false;
  };

  const enums: EnumIR[] = [];
  for (const block of document.enums) {
    if (!inPublic(block.schema, block.loc)) continue;
    if (enums.some((known) => known.name === block.name)) {
      report(`enum ${block.name} is defined twice`, block.loc);
      continue;
    }
    const values: string[] = [];
    for (const value of block.values) {
      if (values.includes(value.name)) {
        report(`enum ${block.name} has the value "${value.name}" twice`, value.loc);
      } else {
        values.push(value.name);
      }
    }
    enums.push({ name: block.name, values, loc: block.loc });
  }

  const tables = new Map<string, DbmlTable>();
  const aliases = new Map<string, string>();
  for (const table of document.tables) {
    if (!inPublic(table.schema, table.loc)) continue;
    if (tables.has(table.name)) {
      report(`table ${table.name} is defined twice`, table.loc);
      continue;
    }
    tables.set(table.name, table);
    if (table.alias) aliases.set(table.alias, table.name);
    checkNames(table, report);
  }

  const foreignKeys = foreignKeysByTable(document, tables, aliases, inPublic, report);
  const enumNames = new Set(enums.map((e) => e.name));
  return {
    tables: [...tables.values()].map((table) =>
      tableIR(table, enumNames, foreignKeys.get(table.name) ?? [], report),
    ),
    enums,
  };
}

/** Each column once, and indexes only on columns the table has. */
function checkNames(table: DbmlTable, report: Report) {
  const columns = new Set<string>();
  for (const field of table.fields) {
    if (columns.has(field.name)) {
      report(`column ${table.name}.${field.name} is defined twice`, field.loc);
    }
    columns.add(field.name);
  }
  for (const index of table.indexes) {
    for (const column of index.columns) {
      if (column.kind === 'column' && !columns.has(column.value)) {
        report(`index on ${table.name} names unknown column "${column.value}"`, column.loc);
      }
    }
  }
}

const primaryKeyOf = (table: DbmlTable) => [
  ...table.fields.filter((f) => f.pk).map((f) => f.name),
  ...table.indexes.filter((i) => i.pk).flatMap((i) => i.columns.map((c) => c.value)),
];

function tableIR(
  table: DbmlTable,
  enumNames: ReadonlySet<string>,
  foreignKeys: ForeignKeyIR[],
  report: Report,
): TableIR {
  const primaryKey = primaryKeyOf(table);

  const columns: ColumnIR[] = [];
  const seen = new Set<string>();
  for (const field of table.fields) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    const column = columnIR(table.name, field, enumNames, report);
    if (column)
      columns.push(primaryKey.includes(column.name) ? { ...column, nullable: false } : column);
  }

  const indexes: IndexIR[] = [];
  for (const index of table.indexes) {
    if (index.columns.some((c) => c.kind !== 'column')) {
      report(`expression indexes are not supported (table ${table.name})`, index.loc);
      continue;
    }
    if (index.pk) continue;
    indexes.push({
      ...(index.name ? { name: index.name } : {}),
      columns: index.columns.map((c) => c.value),
      unique: index.unique,
    });
  }

  return {
    name: table.name,
    ...(table.note ? { note: table.note } : {}),
    columns,
    primaryKey,
    indexes,
    foreignKeys,
    loc: table.loc,
  };
}

function columnIR(
  tableName: string,
  field: DbmlField,
  enumNames: ReadonlySet<string>,
  report: Report,
): ColumnIR | undefined {
  const mapped = mapColumnType(field.type, enumNames);
  if (!mapped) {
    report(`unsupported column type "${field.type}" for ${tableName}.${field.name}`, field.loc);
    return undefined;
  }
  const dbDefault = defaultValue(field);
  return {
    name: field.name,
    type: mapped.type,
    nullable: !(field.notNull || field.pk),
    increment: field.increment || mapped.increment,
    unique: field.unique,
    ...(dbDefault ? { default: dbDefault } : {}),
    ...(field.note ? { note: field.note } : {}),
    loc: field.loc,
  };
}

function defaultValue(field: DbmlField): DefaultValue | undefined {
  const value = field.default;
  switch (value?.kind) {
    case undefined:
      return undefined;
    case 'null':
      return { kind: 'literal', value: null };
    case 'expression':
      return { kind: 'expression', sql: value.value };
    case 'number':
      return { kind: 'literal', value: Number(value.value) };
    case 'string':
      return { kind: 'literal', value: value.value };
    case 'boolean':
      return { kind: 'literal', value: value.value === 'true' };
  }
}

interface End {
  table: DbmlTable;
  columns: string[];
}

/**
 * Turns refs into foreign keys on the table that holds them: the many side of a
 * one-to-many, or the side that is not the primary key of a one-to-one.
 */
function foreignKeysByTable(
  document: DbmlDocument,
  tables: ReadonlyMap<string, DbmlTable>,
  aliases: ReadonlyMap<string, string>,
  inPublic: InPublic,
  report: Report,
): Map<string, ForeignKeyIR[]> {
  const resolve = (endpoint: DbmlEndpoint): End | undefined => {
    if (!inPublic(endpoint.schema, endpoint.tableLoc)) return undefined;
    const table = tables.get(endpoint.table) ?? tables.get(aliases.get(endpoint.table) ?? '');
    if (!table) {
      report(`ref to unknown table ${endpoint.table}`, endpoint.tableLoc);
      return undefined;
    }
    let known = true;
    endpoint.columns.forEach((column, i) => {
      if (table.fields.some((field) => field.name === column)) return;
      report(
        `ref to unknown column ${table.name}.${column}`,
        endpoint.columnLocs[i] ?? endpoint.tableLoc,
      );
      known = false;
    });
    return known ? { table, columns: endpoint.columns } : undefined;
  };
  const shown = (end: End) =>
    `${end.table.name}.${end.columns.length === 1 ? end.columns[0] : `(${end.columns.join(', ')})`}`;
  const isPk = (end: End) => {
    const pk = primaryKeyOf(end.table);
    return pk.length === end.columns.length && end.columns.every((c) => pk.includes(c));
  };

  const byTable = new Map<string, ForeignKeyIR[]>();
  const written = new Set<string>();
  for (const ref of document.refs) {
    const from = resolve(ref.from);
    const to = resolve(ref.to);
    if (!from || !to) continue;
    if (from.columns.length !== to.columns.length) {
      report(
        `ref between ${shown(from)} and ${shown(to)} pairs ${from.columns.length} columns with ${to.columns.length}`,
        ref.loc,
      );
      continue;
    }
    const [first, second] = [shown(from), shown(to)].sort();
    const key = `${first} ${second}`;
    if (written.has(key)) {
      report(`a ref between ${first} and ${second} is defined twice`, ref.loc);
      continue;
    }
    written.add(key);

    const manyFrom = ref.relation === '>' || ref.relation === '<>';
    const manyTo = ref.relation === '<' || ref.relation === '<>';
    if (manyFrom && manyTo) {
      report('many-to-many refs are not supported; add a join table', ref.loc);
      continue;
    }
    let holder: End | undefined;
    if (manyFrom) holder = from;
    else if (manyTo) holder = to;
    else if (isPk(from) !== isPk(to)) holder = isPk(from) ? to : from;
    if (!holder) {
      report('one-to-one ref between two primary keys is ambiguous; use > or <', ref.loc);
      continue;
    }
    const target = holder === from ? to : from;
    const fk: ForeignKeyIR = {
      columns: [...holder.columns],
      references: { table: target.table.name, columns: [...target.columns] },
    };
    for (const [key, raw] of [
      ['onDelete', ref.onDelete],
      ['onUpdate', ref.onUpdate],
    ] as const) {
      if (raw === undefined) continue;
      const action = raw.toLowerCase().replace(/\s+/g, ' ');
      if (!REF_ACTIONS.has(action)) {
        report(`unknown ${key} action "${raw}"`, ref.loc);
        continue;
      }
      fk[key] = action as RefAction;
    }
    byTable.set(holder.table.name, [...(byTable.get(holder.table.name) ?? []), fk]);
  }
  return byTable;
}
