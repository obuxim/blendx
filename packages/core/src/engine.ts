/**
 * The engine: runs one request through an endpoint's pipeline (docs/decisions.md D3):
 * authenticate, validate, load, authorize, calculate, save, after, respond. Every failure is
 * a Problem Details response; the order decides precedence (401, 422, 404, 403). save also
 * writes the later hooks' outbox entries (D27). after (D26) runs once a write has committed,
 * and what it throws is reported, not answered.
 */

import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getColumns,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import { alias, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import type { RegisteredAuth } from './app.ts';
import type { EffectDefaults, IncludedTarget, ResolvedEndpoint } from './cascade.ts';
import { isDateText, isTimestampText } from './datetime.ts';
import type { EndpointDefinition } from './endpoints.ts';
import type { Db, Reply } from './hooks.ts';
import type { Model } from './model.ts';
import { enqueueLater } from './outbox.ts';
import {
  isMemberPolicy,
  type MemberPathHop,
  type MemberPolicy,
  type ResolvedMemberRelated,
} from './policy.ts';
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

const readField = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

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

/**
 * What replace resets (D34): the writable columns the body may leave out, hidden and key
 * columns aside. One with a schema default goes back to it when the row is saved; a nullable
 * one without a default becomes null, which calculate already sees in prev.
 */
export function resetColumns(endpoint: Pick<EndpointDefinition, 'model' | 'hidden'>): {
  toNull: string[];
  toDefault: string[];
} {
  const { model, hidden } = endpoint;
  const columns = getColumns(model.table) as Record<
    string,
    { hasDefault?: boolean; notNull?: boolean } | undefined
  >;
  const skip = new Set([...hidden, ...model.meta.primaryKey]);
  const toNull: string[] = [];
  const toDefault: string[] = [];
  for (const name of writableColumns(model)) {
    const column = columns[name];
    if (!column || skip.has(name)) continue;
    if (column.hasDefault) toDefault.push(name);
    else if (!column.notNull) toNull.push(name);
  }
  return { toNull, toDefault };
}

/** calculate's default prev: the input's writable columns, and for replace the nulls it resets (D34). */
export function defaultPrev(
  endpoint: Pick<EndpointDefinition, 'model' | 'hidden' | 'action' | 'builtin'>,
  input: unknown,
): Record<string, unknown> {
  const writes = defaultWrites(endpoint.model, input);
  if (!endpoint.builtin || endpoint.action !== 'replace') return writes;
  for (const column of resetColumns(endpoint).toNull) {
    if (!(column in writes)) writes[column] = null;
  }
  return writes;
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

/** The paths `?include=` names, as the rules parsed them, each with its prefixes (D28, D32). */
const includesOf = (input: unknown): string[] =>
  isObject(input) && Array.isArray(input.include) ? (input.include as string[]) : [];

type Row = Record<string, unknown>;

/**
 * D36: an included target's rows are as visible as its show makes them, so a member policy's
 * EXISTS predicate scopes them too; the policy's check alone only asks for an identity.
 */
const memberScope = (db: Db, show: EndpointDefinition, auth: unknown): SQL | undefined =>
  isMemberPolicy(show.policy)
    ? memberPredicate(db, show.policy, show.model.table, auth)
    : undefined;

/**
 * One relation's rows, by key (D28): a single query for every key the rows hold, live rows
 * only, each through the target's show as GET /<table>/:id decides it; a refused row is null.
 * The rows come back raw: hidden columns leave once the level below has taken its keys (D32).
 */
async function includedRows(
  db: Db,
  include: IncludedTarget,
  rows: readonly Row[],
  auth: RegisteredAuth | null,
): Promise<Map<unknown, Row | null>> {
  const { show } = include;
  const { model } = show;
  const found = new Map<unknown, Row | null>();
  const keys = [...new Set(rows.map((row) => row[include.column]))].filter(
    (key) => key !== null && key !== undefined,
  );
  // A belongs-to points at one column, so its target's key is a single column.
  const [key] = model.meta.primaryKey;
  const columns = getColumns(model.table);
  const primaryKey = key ? columns[key] : undefined;
  if (keys.length === 0 || !key || !primaryKey) return found;
  const deletedAt = model.meta.softDelete ? columns[model.meta.softDelete] : undefined;
  const byKey = inArray(primaryKey, keys);
  const targets = (await db
    .select()
    .from(model.table as never)
    .where(
      and(byKey, deletedAt ? isNull(deletedAt) : undefined, memberScope(db, show, auth)),
    )) as Row[];
  for (const target of targets) {
    const allowed = await show.authorize({ auth, record: target, input: {} });
    found.set(target[key], allowed ? target : null);
  }
  return found;
}

/**
 * A has-many include's rows, by the parent key they point at (D31): one query for every
 * parent, numbered per parent in the include's order by a window function and cut at its
 * limit, live rows only. Each row goes through the target's show; a refused one is dropped.
 * The rows come back raw, as includedRows gives them.
 */
async function hasManyRows(
  db: Db,
  include: Extract<IncludedTarget, { kind: 'hasMany' }>,
  rows: readonly Row[],
  auth: RegisteredAuth | null,
): Promise<Map<unknown, Row[]>> {
  const { show, limit, sort } = include;
  const { model } = show;
  const found = new Map<unknown, Row[]>();
  const keys = [...new Set(rows.map((row) => row[include.key]))].filter(
    (key) => key !== null && key !== undefined,
  );
  const columns = getColumns(model.table);
  const foreignKey = columns[include.column];
  const orderBy = columns[sort.column];
  // The tiebreak: every key column, in the key's order (D33).
  const tiebreak = model.meta.primaryKey
    .map((name) => columns[name])
    .filter((column) => column !== undefined)
    .reduce((acc, column) => sql`${acc}, ${column}`, sql``);
  if (keys.length === 0 || !foreignKey || !orderBy) return found;
  const deletedAt = model.meta.softDelete ? columns[model.meta.softDelete] : undefined;
  const byKey = inArray(foreignKey, keys);
  const direction = sort.descending ? desc(orderBy) : asc(orderBy);
  const ranked = db
    .select({
      ...columns,
      rn: sql<number>`row_number() over (partition by ${foreignKey} order by ${direction}${tiebreak})`.as(
        'rn',
      ),
    })
    .from(model.table as never)
    .where(and(byKey, deletedAt ? isNull(deletedAt) : undefined, memberScope(db, show, auth)))
    .as('ranked');
  const targets = (await db
    .select()
    .from(ranked)
    .where(sql`${ranked.rn} <= ${limit}`)
    .orderBy(sql`${ranked.rn}`)) as Row[];
  for (const { rn: _rn, ...target } of targets) {
    const allowed = await show.authorize({ auth, record: target, input: {} });
    if (!allowed) continue;
    const parent = target[include.column];
    const list = found.get(parent) ?? [];
    list.push(target);
    found.set(parent, list);
  }
  return found;
}

/** Paths by their first segment, the rest behind it: `user` and `user.team` give `user: ['team']`. */
function groupPaths(paths: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const dot = path.indexOf('.');
    const name = dot === -1 ? path : path.slice(0, dot);
    const rest = groups.get(name) ?? [];
    if (dot !== -1) rest.push(path.slice(dot + 1));
    groups.set(name, rest);
  }
  return groups;
}

/**
 * One level of includes (D28, D31, D32): for each path's first segment, the relation's rows
 * are loaded in one query for every source row, and the rest of the path nests into them the
 * same way before their hidden columns leave. Each out row gets its value: a row or null, or an
 * array. The keys come from the raw rows, so a hidden foreign key still includes.
 */
async function nestLevel(
  db: Db,
  included: Readonly<Record<string, IncludedTarget>>,
  paths: readonly string[],
  sources: readonly Row[],
  outs: readonly unknown[],
  auth: RegisteredAuth | null,
): Promise<unknown[]> {
  const added: [name: string, values: unknown[]][] = [];
  for (const [name, below] of groupPaths(paths)) {
    const include = included[name];
    if (!include) {
      added.push([name, sources.map(() => null)]);
      continue;
    }
    const hidden = [...include.show.hidden, ...(include.show.revealed ?? [])];
    // The level's rows, raw and public, then the paths below nested into the public ones.
    const nested = async (raw: Row[]) => {
      const publics = raw.map((row) => publicRow(row, hidden));
      const filled = await nestLevel(db, include.show.included, below, raw, publics, auth);
      return new Map(raw.map((row, index) => [row, filled[index]]));
    };
    if (include.kind === 'hasMany') {
      const found = await hasManyRows(db, include, sources, auth);
      const rows = await nested([...found.values()].flat());
      added.push([
        name,
        sources.map((source) => (found.get(source[include.key]) ?? []).map((row) => rows.get(row))),
      ]);
    } else {
      const found = await includedRows(db, include, sources, auth);
      const rows = await nested([...found.values()].filter((row) => row !== null));
      added.push([
        name,
        sources.map((source) => {
          const row = found.get(source[include.column]);
          return row ? rows.get(row) : null;
        }),
      ]);
    }
  }
  return outs.map((out, index) =>
    isObject(out)
      ? { ...out, ...Object.fromEntries(added.map(([name, values]) => [name, values[index]])) }
      : out,
  );
}

/** The public record or page with each named path nested: a row or null, or an array. */
async function withIncludes(
  db: Db,
  endpoint: ResolvedEndpoint,
  paths: readonly string[],
  raw: unknown,
  out: unknown,
  auth: RegisteredAuth | null,
): Promise<unknown> {
  const page = isObject(raw) && Array.isArray(raw.data);
  const sources = (page ? (raw.data as unknown[]) : [raw]).map((row) => (isObject(row) ? row : {}));
  const outs = page && isObject(out) && Array.isArray(out.data) ? out.data : [out];
  const nested = await nestLevel(db, endpoint.included, paths, sources, outs, auth);
  return page && isObject(out) ? { ...out, data: nested } : nested[0];
}

/** Built-in actions that delete: destroy, and purge on a soft-delete table (D29). */
const deletes = (endpoint: Pick<EndpointDefinition, 'action' | 'builtin'>) =>
  endpoint.builtin && (endpoint.action === 'destroy' || endpoint.action === 'purge');

/** The schema-default reply, built from the already public record or page. */
function defaultReply(endpoint: EndpointDefinition, out: unknown, result: unknown): Reply {
  if (endpoint.on === 'collection' && !endpoint.builtin) return { status: 200, body: result };
  if (deletes(endpoint)) return { status: 204, body: null };
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
export function databaseError(error: unknown): DatabaseErrorFields | undefined {
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
 * 422, or 409 when a destroy or purge is still referenced; 23502 not null, 22P02 invalid value and
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
      return deletes(endpoint)
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
    if (
      endpoint.requiresAuth &&
      (auth === null ||
        auth === undefined ||
        (isMemberPolicy(endpoint.policy) &&
          (readField(auth, endpoint.policy.authKey) === undefined ||
            readField(auth, endpoint.policy.authKey) === null)))
    ) {
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
        prev: defaultPrev(endpoint, input),
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

    // respond, after the commit, with the rows ?include= names (D28)
    let out =
      endpoint.action === 'index'
        ? publicPage(loaded, endpoint.hidden)
        : publicRow(saved, endpoint.hidden);
    const names = includesOf(input);
    if (names.length > 0) {
      const raw = endpoint.action === 'index' ? loaded : saved;
      out = await withIncludes(deps.db, endpoint, names, raw, out, auth);
    }
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
const INDEX_CONTROLS = new Set(['page', 'per_page', 'sort', 'trashed', 'include']);

interface MembershipSelect {
  innerJoin(table: PgTable, on: SQL): MembershipSelect;
  where(condition: SQL | undefined): unknown;
}

/**
 * D36: correlate the resource row with a membership row through its resolved forward path.
 * Every path table gets an alias, so a self-reference never collides with the outer resource.
 */
function memberPredicate(db: Db, policy: MemberPolicy, resourceTable: PgTable, auth: unknown): SQL {
  const identity = readField(auth, policy.authKey);
  if (identity === undefined || identity === null) return sql`false`;
  const { path, root, membershipRoot } = policy;
  if (!path || !root || !membershipRoot) {
    throw new Error('member policy was not resolved by blend()');
  }
  const membership = alias(policy.through.model.table, '__blendx_membership');
  const pathTables = path.map((hop, index) => alias(hop.table, `__blendx_member_path_${index}`));
  const rootTable = pathTables[pathTables.length - 1];
  const membershipColumns = getColumns(membership);
  const membershipRootColumn = membershipColumns[membershipRoot.column];
  const member = membershipColumns[policy.through.member];
  if (!membershipRootColumn || !member) {
    throw new Error('member policy resolved to missing columns');
  }

  const conditions: SQL[] = [eq(member as never, identity)];
  let select = db.select({ one: sql`1` }).from(membership as never) as unknown as MembershipSelect;
  if (rootTable) {
    const rootKey = getColumns(rootTable)[membershipRoot.key];
    if (!rootKey) throw new Error('member policy root resolved to a missing column');
    select = select.innerJoin(rootTable, eq(membershipRootColumn as never, rootKey as never));
    for (let index = path.length - 1; index >= 1; index--) {
      const source = pathTables[index - 1];
      const target = pathTables[index];
      const hop = path[index];
      if (!source || !target || !hop) throw new Error('member policy path did not resolve');
      const sourceColumn = getColumns(source)[hop.column];
      const targetKey = getColumns(target)[hop.key];
      if (!sourceColumn || !targetKey)
        throw new Error('member policy path resolved to missing columns');
      select = select.innerJoin(source, eq(sourceColumn as never, targetKey as never));
    }
  } else {
    const resourceKey = getColumns(resourceTable)[membershipRoot.key];
    if (!resourceKey) throw new Error('member policy root resolved to a missing column');
    conditions.push(eq(membershipRootColumn as never, resourceKey as never));
  }

  const first = path[0];
  const firstTable = pathTables[0];
  if (first && firstTable) {
    const resourceColumn = getColumns(resourceTable)[first.column];
    const firstKey = getColumns(firstTable)[first.key];
    if (!resourceColumn || !firstKey)
      throw new Error('member policy path resolved to missing columns');
    conditions.push(eq(resourceColumn as never, firstKey as never));
  }
  return exists(select.where(and(...conditions)) as never);
}

const finalField = (writes: Record<string, unknown>, record: unknown, field: string): unknown =>
  Object.hasOwn(writes, field) ? writes[field] : readField(record, field);

async function rowAt(
  tx: Db,
  table: PgTable,
  key: string,
  value: unknown,
): Promise<Record<string, unknown> | undefined> {
  if (value === undefined || value === null) return undefined;
  const column = getColumns(table)[key];
  if (!column) throw new Error(`member policy key "${key}" did not resolve`);
  const rows: unknown[] = await tx
    .select()
    .from(table as never)
    .where(eq(column as never, value))
    .limit(1);
  const row = rows[0];
  return isObject(row) ? row : undefined;
}

/** Follow an already-resolved forward path, returning the root's membership key value. */
async function rootAt(
  tx: Db,
  table: PgTable,
  key: string,
  value: unknown,
  path: readonly MemberPathHop[],
  rootKey: string,
): Promise<unknown> {
  let row = await rowAt(tx, table, key, value);
  if (!row) return undefined;
  for (const hop of path) {
    row = await rowAt(tx, hop.table, hop.key, row[hop.column]);
    if (!row) return undefined;
  }
  return row[rootKey];
}

async function mutationRoot(
  tx: Db,
  policy: MemberPolicy,
  writes: Record<string, unknown>,
  record: unknown,
): Promise<unknown> {
  const { path, membershipRoot } = policy;
  if (!path || !membershipRoot) throw new Error('member policy was not resolved by blend()');
  if (path.length === 0) return finalField(writes, record, membershipRoot.key);
  const [first, ...rest] = path;
  if (!first) throw new Error('member policy path did not resolve');
  return rootAt(
    tx,
    first.table,
    first.key,
    finalField(writes, record, first.column),
    rest,
    membershipRoot.key,
  );
}

async function hasMembership(
  tx: Db,
  policy: MemberPolicy,
  root: unknown,
  member: unknown,
): Promise<boolean> {
  if (root === undefined || root === null || member === undefined || member === null) return false;
  const { membershipRoot } = policy;
  if (!membershipRoot) throw new Error('member policy was not resolved by blend()');
  const columns = getColumns(policy.through.model.table);
  const rootColumn = columns[membershipRoot.column];
  const memberColumn = columns[policy.through.member];
  if (!rootColumn || !memberColumn) throw new Error('member policy resolved to missing columns');
  const rows: unknown[] = await tx
    .select({ one: sql`1` })
    .from(policy.through.model.table as never)
    .where(and(eq(rootColumn as never, root), eq(memberColumn as never, member)))
    .limit(1);
  return rows.length > 0;
}

async function relatedRoot(
  tx: Db,
  related: Extract<ResolvedMemberRelated, { kind: 'via' }>,
  rootKey: string,
  value: unknown,
): Promise<unknown> {
  return rootAt(tx, related.table, related.key, value, related.path, rootKey);
}

/** D36: re-check the final root and declared IDs in the default write's transaction. */
async function validateMemberMutation(
  tx: Db,
  policy: MemberPolicy,
  writes: Record<string, unknown>,
  record: unknown,
  auth: unknown,
): Promise<void> {
  const root = await mutationRoot(tx, policy, writes, record);
  const identity = readField(auth, policy.authKey);
  if (!(await hasMembership(tx, policy, root, identity))) {
    throw new HttpProblem(
      problem(403, { detail: 'The identity cannot access this membership root.' }),
    );
  }
  const rootKey = policy.membershipRoot?.key;
  if (!rootKey) throw new Error('member policy was not resolved by blend()');
  for (const related of policy.resolvedRelated ?? []) {
    const value = finalField(writes, record, related.field);
    if (value === undefined || value === null) continue;
    const valid =
      related.kind === 'member'
        ? await hasMembership(tx, policy, root, value)
        : (await relatedRoot(tx, related, rootKey, value)) === root;
    if (!valid) {
      throw new HttpProblem(
        problem(422, {
          detail: 'The request refers to a record outside the membership root.',
          errors: [
            {
              pointer: jsonPointer([related.field]),
              detail: 'does not belong to the membership root',
            },
          ],
        }),
      );
    }
  }
}

/**
 * The schema-level load and save for an endpoint.
 * Load: a member by primary key, never a soft-deleted one (restore loads only those, purge
 * loads both), or a filtered, sorted page for index.
 * Save: store inserts with both timestamps; update and custom member actions update and
 * touch updated_at (no query when there is nothing to write); destroy sets deleted_at, or
 * deletes on tables without it; restore clears deleted_at; purge deletes for good (D29).
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
  /** The key's columns, in its order (D33). */
  const keyColumns = () => {
    const key = model.meta.primaryKey.map((name) => columns[name]);
    if (key.length === 0 || key.some((column) => column === undefined)) {
      throw new Error(`${model.name} has no primary key`);
    }
    return key as PgColumn[];
  };
  /** The path parameters that name a record: `id`, or one per column of a composite key (D33). */
  const segments = model.meta.primaryKey.length > 1 ? model.meta.primaryKey : ['id'];
  /** The row the path names: every key column equal to its segment. */
  const byPath = (params: Readonly<Record<string, string>>) =>
    keyColumns().map((column, index) => eq(column, params[segments[index] ?? '']));

  /** Live rows by default; `only` for trashed rows; `with` for both. */
  const trashScope = (trashed: 'with' | 'only' | undefined) => {
    if (!deletedAt || trashed === 'with') return undefined;
    return trashed === 'only' ? isNotNull(deletedAt) : isNull(deletedAt);
  };

  async function loadMember(
    db: Db,
    params: Readonly<Record<string, string>>,
    auth: unknown,
    lock: boolean,
  ): Promise<unknown> {
    const scope = trashScope(
      action === 'restore' ? 'only' : action === 'purge' ? 'with' : undefined,
    );
    const select = db
      .select()
      .from(table)
      .where(
        and(
          ...byPath(params),
          scope,
          isMemberPolicy(endpoint.policy)
            ? memberPredicate(db, endpoint.policy, model.table, auth)
            : undefined,
        ),
      )
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
    const where = and(
      ...filters,
      ...scope,
      trashScope(query.trashed),
      isMemberPolicy(endpoint.policy)
        ? memberPredicate(db, endpoint.policy, model.table, auth)
        : undefined,
    );
    // The order: the sort column, then every key column not already sorted on, ascending (D33).
    const key = keyColumns();
    const sort = query.sort ?? '';
    const column = columns[sort.replace(/^-/, '')];
    const order = [
      ...(column ? [sort.startsWith('-') ? desc(column) : asc(column)] : []),
      ...key.filter((keyColumn) => keyColumn !== column).map((keyColumn) => asc(keyColumn)),
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

    // The loaded row, found again by every column of its key (D33).
    const key = keyColumns();
    const values = model.meta.primaryKey.map((name) =>
      isObject(record) ? record[name] : undefined,
    );
    if (values.some((value) => value === undefined)) {
      throw new Error(`${model.name}.${action}: there is no loaded record to save`);
    }
    const where = and(...key.map((column, index) => eq(column, values[index])));

    if ((action === 'destroy' && !deletedAt) || action === 'purge') {
      const rows: unknown[] = await tx.delete(table).where(where).returning();
      return rows[0];
    }

    const softDelete = model.meta.softDelete;
    // D34: replace sends a defaulted column the writes leave out back to its default.
    const defaults = () =>
      Object.fromEntries(
        resetColumns(endpoint)
          .toDefault.filter((column) => !(column in writes))
          .map((column) => [column, sql`default`]),
      );
    const changes: Record<string, unknown> =
      action === 'destroy' && softDelete
        ? { [softDelete]: sql`now()` }
        : action === 'restore' && softDelete
          ? { [softDelete]: null }
          : action === 'replace'
            ? { ...writes, ...defaults() }
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
      action === 'index' ? loadPage(db, input, auth) : loadMember(db, params, auth, lock === true),
    save: async ({ tx, writes, record, auth }) => {
      if (isMemberPolicy(endpoint.policy)) {
        await validateMemberMutation(tx, endpoint.policy, writes, record, auth);
      }
      return saveRow(tx, writes, record);
    },
  };
}
