/**
 * The engine: runs one request through an endpoint's pipeline (docs/decisions.md D3):
 * authenticate, validate, load, authorize, calculate, save, after, respond. Every failure is
 * a Problem Details response; the order decides precedence (401, 422, 404, 403). save also
 * writes the later hooks' outbox entries (D27). after (D26) runs once a write has committed,
 * and what it throws is reported, not answered.
 */
import { and, asc, count, desc, eq, getColumns, isNotNull, isNull, sql } from 'drizzle-orm';
import type { RegisteredAuth } from './app.ts';
import type { EffectDefaults, ResolvedEndpoint } from './cascade.ts';
import { isDateText, isTimestampText } from './datetime.ts';
import type { EndpointDefinition } from './endpoints.ts';
import type { Db, Reply } from './hooks.ts';
import type { Model } from './model.ts';
import { enqueueLater } from './outbox.ts';
import {
  jsonPointer,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problem,
  validationProblem,
} from './problems.ts';
import type { IndexQuery } from './rules.ts';

export interface ExecuteRequest {
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  /** The parsed JSON body; undefined when the request has none. */
  body: unknown;
  /** The identity the app's auth function resolved, or null. */
  auth: RegisteredAuth | null;
}

export interface ExecuteDeps {
  db: Db;
  /** Base URI for problem types (defineApp problems.typeBase). */
  typeBase?: string;
  /** Gets what an after hook throws (D26); the reply stays as it is. console.error by default. */
  onError?: (error: unknown) => void;
}

export interface ExecuteResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Stops the pipeline; the engine turns it into its Problem Details response. */
export class HttpProblem extends Error {
  readonly problem: ProblemDetails;
  constructor(details: ProblemDetails) {
    super(details.detail ?? details.title);
    this.name = 'HttpProblem';
    this.problem = details;
  }
}

/** Actions that write: everything except index, show and collection actions. */
export const saves = (endpoint: Pick<EndpointDefinition, 'on' | 'action'>) =>
  endpoint.on === 'member' ? endpoint.action !== 'show' : endpoint.action === 'store';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Columns a write may set: every column except generated ones. */
export function writableColumns(model: Model): Set<string> {
  const generated = new Set(model.meta.generated);
  return new Set(Object.keys(getColumns(model.table)).filter((name) => !generated.has(name)));
}

/** The schema-default writes: the validated input's writable columns. */
export function defaultWrites(model: Model, input: unknown): Record<string, unknown> {
  if (!isObject(input)) return {};
  const writable = writableColumns(model);
  return Object.fromEntries(Object.entries(input).filter(([key]) => writable.has(key)));
}

/** calculate may only return writable columns of its model. A mistake is a 500, not a silent drop. */
export function assertWritable(
  model: Model,
  action: string,
  writes: unknown,
): Record<string, unknown> {
  if (!isObject(writes)) {
    throw new Error(`${model.name}.${action}: calculate must return an object of column values`);
  }
  const writable = writableColumns(model);
  const extra = Object.keys(writes).filter((key) => !writable.has(key));
  if (extra.length > 0) {
    throw new Error(
      `${model.name}.${action}: calculate returned ${extra.map((key) => `"${key}"`).join(', ')}, not writable columns`,
    );
  }
  return writes;
}

function publicRow(row: unknown, hidden: readonly string[]): unknown {
  if (!isObject(row) || hidden.length === 0) return row;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.includes(key)));
}

function publicPage(page: unknown, hidden: readonly string[]): unknown {
  if (!isObject(page) || !Array.isArray(page.data)) return page;
  return { ...page, data: page.data.map((row) => publicRow(row, hidden)) };
}

/** The schema-default reply, built from the already public record or page. */
function defaultReply(endpoint: EndpointDefinition, out: unknown, result: unknown): Reply {
  if (endpoint.on === 'collection' && !endpoint.builtin) return { status: 200, body: result };
  if (endpoint.action === 'destroy') return { status: 204, body: null };
  return { status: endpoint.action === 'store' ? 201 : 200, body: out };
}

interface DatabaseErrorFields {
  code?: string;
  constraint?: string;
  column?: string;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The Postgres error behind a failed query, wherever drizzle or the driver put it. The
 * SQLSTATE is in `code` for node-postgres and PGlite, and in `errno` for bun-sql, whose
 * `code` is its own name (D16).
 */
function databaseError(error: unknown): DatabaseErrorFields | undefined {
  for (let e: unknown = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const { code, errno, constraint, column } = e as DatabaseErrorFields & { errno?: unknown };
    const state = [code, errno].find(
      (value): value is string => typeof value === 'string' && SQLSTATE.test(value),
    );
    if (state) return { code: state, constraint, column };
  }
  return undefined;
}

/** What the engine saw of a request, to trace a date or time error back to its field. */
interface Seen {
  input: unknown;
  writes: unknown;
  fromQuery: boolean;
}

/** The date and time values PostgreSQL may have refused: those in none of the accepted forms. */
function unreadableDateTimes(model: Model, values: unknown): string[] {
  if (!isObject(values)) return [];
  const columns = getColumns(model.table);
  return Object.entries(values)
    .filter(([key, value]) => {
      if (typeof value !== 'string') return false;
      const type = columns[key]?.columnType;
      if (type === 'PgDateString') return !isDateText(value);
      if (type === 'PgTimestampString') return !isTimestampText(value);
      return false;
    })
    .map(([key]) => key);
}

/**
 * 22007 and 22008: PostgreSQL could not read a date or time, and names no column (D23). The
 * field is found among the values the engine saw; one it did not see gives no errors.
 */
function dateTimeProblem(model: Model, typeBase: string | undefined, seen: Seen): ProblemDetails {
  const fields = new Set([
    ...unreadableDateTimes(model, seen.input),
    ...unreadableDateTimes(model, seen.writes),
  ]);
  const detail = 'is not a date or time the database can read';
  const errors = [...fields].map((field) =>
    seen.fromQuery ? { parameter: field, detail } : { pointer: jsonPointer([field]), detail },
  );
  return problem(422, {
    typeBase,
    detail: 'A date or time is not valid.',
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Constraint violations as problems (D4, D11): 23505 unique is 409; 23503 foreign key is
 * 422, or 409 when a destroy is still referenced; 23502 not null, 22P02 invalid value and
 * 22001 too long are 422. Pointers come from the constraint's columns in the model meta.
 * 22007 and 22008, a date or time the database cannot read, are 422 too (D23). Other
 * database errors stay errors.
 */
function databaseProblem(
  error: unknown,
  endpoint: EndpointDefinition,
  typeBase: string | undefined,
  seen: Seen,
): ProblemDetails | undefined {
  const pg = databaseError(error);
  if (!pg) return undefined;
  if (pg.code === '22007' || pg.code === '22008') {
    return dateTimeProblem(endpoint.model, typeBase, seen);
  }
  const columns =
    (pg.constraint && endpoint.model.meta.constraints[pg.constraint]?.columns) ||
    (pg.column ? [pg.column] : []);
  const invalid = (detail: string) => {
    const errors = columns.map((column) => ({ pointer: jsonPointer([column]), detail }));
    return errors.length > 0 ? errors : undefined;
  };
  switch (pg.code) {
    case '23505':
      return problem(409, {
        typeBase,
        detail: 'A record with the same value already exists.',
        errors: invalid('is already taken'),
      });
    case '23503':
      return endpoint.action === 'destroy'
        ? problem(409, {
            typeBase,
            detail: `${endpoint.resource} is still referenced by other records.`,
          })
        : problem(422, {
            typeBase,
            detail: 'The request refers to a record that does not exist.',
            errors: invalid('refers to a record that does not exist'),
          });
    case '23502':
      return problem(422, {
        typeBase,
        detail: 'A required value is missing.',
        errors: invalid('is required'),
      });
    case '22P02':
      return problem(422, {
        typeBase,
        detail: 'A value is not valid for its column.',
        errors: invalid('is not a valid value'),
      });
    case '22001':
      return problem(422, {
        typeBase,
        detail: 'A value is too long for its column.',
        errors: invalid('is too long'),
      });
    default:
      return undefined;
  }
}

/** Runs one request through the endpoint's pipeline. */
export async function execute(
  endpoint: ResolvedEndpoint,
  request: ExecuteRequest,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const { typeBase } = deps;
  const { auth, params, query } = request;
  const fromQuery = endpoint.method === 'get';
  // Outside the try, so that a date or time error can be traced back to its field (D23).
  let input: unknown;
  let writes: unknown;
  try {
    // authenticate: an identity-requiring policy answers 401 before anything else runs
    if (endpoint.requiresAuth && (auth === null || auth === undefined)) {
      throw new HttpProblem(problem(401, { typeBase }));
    }

    // validate
    const parsed = endpoint.rules.safeParse(fromQuery ? query : (request.body ?? {}));
    if (!parsed.success) {
      throw new HttpProblem(
        validationProblem(parsed.error, { in: fromQuery ? 'query' : 'body', typeBase }),
      );
    }
    input = parsed.data;

    // load, authorize, calculate, save. A mutation runs them in one transaction with its
    // member row locked FOR UPDATE, so calculate's read-modify-write cannot race.
    const mutates = saves(endpoint);
    const stages = async (db: Db) => {
      const loads = endpoint.on === 'member' || endpoint.action === 'index';
      const lock = mutates && endpoint.on === 'member';
      let loaded: unknown;
      if (loads) {
        try {
          loaded = await endpoint.load({ db, params, query, input, auth, lock });
        } catch (error) {
          // An id that cannot be the primary key's type (e.g. /orders/abc) names no record.
          if (endpoint.on === 'member' && databaseError(error)?.code === '22P02') {
            throw new HttpProblem(
              problem(404, { typeBase, detail: `${endpoint.resource} not found` }),
            );
          }
          throw error;
        }
      }
      if (endpoint.on === 'member' && loaded === undefined) {
        throw new HttpProblem(problem(404, { typeBase, detail: `${endpoint.resource} not found` }));
      }
      const record = endpoint.on === 'member' ? loaded : undefined;

      if (!(await endpoint.authorize({ auth, record, input }))) {
        throw new HttpProblem(problem(403, { typeBase }));
      }

      const result = endpoint.calculate({
        prev: defaultWrites(endpoint.model, input),
        input,
        record,
      });
      writes = result;

      const saved = mutates
        ? await endpoint.save({
            tx: db,
            writes: assertWritable(endpoint.model, endpoint.action, result),
            record,
            auth,
          })
        : record;
      // later (D27): one outbox entry per level, in this transaction, so only if it commits
      if (mutates) await enqueueLater(db, endpoint, { saved, record, input, auth });
      return { loaded, record, result, saved };
    };
    const { loaded, record, result, saved } = mutates
      ? await deps.db.transaction((tx) => stages(tx as unknown as Db))
      : await stages(deps.db);

    // after, once the write has committed (D26): what it throws is reported, and the reply stands
    if (mutates) {
      await endpoint.after(
        { db: deps.db, saved, record, input, auth },
        deps.onError ?? ((error) => console.error(error)),
      );
    }

    // respond, after the commit
    const out =
      endpoint.action === 'index'
        ? publicPage(loaded, endpoint.hidden)
        : publicRow(saved, endpoint.hidden);
    const reply = endpoint.respond({
      prev: defaultReply(endpoint, out, result),
      record: out,
      result,
    });
    return { status: reply.status, body: reply.body, headers: { ...reply.headers } };
  } catch (error) {
    const details =
      error instanceof HttpProblem
        ? error.problem
        : databaseProblem(error, endpoint, typeBase, { input, writes, fromQuery });
    if (!details) throw error;
    return {
      status: details.status,
      body: details,
      headers: { 'content-type': PROBLEM_CONTENT_TYPE },
    };
  }
}

export interface DefaultEffectOptions {
  /** Rows per index page when the request does not say (the app's perPage). */
  perPage?: number;
}

/** Index query keys that are not column filters. */
const INDEX_CONTROLS = new Set(['page', 'per_page', 'sort', 'trashed']);

/**
 * The schema-level load and save for an endpoint.
 * Load: a member by primary key, never a soft-deleted one (restore loads only those), or
 * a filtered, sorted page for index.
 * Save: store inserts with both timestamps; update and custom member actions update and
 * touch updated_at (no query when there is nothing to write); destroy sets deleted_at, or
 * deletes on tables without it; restore clears deleted_at.
 */
export function defaultEffects(
  endpoint: EndpointDefinition,
  options: DefaultEffectOptions = {},
): EffectDefaults {
  const { model, action } = endpoint;
  const table = model.table as never;
  const columns = getColumns(model.table);
  const deletedAt = model.meta.softDelete ? columns[model.meta.softDelete] : undefined;
  const { createdAt, updatedAt } = model.meta.timestamps;
  const stamps = (keys: (string | null)[]) =>
    Object.fromEntries(keys.filter((key) => key !== null).map((key) => [key, sql`now()`]));
  const primaryKey = () => {
    const column = model.meta.primaryKey ? columns[model.meta.primaryKey] : undefined;
    if (!column) throw new Error(`${model.name} has no primary key`);
    return column;
  };

  /** Live rows by default; `only` for trashed rows; `with` for both. */
  const trashScope = (trashed: 'with' | 'only' | undefined) => {
    if (!deletedAt || trashed === 'with') return undefined;
    return trashed === 'only' ? isNotNull(deletedAt) : isNull(deletedAt);
  };

  async function loadMember(db: Db, id: string | undefined, lock: boolean): Promise<unknown> {
    const scope = trashScope(action === 'restore' ? 'only' : undefined);
    const select = db
      .select()
      .from(table)
      .where(and(eq(primaryKey(), id), scope))
      .limit(1);
    const rows: unknown[] = await (lock ? select.for('update') : select);
    return rows[0];
  }

  async function loadPage(db: Db, input: unknown, auth: unknown): Promise<unknown> {
    const query = (input ?? {}) as IndexQuery;
    const page = query.page ?? 1;
    const perPage = query.per_page ?? options.perPage ?? 25;
    const filters = Object.entries(query)
      .filter(([key, value]) => !INDEX_CONTROLS.has(key) && value !== undefined && columns[key])
      .map(([key, value]) => eq(columns[key] as never, value));
    // D22: the action's scope, one equality per column; a missing value matches no row.
    const scope = Object.entries(endpoint.hooks.scope?.({ auth }) ?? {}).map(([key, value]) => {
      const column = columns[key];
      if (!column) throw new Error(`${model.name}.${action}: scope names "${key}", not a column`);
      return value === undefined || value === null ? sql`false` : eq(column as never, value);
    });
    const where = and(...filters, ...scope, trashScope(query.trashed));
    const pk = primaryKey();
    const sort = query.sort ?? model.meta.primaryKey ?? '';
    const column = columns[sort.replace(/^-/, '')] ?? pk;
    const order = [
      sort.startsWith('-') ? desc(column) : asc(column),
      ...(column === pk ? [] : [asc(pk)]),
    ];

    const [data, totals] = await Promise.all([
      db
        .select()
        .from(table)
        .where(where)
        .orderBy(...order)
        .limit(perPage)
        .offset((page - 1) * perPage),
      db.select({ total: count() }).from(table).where(where),
    ]);
    const total = (totals as { total: number }[])[0]?.total ?? 0;
    return { data, meta: { page, per_page: perPage, total } };
  }

  async function saveRow(
    tx: Db,
    writes: Record<string, unknown>,
    record: unknown,
  ): Promise<unknown> {
    if (action === 'store') {
      const rows: unknown[] = await tx
        .insert(table)
        .values({ ...writes, ...stamps([createdAt, updatedAt]) } as never)
        .returning();
      return rows[0];
    }

    const key = model.meta.primaryKey;
    const id = isObject(record) && key ? record[key] : undefined;
    if (id === undefined) {
      throw new Error(`${model.name}.${action}: there is no loaded record to save`);
    }
    const where = eq(primaryKey(), id);

    if (action === 'destroy' && !deletedAt) {
      const rows: unknown[] = await tx.delete(table).where(where).returning();
      return rows[0];
    }

    const softDelete = model.meta.softDelete;
    const changes: Record<string, unknown> =
      action === 'destroy' && softDelete
        ? { [softDelete]: sql`now()` }
        : action === 'restore' && softDelete
          ? { [softDelete]: null }
          : writes;
    if (Object.keys(changes).length === 0) return record;

    const rows: unknown[] = await tx
      .update(table)
      .set({ ...changes, ...stamps([updatedAt]) } as never)
      .where(where)
      .returning();
    return rows[0];
  }

  return {
    load: ({ db, params, input, lock, auth }) =>
      action === 'index' ? loadPage(db, input, auth) : loadMember(db, params.id, lock === true),
    save: ({ tx, writes, record }) => saveRow(tx, writes, record),
  };
}
