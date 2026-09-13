/**
 * Default validation rules per action, and the public record a reply holds, derived from the
 * generated model at runtime. The only module that imports drizzle-orm/zod, formerly
 * drizzle-zod (docs/decisions.md D6, D20). Each rule has an id (DR-...) shared with its test
 * and its entry in packages/spec/derivation-rules.md.
 */
import { getColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/zod';
import { z } from 'zod';
import type { ActionDefinition } from './blend.ts';
import { isDateText, isTimestampText, TIMESTAMP_PATTERN } from './datetime.ts';
import type { Model } from './model.ts';

export interface DeriveOptions {
  /** Hidden columns: never filterable or sortable on index. */
  hidden?: readonly string[];
  /** The largest per_page the index action accepts (the app's maxPerPage). */
  maxPerPage?: number;
  /** Accept ?trashed=with|only on a soft-delete table. Off unless the resource enables it. */
  trashed?: boolean;
  /**
   * The paths `?include=` accepts on index and show: the blend's includes (D28), and behind each
   * the paths of its target's includes, `user.team` (D32).
   */
  includes?: readonly string[];
}

/**
 * drizzle-orm/zod bounds double precision to plus or minus 2^47 (D13). The callback form keeps
 * its null and optional handling; a plain schema would drop it.
 */
function unboundedDoubles(model: Model): Record<string, () => z.ZodNumber> {
  return Object.fromEntries(
    Object.entries(getColumns(model.table))
      .filter(([, column]) => column.columnType === 'PgDoublePrecision')
      .map(([name]) => [name, () => z.number()]),
  );
}

/**
 * DR-DATE-FORMAT (D23): a date names a real day as YYYY-MM-DD; a timestamp is ISO 8601 or
 * PostgreSQL's text form, naming a real day and time. Their formats describe them in OpenAPI
 * and the review: `date` is RFC 3339's full-date, `timestamp` blendx's name for the two forms.
 */
const dateRule = () =>
  z
    .string()
    .refine(isDateText, 'must be a date as YYYY-MM-DD, naming a real day')
    .meta({ format: 'date' });

const timestampRule = () =>
  z
    .string()
    .refine(
      isTimestampText,
      "must be a timestamp in ISO 8601 or PostgreSQL's text form, naming a real day and time",
    )
    .meta({ format: 'timestamp', pattern: TIMESTAMP_PATTERN });

/** The input rule of a date or timestamp column, or undefined for any other column. */
function dateTimeRule(column: { columnType: string }): (() => z.ZodType) | undefined {
  if (column.columnType === 'PgDateString') return dateRule;
  if (column.columnType === 'PgTimestampString') return timestampRule;
  return undefined;
}

/** Input rules that replace drizzle-orm/zod's: unbounded doubles and checked dates. */
function inputColumnRules(model: Model): Record<string, () => z.ZodType> {
  const dateTimes = Object.entries(getColumns(model.table)).flatMap(([name, column]) => {
    const rule = dateTimeRule(column);
    return rule ? [[name, rule] as const] : [];
  });
  return { ...unboundedDoubles(model), ...Object.fromEntries(dateTimes) };
}

/** DR-STORE-INSERT, DR-STORE-GENERATED, DR-STORE-STRICT, DR-DOUBLE-UNBOUNDED, DR-DATE-FORMAT. */
function storeRules(model: Model): z.ZodObject {
  const insert = createInsertSchema(
    model.table as never,
    inputColumnRules(model) as never,
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
 * DR-INDEX-TRASHED, DR-INDEX-STRICT, DR-DATE-FORMAT. Values arrive as query strings.
 */
/**
 * DR-INCLUDE: `?include=user,order`, comma-separated names of the blend's includes, parsed into
 * a list without repeats (D28). A dotted path follows the includes of the included blends, and
 * asks its prefixes: `user.team` gives `user` then `user.team` (D32). Any other name is refused.
 */
function includeRule(paths: readonly string[]): z.ZodType {
  return z
    .string()
    .transform((value, context) => {
      const asked = value
        .split(',')
        .map((path) => path.trim())
        .filter(Boolean);
      const unknown = asked.filter((path) => !paths.includes(path));
      if (unknown.length > 0) {
        context.addIssue({
          code: 'custom',
          message: `not an include: ${unknown.join(', ')} (one of ${paths.join(', ')})`,
        });
        return z.NEVER;
      }
      const withPrefixes: string[] = [];
      for (const path of asked) {
        const segments = path.split('.');
        for (let depth = 1; depth <= segments.length; depth++) {
          const prefix = segments.slice(0, depth).join('.');
          if (!withPrefixes.includes(prefix)) withPrefixes.push(prefix);
        }
      }
      return withPrefixes;
    })
    .optional()
    .describe(`comma-separated, of: ${paths.join(', ')}`);
}

function indexRules(model: Model, options: DeriveOptions): z.ZodObject {
  const hidden = new Set(options.hidden ?? []);
  const keyed = new Set<string>([
    ...Object.values(model.meta.constraints).flatMap((constraint) => constraint.columns),
    ...getTableConfig(model.table).indexes.flatMap((index) =>
      index.config.columns.map((column) => (column as { name?: string }).name ?? ''),
    ),
  ]);
  const all = getColumns(model.table);
  const columns = Object.keys(all).filter((name) => keyed.has(name) && !hidden.has(name));

  const shape: Record<string, z.ZodType> = {
    page: count(),
    per_page: count(options.maxPerPage ?? 100),
  };
  const [first, ...rest] = columns;
  if (first !== undefined) {
    shape.sort = z.enum([first, ...rest, ...columns.map((column) => `-${column}`)]).optional();
  }
  for (const column of columns) {
    const definition = all[column];
    const rule = definition ? dateTimeRule(definition) : undefined;
    shape[column] = (rule ? rule() : z.string()).optional();
  }
  if (options.trashed && model.meta.softDelete !== null) {
    shape.trashed = z.enum(['with', 'only']).optional();
  }
  if (options.includes?.length) shape.include = includeRule(options.includes);
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
    // DR-INCLUDE: show takes ?include= when the blend declares includes (D28).
    if (action.name === 'show' && options.includes?.length) {
      return z.object({ include: includeRule(options.includes) }).strict();
    }
  }
  return z.object({}).strict();
}

/**
 * DR-RECORD-PUBLIC: what a reply holds for one row. Every column as the database returns
 * it, minus the resource's hidden columns, with doubles unbounded as in DR-DOUBLE-UNBOUNDED.
 */
export function recordSchema(model: Model, hidden: readonly string[] = []): z.ZodObject {
  const select = createSelectSchema(
    model.table as never,
    unboundedDoubles(model) as never,
  ) as unknown as z.ZodObject;
  const omit = Object.fromEntries(
    hidden.filter((name) => name in select.shape).map((name) => [name, true]),
  );
  return select.omit(omit as never);
}
