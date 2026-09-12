/**
 * Default validation rules per action, derived from the generated model at runtime.
 * The only module that imports drizzle-zod (docs/decisions.md D6). Each rule has an id
 * (DR-...) shared with its test and its entry in packages/spec/derivation-rules.md.
 */
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';
import type { ActionDefinition } from './blend.ts';
import type { Model } from './model.ts';

export interface DeriveOptions {
  /** Hidden columns: never filterable or sortable on index. */
  hidden?: readonly string[];
  /** The largest per_page the index action accepts (the app's maxPerPage). */
  maxPerPage?: number;
  /** Accept ?trashed=with|only on a soft-delete table. Off unless the resource enables it. */
  trashed?: boolean;
}

/** DR-STORE-INSERT, DR-STORE-GENERATED, DR-STORE-STRICT, DR-DOUBLE-UNBOUNDED. */
function storeRules(model: Model): z.ZodObject {
  const columns = getTableColumns(model.table);
  // drizzle-zod bounds double precision to plus or minus 2^47 (D13). The callback form
  // keeps drizzle-zod's null and optional handling; a plain schema would drop it.
  const refine = Object.fromEntries(
    Object.entries(columns)
      .filter(([, column]) => column.columnType === 'PgDoublePrecision')
      .map(([name]) => [name, () => z.number()]),
  );
  const insert = createInsertSchema(
    model.table as never,
    refine as never,
  ) as unknown as z.ZodObject;
  // .omit() throws on keys the shape lacks, and identity columns are never in it.
  const generated = Object.fromEntries(
    model.meta.generated.filter((name) => name in insert.shape).map((name) => [name, true]),
  );
  return insert.omit(generated as never).strict();
}

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

const count = (max?: number) =>
  z
    .string()
    .regex(POSITIVE_INTEGER, 'must be a positive integer')
    .transform(Number)
    .pipe(max === undefined ? z.number().int() : z.number().int().max(max))
    .optional();

/**
 * DR-INDEX-PAGE, DR-INDEX-PER-PAGE, DR-INDEX-SORT, DR-INDEX-FILTER, DR-INDEX-HIDDEN,
 * DR-INDEX-TRASHED, DR-INDEX-STRICT. Values arrive as query strings.
 */
function indexRules(model: Model, options: DeriveOptions): z.ZodObject {
  const hidden = new Set(options.hidden ?? []);
  const keyed = new Set<string>([
    ...Object.values(model.meta.constraints).flatMap((constraint) => constraint.columns),
    ...getTableConfig(model.table).indexes.flatMap((index) =>
      index.config.columns.map((column) => (column as { name?: string }).name ?? ''),
    ),
  ]);
  const columns = Object.keys(getTableColumns(model.table)).filter(
    (name) => keyed.has(name) && !hidden.has(name),
  );

  const shape: Record<string, z.ZodType> = {
    page: count(),
    per_page: count(options.maxPerPage ?? 100),
  };
  const [first, ...rest] = columns;
  if (first !== undefined) {
    shape.sort = z.enum([first, ...rest, ...columns.map((column) => `-${column}`)]).optional();
  }
  for (const column of columns) shape[column] = z.string().optional();
  if (options.trashed && model.meta.softDelete !== null) {
    shape.trashed = z.enum(['with', 'only']).optional();
  }
  return z.object(shape).strict();
}

/**
 * The default rules of an action: store and update from the insert schema, index from
 * the query, and an empty strict object for everything without a body
 * (DR-MEMBER-EMPTY, DR-CUSTOM-EMPTY).
 */
export function defaultRules(
  model: Model,
  action: Pick<ActionDefinition, 'name' | 'builtin'>,
  options: DeriveOptions = {},
): z.ZodObject {
  if (action.builtin) {
    if (action.name === 'store') return storeRules(model);
    if (action.name === 'update') return storeRules(model).partial(); // DR-UPDATE-PARTIAL
    if (action.name === 'index') return indexRules(model, options);
  }
  return z.object({}).strict();
}
