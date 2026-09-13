/**
 * Schema IR: the typed model of schema.dbml that every generator reads.
 *
 * packages/dbml builds it with its own DBML parser (parser.ts, D21), so nothing past this
 * package ever sees DBML-specific shapes. Names are kept verbatim (snake_case).
 */

export type ColumnType =
  | { kind: 'smallint' | 'integer' | 'bigint' }
  | { kind: 'real' | 'double' }
  | { kind: 'numeric'; precision?: number; scale?: number }
  | { kind: 'varchar' | 'char'; length?: number }
  | { kind: 'text' | 'boolean' | 'uuid' | 'json' | 'jsonb' | 'date' | 'time' }
  | { kind: 'timestamp'; withTimezone: boolean }
  | { kind: 'enum'; name: string }
  | { kind: 'array'; of: ColumnType };

export type DefaultValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'expression'; sql: string };

export type RefAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

/** 1-based position in schema.dbml, for error messages. */
export interface SourceLocation {
  line: number;
  column: number;
}

export interface ColumnIR {
  name: string;
  type: ColumnType;
  nullable: boolean;
  /** Auto-increment identity (DBML `increment`). */
  increment: boolean;
  unique: boolean;
  default?: DefaultValue;
  note?: string;
  loc?: SourceLocation;
}

export interface IndexIR {
  name?: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyIR {
  columns: string[];
  references: { table: string; columns: string[] };
  onDelete?: RefAction;
  onUpdate?: RefAction;
}

export interface TableIR {
  name: string;
  note?: string;
  columns: ColumnIR[];
  /** Primary key column names. Composite keys are rejected by validation (P2.4). */
  primaryKey: string[];
  indexes: IndexIR[];
  foreignKeys: ForeignKeyIR[];
  loc?: SourceLocation;
}

export interface EnumIR {
  name: string;
  values: string[];
  loc?: SourceLocation;
}

export interface SchemaIR {
  tables: TableIR[];
  enums: EnumIR[];
}

export interface TableConventions {
  /** Columns the framework fills: `createdAt` on insert, `updatedAt` on every write. */
  timestamps: { createdAt?: string; updatedAt?: string };
  /** Present when the table has a nullable `deleted_at` timestamp. */
  softDelete?: { column: string };
  /** Columns never accepted as request input. */
  generated: string[];
}

const isTimestamp = (column: ColumnIR | undefined): column is ColumnIR =>
  column?.type.kind === 'timestamp';

/** Derives the blendx conventions for one table from its column names and types. */
export function deriveConventions(table: TableIR): TableConventions {
  const column = (name: string) => table.columns.find((c) => c.name === name);
  const createdAt = column('created_at');
  const updatedAt = column('updated_at');
  const deletedAt = column('deleted_at');

  const timestamps: TableConventions['timestamps'] = {};
  if (isTimestamp(createdAt)) timestamps.createdAt = createdAt.name;
  if (isTimestamp(updatedAt)) timestamps.updatedAt = updatedAt.name;
  const softDelete =
    isTimestamp(deletedAt) && deletedAt.nullable ? { column: deletedAt.name } : undefined;

  const singlePk = table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
  const framework = new Set(
    [timestamps.createdAt, timestamps.updatedAt, softDelete?.column].filter(Boolean),
  );
  const generated = table.columns
    .filter(
      (c) =>
        framework.has(c.name) ||
        (c.name === singlePk && (c.increment || c.default?.kind === 'expression')),
    )
    .map((c) => c.name);

  return softDelete ? { timestamps, softDelete, generated } : { timestamps, generated };
}
