/**
 * App-owned domain actions (D37). They describe a typed route without borrowing a resource
 * model or its pipeline. The declaration is pure data plus the handler; Hono and the CLI
 * consume it in P17.13, and later generators consume its stable metadata.
 */

import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

type ActionDb = PgAsyncDatabase<PgQueryResultHKT>;
type ActionModel = { readonly name: string; readonly table: object };
type ActionPolicy<Auth> = {
  readonly kind: string;
  readonly requiresAuth: boolean;
  /** The policy wording emitted in OpenAPI and review artifacts. */
  readonly description: string;
  check(context: {
    auth: Auth | null;
    record: undefined;
    input: unknown;
    action: string;
  }): boolean | Promise<boolean>;
};

export type AppActionMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** A Zod form schema and the maximum request body Blendx will buffer for it (P17.16). */
export interface MultipartInput<Schema extends z.ZodType = z.ZodType> {
  readonly kind: 'blendx/multipart';
  readonly schema: Schema;
  readonly maxBytes: number;
}

/** Declares a typed multipart/form-data input for a writing app action. */
export function multipart<Schema extends z.ZodType>(
  schema: Schema,
  options: { readonly maxBytes: number },
): MultipartInput<Schema> {
  if (!isSchema(schema))
    throw new AppActionDefinitionError('multipart schema must be a Zod schema');
  if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
    throw new AppActionDefinitionError('multipart maxBytes must be a positive finite number');
  }
  return Object.freeze({ kind: 'blendx/multipart' as const, schema, maxBytes: options.maxBytes });
}

type WritingMethod = Exclude<AppActionMethod, 'get'>;
type MaybePromise<T> = T | Promise<T>;
type ActionInput = z.ZodType | MultipartInput;
type InputSchema<Input extends ActionInput> =
  Input extends MultipartInput<infer Schema> ? Schema : Input extends z.ZodType ? Input : never;

/** Thrown when an app action cannot satisfy D37's declaration contract. */
export class AppActionDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppActionDefinitionError';
  }
}

/** The handler context: reads get db; every other method gets the transaction it owns. */
export type AppActionContext<
  Input extends z.ZodType = z.ZodType,
  Auth = unknown,
  Method extends AppActionMethod = AppActionMethod,
> = {
  readonly input: z.output<Input>;
  readonly params: Readonly<Record<string, string>>;
  readonly auth: Auth | null;
} & (Method extends 'get' ? { readonly db: ActionDb } : { readonly tx: ActionDb });

/** The value an app-action handler returns after its schema has described it. */
export interface AppActionResult<Status extends number = number, Body = unknown> {
  readonly status: Status;
  readonly body: Body;
  readonly headers?: Readonly<Record<string, string>>;
}

export type AppActionHandler<
  Input extends z.ZodType,
  Auth,
  Method extends AppActionMethod,
  Status extends number,
  Body extends z.ZodType,
> = (
  context: AppActionContext<Input, Auth, Method>,
) => MaybePromise<AppActionResult<Status, z.output<Body>>>;

export interface AppActionReply<
  Status extends number = number,
  Body extends z.ZodType = z.ZodType,
> {
  readonly status: Status;
  readonly body: Body;
}

/** The resolved app-action declaration that routes and generators consume. */
export interface AppActionDefinition<
  Name extends string = string,
  Input extends z.ZodType = z.ZodType,
  Status extends number = number,
  Body extends z.ZodType = z.ZodType,
  Method extends AppActionMethod = AppActionMethod,
  Multipart extends Readonly<{ maxBytes: number }> | undefined =
    | Readonly<{ maxBytes: number }>
    | undefined,
> {
  readonly kind: 'blendx/app-action';
  readonly id: `app.${Name}`;
  readonly name: Name;
  readonly method: Method;
  readonly path: string;
  readonly policy: ActionPolicy<unknown>;
  readonly input: Input;
  /** Present when input was declared with multipart(); its schema stays in input. */
  readonly multipart: Multipart;
  readonly reply: AppActionReply<Status, Body>;
  /** Declared generated-model names, in source order. Empty only for GET. */
  readonly writes: readonly string[];
  readonly handler: AppActionHandler<Input, unknown, Method, Status, Body>;
}

type BaseSpec<Input extends ActionInput, Auth, Status extends number, Body extends z.ZodType> = {
  readonly path: string;
  readonly policy: ActionPolicy<Auth>;
  readonly input: Input;
  readonly reply: AppActionReply<Status, Body>;
};

type GetSpec<
  Input extends ActionInput,
  Auth,
  Status extends number,
  Body extends z.ZodType,
> = BaseSpec<Input, Auth, Status, Body> & {
  readonly method: 'get';
  readonly writes?: never;
  readonly handler: AppActionHandler<InputSchema<Input>, Auth, 'get', Status, Body>;
};

type WriteSpec<
  Input extends ActionInput,
  Auth,
  Method extends WritingMethod,
  Status extends number,
  Body extends z.ZodType,
> = BaseSpec<Input, Auth, Status, Body> & {
  readonly method: Method;
  readonly writes: readonly [ActionModel, ...ActionModel[]];
  readonly handler: AppActionHandler<InputSchema<Input>, Auth, Method, Status, Body>;
};

/** The callback passed to defineApp({ actions }). */
export interface AppActionBuilder<Auth = unknown> {
  action<
    const Name extends string,
    const Input extends ActionInput,
    const Status extends number,
    const Body extends z.ZodType,
  >(
    name: Name,
    spec: GetSpec<Input, Auth, Status, Body>,
  ): AppActionDefinition<
    Name,
    InputSchema<Input>,
    Status,
    Body,
    'get',
    Input extends MultipartInput ? Readonly<{ maxBytes: number }> : undefined
  >;
  action<
    const Name extends string,
    const Input extends ActionInput,
    const Method extends WritingMethod,
    const Status extends number,
    const Body extends z.ZodType,
  >(
    name: Name,
    spec: WriteSpec<Input, Auth, Method, Status, Body>,
  ): AppActionDefinition<
    Name,
    InputSchema<Input>,
    Status,
    Body,
    Method,
    Input extends MultipartInput ? Readonly<{ maxBytes: number }> : undefined
  >;
}

const NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const SEGMENT = '(?:[A-Za-z0-9._~-]+|:[A-Za-z_][A-Za-z0-9_]*)';
const PATH = new RegExp(`^/(?:${SEGMENT}(?:/${SEGMENT})*)?$`);
const METHODS: ReadonlySet<string> = new Set(['get', 'post', 'put', 'patch', 'delete']);
const BODY_METHODS: ReadonlySet<AppActionMethod> = new Set(['post', 'put', 'patch']);
const OPEN_POLICIES: ReadonlySet<string> = new Set(['public', 'authenticated']);

const isSchema = (value: unknown): value is z.ZodType =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { safeParse?: unknown }).safeParse === 'function';

const isMultipartInput = (value: unknown): value is MultipartInput =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'blendx/multipart' &&
  isSchema((value as { schema?: unknown }).schema) &&
  Number.isFinite((value as { maxBytes?: unknown }).maxBytes) &&
  (value as { maxBytes: number }).maxBytes > 0;

const isModel = (value: unknown): value is ActionModel =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string' &&
  typeof (value as { table?: unknown }).table === 'object' &&
  (value as { table?: unknown }).table !== null;

function fail(name: string, message: string): never {
  throw new AppActionDefinitionError(`app.${name} ${message}`);
}

function defineAction(name: string, spec: unknown): AppActionDefinition {
  if (!NAME.test(name)) fail(name, 'name must be lower_snake_case');
  if (typeof spec !== 'object' || spec === null) fail(name, 'must have an action specification');
  const value = spec as {
    method?: unknown;
    path?: unknown;
    policy?: unknown;
    input?: unknown;
    reply?: unknown;
    writes?: unknown;
    handler?: unknown;
  };
  if (typeof value.method !== 'string' || !METHODS.has(value.method)) {
    fail(name, 'method must be an explicit HTTP method');
  }
  const method = value.method as AppActionMethod;
  if (typeof value.path !== 'string' || !PATH.test(value.path)) {
    fail(name, 'path must be an absolute Hono path with valid :segments');
  }
  if (
    typeof value.policy !== 'object' ||
    value.policy === null ||
    typeof (value.policy as { check?: unknown }).check !== 'function'
  ) {
    fail(name, 'requires a policy');
  }
  const policy = value.policy as ActionPolicy<unknown>;
  if (typeof policy.description !== 'string' || policy.description.trim() === '') {
    fail(name, 'policy needs a description');
  }
  if (policy.kind === 'owner' || policy.kind === 'member') {
    fail(name, `${policy.kind} policy requires a resource record`);
  }
  const multipartInput = isMultipartInput(value.input) ? value.input : undefined;
  const input = multipartInput?.schema ?? value.input;
  if (!isSchema(input)) fail(name, 'input must be a Zod schema');
  if (multipartInput && !BODY_METHODS.has(method)) {
    fail(name, 'multipart input requires POST, PUT, or PATCH');
  }
  if (typeof value.reply !== 'object' || value.reply === null) {
    fail(name, 'reply must declare a status and Zod body schema');
  }
  const reply = value.reply as { status?: unknown; body?: unknown };
  if (
    !Number.isInteger(reply.status) ||
    (reply.status as number) < 200 ||
    (reply.status as number) > 299
  ) {
    fail(name, 'reply status must be a successful HTTP status');
  }
  if (!isSchema(reply.body)) fail(name, 'reply body must be a Zod schema');
  if (typeof value.handler !== 'function') fail(name, 'requires a handler');

  let writes: string[] = [];
  if (method === 'get') {
    if (value.writes !== undefined) fail(name, 'GET actions cannot declare writes');
  } else {
    if (!Array.isArray(value.writes) || value.writes.length === 0) {
      fail(name, 'writing actions require a non-empty writes declaration');
    }
    if (!value.writes.every(isModel)) fail(name, 'writes must contain generated schema models');
    writes = value.writes.map((model) => model.name);
    const duplicate = writes.find((table, index) => writes.indexOf(table) !== index);
    if (duplicate) fail(name, `writes declares ${duplicate} more than once`);
  }

  return Object.freeze({
    kind: 'blendx/app-action' as const,
    id: `app.${name}` as `app.${string}`,
    name,
    method,
    path: value.path,
    policy,
    input,
    multipart: multipartInput ? Object.freeze({ maxBytes: multipartInput.maxBytes }) : undefined,
    reply: Object.freeze({ status: reply.status as number, body: reply.body }),
    writes: Object.freeze(writes),
    handler: value.handler as AppActionDefinition['handler'],
  });
}

/** Whether an app action receives JSON, rather than query input or no input. */
export const appActionHasJsonBody = (
  action: Pick<AppActionDefinition, 'method' | 'multipart'>,
): boolean => BODY_METHODS.has(action.method) && action.multipart === undefined;

/** Problem statuses declared by every generated action surface (D37). */
export function appActionProblemStatuses(
  action: Pick<AppActionDefinition, 'method' | 'policy' | 'multipart'>,
): readonly number[] {
  return [
    ...(BODY_METHODS.has(action.method) ? [400] : []),
    ...(action.multipart ? [413] : []),
    ...(action.policy.requiresAuth ? [401] : []),
    ...(!OPEN_POLICIES.has(action.policy.kind) ? [403] : []),
    ...(action.method === 'get' ? [] : [409]),
    422,
  ];
}

/** Makes the action callback builder. Each call validates and freezes one declaration. */
export function appActions<Auth = unknown>(): AppActionBuilder<Auth> {
  return Object.freeze({
    action: ((name: string, spec: unknown) =>
      defineAction(name, spec)) as AppActionBuilder<Auth>['action'],
  });
}

/** defineApp calls this after its callback to reject duplicate stable names. */
export function validateAppActions(actions: readonly AppActionDefinition[]): void {
  const names = new Set<string>();
  for (const action of actions) {
    if (names.has(action.name)) {
      throw new AppActionDefinitionError(`app.${action.name} is declared more than once`);
    }
    names.add(action.name);
  }
}
