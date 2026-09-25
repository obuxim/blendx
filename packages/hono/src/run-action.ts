/**
 * runAction(app, name): controller for a D37 app-owned domain action. It deliberately does
 * not enter the resource pipeline: no record load, default save, hooks, or implicit reply.
 */
import {
  type App,
  type AppActionDefinition,
  type Db,
  databaseError,
  HttpProblem,
  type ProblemDetails,
  problem,
  type Reply,
  validationProblem,
} from '@blendx/core';
import type { Context, Handler, MiddlewareHandler, TypedResponse } from 'hono';
import type { BlankInput } from 'hono/types';
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { type BlendxEnv, readJson } from './server.ts';

type ProblemResponse = TypedResponse<
  ProblemDetails,
  400 | 401 | 403 | 404 | 409 | 413 | 422 | 500,
  'json'
>;

type JsonBody<Schema extends z.ZodType> = {
  in: { json: z.input<Schema> };
  out: { json: z.output<Schema> };
};

type QueryInput<Schema extends z.ZodType> = {
  in: { query: z.input<Schema> };
  out: { query: z.output<Schema> };
};

type FormInput<Schema extends z.ZodType> = {
  in: { form: z.input<Schema> };
  out: { form: z.output<Schema> };
};

type EmptyObject<Schema> =
  Schema extends z.ZodObject<infer Shape> ? ([keyof Shape] extends [never] ? true : false) : false;

/** Hono's request input for an app action, derived directly from D37's input schema. */
export type AppActionInputOf<Action> =
  Action extends AppActionDefinition<string, infer Input, number, z.ZodType, infer Method>
    ? Action extends { readonly multipart: object }
      ? FormInput<Input>
      : Method extends 'get'
        ? EmptyObject<Input> extends true
          ? BlankInput
          : QueryInput<Input>
        : Method extends 'delete'
          ? BlankInput
          : EmptyObject<Input> extends true
            ? BlankInput
            : JsonBody<Input>
    : BlankInput;

type SuccessResponse<Action> =
  Action extends AppActionDefinition<string, z.ZodType, infer Status, infer Body>
    ? TypedResponse<z.output<Body>, Status & StatusCode, 'json'>
    : never;

/** The declared success reply plus the common Problem Details responses. */
export type AppActionResponseOf<Action> = SuccessResponse<Action> | ProblemResponse;

export type RunActionTuple<Action> = readonly [
  MiddlewareHandler<BlendxEnv, string, AppActionInputOf<Action>>,
  Handler<BlendxEnv, string, AppActionInputOf<Action>, Promise<AppActionResponseOf<Action>>>,
];

type NamedAction<AppDefinition extends App, Name> = Extract<
  AppDefinition['actions'][number],
  { name: Name }
>;

/**
 * A constraint the handler's SQL tripped, as the engine answers it (D4, D11): a unique
 * violation is 409; a missing referenced record is 422, or 409 when a DELETE is still referenced.
 */
function databaseProblem(
  error: unknown,
  method: AppActionDefinition['method'],
  typeBase: string | undefined,
): ProblemDetails | undefined {
  switch (databaseError(error)?.code) {
    case '23505':
      return problem(409, { typeBase, detail: 'A record with the same value already exists.' });
    case '23503':
      return method === 'delete'
        ? problem(409, { typeBase, detail: 'The record is still referenced by other records.' })
        : problem(422, { typeBase, detail: 'The request refers to a record that does not exist.' });
    default:
      return undefined;
  }
}

async function readMultipart(c: Context, maxBytes: number, typeBase?: string): Promise<unknown> {
  const contentType = c.req.header('content-type') ?? '';
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new HttpProblem(
      problem(400, { typeBase, detail: 'The request body must be multipart/form-data.' }),
    );
  }
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpProblem(
      problem(413, { typeBase, detail: 'The multipart request body is too large.' }),
    );
  }
  const stream = c.req.raw.body;
  if (!stream)
    throw new HttpProblem(problem(400, { typeBase, detail: 'The request body is missing.' }));
  const reader = stream.getReader();
  // A body chunk is never backed by shared memory, which is all BlobPart leaves out.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpProblem(
          problem(413, { typeBase, detail: 'The multipart request body is too large.' }),
        );
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
    const form = await new Response(new Blob(chunks), {
      headers: { 'content-type': contentType },
    }).formData();
    const values: Record<string, FormDataEntryValue> = {};
    for (const [key, value] of form.entries()) {
      if (Object.hasOwn(values, key)) {
        throw new HttpProblem(
          problem(422, { typeBase, detail: `The multipart field ${key} occurs more than once.` }),
        );
      }
      values[key] = value;
    }
    return values;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw new HttpProblem(
      problem(400, { typeBase, detail: 'The multipart request body is malformed.' }),
    );
  } finally {
    reader.releaseLock();
  }
}

const callPolicy = async (
  action: AppActionDefinition,
  auth: unknown,
  input: unknown,
  typeBase: string | undefined,
) => {
  if (action.policy.requiresAuth && (auth === null || auth === undefined)) {
    throw new HttpProblem(problem(401, { typeBase }));
  }
  if (!(await action.policy.check({ auth, record: undefined, input, action: action.name }))) {
    throw new HttpProblem(problem(403, { typeBase }));
  }
};

function assertReply(action: AppActionDefinition, reply: unknown): Reply {
  if (
    typeof reply !== 'object' ||
    reply === null ||
    (reply as { status?: unknown }).status !== action.reply.status
  ) {
    throw new Error(`${action.id} handler must return its declared ${action.reply.status} reply`);
  }
  const parsed = action.reply.body.safeParse((reply as { body?: unknown }).body);
  if (!parsed.success)
    throw new Error(`${action.id} handler returned a body outside its reply schema`);
  return { ...(reply as Reply), body: parsed.data };
}

/** Finds one declaration from a generated `runAction(app, name)` call and preserves its RPC type. */
export function runAction<
  AppDefinition extends App,
  const Name extends AppDefinition['actions'][number]['name'],
>(app: AppDefinition, name: Name): RunActionTuple<NamedAction<AppDefinition, Name>> {
  const action = app.actions.find((candidate) => candidate.name === name);
  if (!action) throw new Error(`app has no action "${name}"`);

  const multipartInputs = new WeakMap<Request, unknown>();
  const validate: MiddlewareHandler<BlendxEnv> = async (c, next) => {
    const { auth } = c.get('blendx');
    const typeBase = app.spec.problems?.typeBase;
    // Identity must win before the adapter consumes a possibly malformed upload.
    if (action.policy.requiresAuth && (auth === null || auth === undefined)) {
      throw new HttpProblem(problem(401, { typeBase }));
    }
    if (action.multipart) {
      multipartInputs.set(c.req.raw, await readMultipart(c, action.multipart.maxBytes, typeBase));
    }
    await next();
  };

  const handle = async (c: Context<BlendxEnv>) => {
    const { db, auth } = c.get('blendx');
    const typeBase = app.spec.problems?.typeBase;
    const fromQuery = action.method === 'get';
    const hasBody =
      action.method === 'post' || action.method === 'put' || action.method === 'patch';
    let input: unknown;
    try {
      // validate answered 401 already: a missing identity wins before any input is read.
      const raw = action.multipart
        ? multipartInputs.get(c.req.raw)
        : fromQuery
          ? c.req.query()
          : hasBody
            ? await readJson(c, typeBase)
            : {};
      const parsed = action.input.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new HttpProblem(
          validationProblem(parsed.error, { in: fromQuery ? 'query' : 'body', typeBase }),
        );
      }
      input = parsed.data;
      const invoke = async (handleDb: Db) => {
        await callPolicy(action, auth, input, typeBase);
        const result =
          action.method === 'get'
            ? await action.handler({ input, params: c.req.param(), auth, db: handleDb } as never)
            : await action.handler({ input, params: c.req.param(), auth, tx: handleDb } as never);
        return assertReply(action, result);
      };
      const reply =
        action.method === 'get'
          ? await invoke(db)
          : await db.transaction((tx) => invoke(tx as unknown as Db));
      return c.json(reply.body as never, reply.status as ContentfulStatusCode, reply.headers);
    } catch (error) {
      if (error instanceof HttpProblem) throw error;
      const details = databaseProblem(error, action.method, typeBase);
      if (details) throw new HttpProblem(details);
      throw error;
    }
  };

  return [validate, handle] as unknown as RunActionTuple<NamedAction<AppDefinition, Name>>;
}
