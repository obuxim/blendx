import { type DbmlDiagnostic, DbmlError } from './errors.ts';
import type { SchemaIR, SourceLocation, TableIR } from './ir.ts';
import { parseDbml } from './parse.ts';

/** Query parameters the index action reserves. A column with one of these names could not be filtered on. */
export const RESERVED_QUERY_PARAMS: readonly string[] = ['page', 'per_page', 'sort', 'trashed'];

/** schema.gen.ts exports every table and enum by name, next to these. */
const GENERATED_EXPORTS = new Set(['models']);

const JS_RESERVED = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks the rules blendx v1 adds on top of valid DBML. Returns every problem found. */
export function validateSchema(schema: SchemaIR): DbmlDiagnostic[] {
  const problems: DbmlDiagnostic[] = [];
  const report = (message: string, where: SourceLocation | undefined) =>
    problems.push({ message, line: where?.line ?? 1, column: where?.column ?? 1 });

  const exportedBy = new Map<string, string>();
  const claimExport = (kind: 'enum' | 'table', name: string, where: SourceLocation | undefined) => {
    if (!IDENTIFIER.test(name)) {
      report(
        `${kind} name "${name}" is not a valid identifier (letters, digits and _ only)`,
        where,
      );
    } else if (JS_RESERVED.has(name) || GENERATED_EXPORTS.has(name)) {
      report(`${kind} name "${name}" is reserved in generated code`, where);
    } else if (exportedBy.has(name)) {
      report(`${kind} "${name}" collides with the ${exportedBy.get(name)} of the same name`, where);
    } else {
      exportedBy.set(name, kind);
    }
  };

  for (const e of schema.enums) claimExport('enum', e.name, e.loc);
  for (const table of schema.tables) {
    claimExport('table', table.name, table.loc);
    validateTable(table, schema, report);
  }
  return problems;
}

function validateTable(
  table: TableIR,
  schema: SchemaIR,
  report: (message: string, where: SourceLocation | undefined) => void,
) {
  for (const column of table.columns) {
    if (!IDENTIFIER.test(column.name)) {
      report(
        `column ${table.name}."${column.name}" is not a valid identifier (letters, digits and _ only)`,
        column.loc,
      );
    } else if (RESERVED_QUERY_PARAMS.includes(column.name)) {
      report(
        `column ${table.name}.${column.name} uses the reserved query parameter name "${column.name}"`,
        column.loc,
      );
    }
  }

  // A composite key, `(order_id, line) [pk]` in the indexes, is served like any other (D33).
  if (table.primaryKey.length === 0) {
    report(`table ${table.name} has no primary key`, table.loc);
  }

  for (const fk of table.foreignKeys) {
    const where = table.columns.find((c) => c.name === fk.columns[0])?.loc ?? table.loc;
    const from = `${table.name}.${fk.columns.join(', ')}`;
    const to = `${fk.references.table}.${fk.references.columns.join(', ')}`;
    const target = schema.tables.find((t) => t.name === fk.references.table);
    if (!target) {
      report(`${from} references unknown table ${fk.references.table}`, where);
      continue;
    }
    if (!isKeyOf(target, fk.references.columns)) {
      report(`${from} references ${to}, which is neither a primary key nor unique`, where);
    }
  }
}

/** True when `columns` are exactly the primary key, a unique column, or a unique index. */
function isKeyOf(table: TableIR, columns: string[]): boolean {
  const same = (key: string[]) =>
    key.length === columns.length && key.every((name) => columns.includes(name));
  if (same(table.primaryKey)) return true;
  if (columns.length === 1 && table.columns.some((c) => c.name === columns[0] && c.unique)) {
    return true;
  }
  return table.indexes.some((index) => index.unique && same(index.columns));
}

/** Parses and validates schema.dbml. Throws one DbmlError with every problem found. */
export async function loadSchema(source: string, filename = 'schema.dbml'): Promise<SchemaIR> {
  const schema = await parseDbml(source, filename);
  const problems = validateSchema(schema);
  if (problems.length > 0) throw new DbmlError(filename, problems);
  return schema;
}
