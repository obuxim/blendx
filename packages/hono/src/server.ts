/**
 * createServer(): the Hono app that serves blendx routes. It resolves the request's
 * identity through the app's auth function, hands routes the database and identity, and
 * answers every error as RFC 9457 Problem Details.
 */
import {
  type App,
  type Db,
  HttpProblem,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problem,
  type RegisteredAuth,
} from '@blendx/core';
import { type Context, Hono } from 'hono';

export interface BlendxContext {
  app: App;
  db: Db;
  /** What the app's auth function resolved for this request, or null. */
  auth: RegisteredAuth | null;
  /** The server's onError: routes hand it what an after hook throws (D26). */
  onError?: (error: unknown) => void;
}

export type BlendxEnv = { Variables: { blendx: BlendxContext } };

export interface ServerOptions {
  app: App;
  db: Db;
  /** The generated routes (routes.gen.ts). */
  routes?: Hono<BlendxEnv>;
  /** Where the routes are mounted, e.g. '/api'. Defaults to '/'. */
  basePath?: string;
  /**
   * Called with every unexpected error before the 500 problem is sent, and with what an after
   * hook throws, whose reply stands (D26). console.error by default.
   */
  onError?: (error: unknown) => void;
}

export function problemResponse(c: Context, details: ProblemDetails) {
  return c.json(details, details.status, { 'Content-Type': PROBLEM_CONTENT_TYPE });
}

/** The request's JSON body: undefined when empty, a 400 problem when malformed. */
export async function readJson(c: Context, typeBase?: string): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpProblem(
      problem(400, { typeBase, detail: 'The request body is not valid JSON.' }),
    );
  }
}

/** An empty route group for blendx routes. routes.gen.ts chains every endpoint onto one. */
export function router(): Hono<BlendxEnv> {
  return new Hono<BlendxEnv>();
}

export function createServer(options: ServerOptions): Hono<BlendxEnv> {
  const { app, db } = options;
  const typeBase = app.spec.problems?.typeBase;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const server = new Hono<BlendxEnv>();

  server.use(async (c, next) => {
    const identity = app.spec.auth ? await app.spec.auth({ request: c.req.raw, db }) : null;
    c.set('blendx', { app, db, auth: (identity ?? null) as RegisteredAuth | null, onError });
    await next();
  });

  if (options.routes) server.route(options.basePath ?? '/', options.routes);

  server.notFound((c) =>
    problemResponse(
      c,
      problem(404, { typeBase, detail: `No route for ${c.req.method} ${c.req.path}` }),
    ),
  );

  server.onError((error, c) => {
    if (error instanceof HttpProblem) return problemResponse(c, error.problem);
    onError(error);
    return problemResponse(c, problem(500, { typeBase }));
  });

  return server;
}
