/**
 * run(resource, action): the generic controller behind every generated route. It returns a
 * [validator, handler] pair with explicit types, so a chained Hono route keeps hc RPC types
 * (docs/decisions.md D9). The validator slot carries types only: the engine validates.
 */
import {
  type ActionDefinition,
  type ActionReply,
  type App,
  defaultEffects,
  execute,
  type ProblemDetails,
  type Reply,
  type ResolvedEndpoint,
  type Resource,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import type { Context, Handler, MiddlewareHandler, TypedResponse } from 'hono';
import type { BlankInput } from 'hono/types';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { type BlendxEnv, readJson } from './server.ts';

type ProblemResponse = TypedResponse<
  ProblemDetails,
  400 | 401 | 403 | 404 | 409 | 422 | 500,
  'json'
>;

type JsonBody<Rules extends z.ZodType> = {
  in: { json: z.input<Rules> };
  out: { json: z.output<Rules> };
};

/**
 * A JSON body typed by the rules; none when they are an object that accepts no keys, as
 * OpenAPI has no request body for it (P15.6). Other schemas keep their body.
 */
type JsonInput<Rules> =
  Rules extends z.ZodObject<infer Shape>
    ? [keyof Shape] extends [never]
      ? BlankInput
      : JsonBody<Rules>
    : Rules extends z.ZodType
      ? JsonBody<Rules>
      : BlankInput;

type QueryInput = {
  in: { query: Record<string, string> };
  out: { query: Record<string, string> };
};

type QueryFromRules<Rules> = Rules extends z.ZodType
  ? { in: { query: z.input<Rules> }; out: { query: z.output<Rules> } }
  : BlankInput;

/**
 * What a request sends. index takes its filters and paging as a query; show, destroy,
 * restore and purge take nothing; other GET actions take their rules as a query, DELETE
 * ones nothing, and the rest a JSON body, unless their rules accept nothing.
 */
export type InputOf<A> =
  A extends ActionDefinition<infer Name, infer Rules, unknown, infer Method>
    ? Name extends 'index'
      ? QueryInput
      : Name extends 'show' | 'destroy' | 'restore' | 'purge'
        ? BlankInput
        : Method extends 'get'
          ? QueryFromRules<Rules>
          : Method extends 'delete'
            ? BlankInput
            : JsonInput<Rules>
    : BlankInput;

type ReplyResponse<R> =
  R extends Reply<infer Status, infer Body>
    ? Status extends 204
      ? TypedResponse<null, 204, 'body'>
      : TypedResponse<Body, Status & StatusCode, 'json'>
    : never;

/** What a request gets back: the action's reply, or a Problem Details response. */
export type ResponseOf<A> = ReplyResponse<ActionReply<A>> | ProblemResponse;

export type RunTuple<A> = readonly [
  MiddlewareHandler<BlendxEnv, string, InputOf<A>>,
  Handler<BlendxEnv, string, InputOf<A>, Promise<ResponseOf<A>>>,
];

type ActionNamed<R extends Resource, N> = Extract<R['actions'][number], { name: N }>;

export function run<R extends Resource, const N extends R['actions'][number]['name']>(
  resource: R,
  action: N,
): RunTuple<ActionNamed<R, N>> {
  const definition = toEndpoints(resource).find((endpoint) => endpoint.action === action);
  if (!definition) throw new Error(`${resource.model.name} has no action "${action}"`);

  const resolved = new WeakMap<App, ResolvedEndpoint>();
  const endpointFor = (app: App) => {
    let endpoint = resolved.get(app);
    if (!endpoint) {
      endpoint = resolveEndpoint(definition, {
        app,
        defaults: defaultEffects(definition, { perPage: app.index.perPage }),
      });
      resolved.set(app, endpoint);
    }
    return endpoint;
  };

  const validate: MiddlewareHandler<BlendxEnv> = async (_c, next) => {
    await next();
  };

  const handle = async (c: Context<BlendxEnv>) => {
    const { app, db, auth, onError } = c.get('blendx');
    const endpoint = endpointFor(app);
    const typeBase = app.spec.problems?.typeBase;
    const hasBody = endpoint.method !== 'get' && endpoint.method !== 'delete';
    const result = await execute(
      endpoint,
      {
        params: c.req.param(),
        query: c.req.query(),
        body: hasBody ? await readJson(c, typeBase) : undefined,
        auth,
      },
      { db, typeBase, onError },
    );
    if (result.status === 204) return c.body(null, 204, result.headers);
    return c.json(result.body as never, result.status as ContentfulStatusCode, result.headers);
  };

  return [validate, handle] as unknown as RunTuple<ActionNamed<R, N>>;
}
