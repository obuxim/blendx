/**
 * The engine: runs one request through an endpoint's pipeline (docs/decisions.md D3):
 * authenticate, validate, load, authorize, calculate, save, respond. Every failure is a
 * Problem Details response; the order decides precedence (401, 422, 404, 403).
 */
import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { RegisteredAuth } from './app.ts';
import type { EffectDefaults, ResolvedEndpoint } from './cascade.ts';
import type { EndpointDefinition } from './endpoints.ts';
import type { Db, Reply } from './hooks.ts';
import type { Model } from './model.ts';
import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problem,
  validationProblem,
} from './problems.ts';

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
const saves = (endpoint: EndpointDefinition) =>
  endpoint.on === 'member' ? endpoint.action !== 'show' : endpoint.action === 'store';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function writableColumns(model: Model): Set<string> {
  const generated = new Set(model.meta.generated);
  return new Set(Object.keys(getTableColumns(model.table)).filter((name) => !generated.has(name)));
}

/** The schema-default writes: the validated input's writable columns. */
function defaultWrites(model: Model, input: unknown): Record<string, unknown> {
  if (!isObject(input)) return {};
  const writable = writableColumns(model);
  return Object.fromEntries(Object.entries(input).filter(([key]) => writable.has(key)));
}

/** calculate may only return writable columns of its model. A mistake is a 500, not a silent drop. */
function assertWritable(model: Model, action: string, writes: unknown): Record<string, unknown> {
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

function defaultReply(endpoint: EndpointDefinition, record: unknown, result: unknown): Reply {
  if (endpoint.on === 'collection' && !endpoint.builtin) return { status: 200, body: result };
  if (endpoint.action === 'destroy') return { status: 204, body: null };
  return {
    status: endpoint.action === 'store' ? 201 : 200,
    body: publicRow(record, endpoint.hidden),
  };
}

/** Runs one request through the endpoint's pipeline. */
export async function execute(
  endpoint: ResolvedEndpoint,
  request: ExecuteRequest,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const { typeBase } = deps;
  const { auth, params, query } = request;
  try {
    // authenticate: an identity-requiring policy answers 401 before anything else runs
    if (endpoint.requiresAuth && (auth === null || auth === undefined)) {
      throw new HttpProblem(problem(401, { typeBase }));
    }

    // validate
    const fromQuery = endpoint.method === 'get';
    const parsed = endpoint.rules.safeParse(fromQuery ? query : (request.body ?? {}));
    if (!parsed.success) {
      throw new HttpProblem(
        validationProblem(parsed.error, { in: fromQuery ? 'query' : 'body', typeBase }),
      );
    }
    const input = parsed.data;

    // load
    const record =
      endpoint.on === 'member'
        ? await endpoint.load({ db: deps.db, params, query, auth })
        : undefined;
    if (endpoint.on === 'member' && record === undefined) {
      throw new HttpProblem(problem(404, { typeBase, detail: `${endpoint.resource} not found` }));
    }

    // authorize
    if (!(await endpoint.authorize({ auth, record, input }))) {
      throw new HttpProblem(problem(403, { typeBase }));
    }

    // calculate
    const result = endpoint.calculate({
      prev: defaultWrites(endpoint.model, input),
      input,
      record,
    });

    // save
    const saved = saves(endpoint)
      ? await endpoint.save({
          tx: deps.db,
          writes: assertWritable(endpoint.model, endpoint.action, result),
          record,
          auth,
        })
      : record;

    // respond
    const reply = endpoint.respond({
      prev: defaultReply(endpoint, saved, result),
      record: publicRow(saved, endpoint.hidden),
      result,
    });
    return { status: reply.status, body: reply.body, headers: { ...reply.headers } };
  } catch (error) {
    if (!(error instanceof HttpProblem)) throw error;
    return {
      status: error.problem.status,
      body: error.problem,
      headers: { 'content-type': PROBLEM_CONTENT_TYPE },
    };
  }
}

/**
 * The schema-level load and save for an endpoint. P5.2 covers loading a member by its
 * primary key and inserting on store; P5.3 and P5.4 complete the rest.
 */
export function defaultEffects(endpoint: EndpointDefinition): EffectDefaults {
  const { model, action } = endpoint;
  const table = model.table as never;
  const columns = getTableColumns(model.table);
  const primaryKey = model.meta.primaryKey ? columns[model.meta.primaryKey] : undefined;
  const { createdAt, updatedAt } = model.meta.timestamps;
  const stamps = (keys: (string | null)[]) =>
    Object.fromEntries(keys.filter((key) => key !== null).map((key) => [key, sql`now()`]));

  return {
    async load({ db, params }) {
      if (!primaryKey) throw new Error(`${model.name} has no primary key`);
      const [row] = await db.select().from(table).where(eq(primaryKey, params.id)).limit(1);
      return row;
    },
    async save({ tx, writes }) {
      if (action !== 'store') {
        throw new Error(`${model.name}.${action}: the default save arrives with P5.4`);
      }
      const rows: unknown[] = await tx
        .insert(table)
        .values({ ...writes, ...stamps([createdAt, updatedAt]) } as never)
        .returning();
      return rows[0];
    },
  };
}
