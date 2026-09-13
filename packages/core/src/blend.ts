/**
 * blend(): declares a resource. The actions callback returns the exposed actions, one
 * call per action, which is how `calculate` gets its input type from `rules`
 * (docs/decisions.md D12). Nothing is exposed unless it is listed, and every listed
 * action needs a policy (default-deny).
 */
import { getTableColumns } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  AuthorizeContext,
  CalculateContext,
  CollectionSpec,
  IndexPage,
  IndexSpec,
  LoadContext,
  MemberSpec,
  RecordSpec,
  Reply,
  ReplyCheck,
  ReplyDeclaration,
  ReplyOption,
  ReplySchema,
  ResolvedReply,
  RespondContext,
  SaveContext,
  StoreSpec,
  UpdateSpec,
} from './hooks.ts';
import type { Column, Model, PublicRow, Row, SoftDeletes } from './model.ts';
import type { Policy } from './policy.ts';
import type { DefaultRules, EmptyRules, IndexRules, ResolvedRules } from './rules.ts';

export type BuiltinAction = 'index' | 'show' | 'store' | 'update' | 'destroy' | 'restore';
export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

/** Hooks as stored at runtime. The engine calls them with the contexts in hooks.ts. */
export interface ActionHooks {
  readonly rules?: (context: { prev: z.ZodType }) => z.ZodType;
  readonly load?: (context: LoadContext<unknown>) => Promise<unknown>;
  readonly authorize?: (
    context: AuthorizeContext<string, unknown, unknown>,
  ) => boolean | Promise<boolean>;
  readonly calculate?: (context: CalculateContext<Model, unknown, unknown>) => unknown;
  readonly save?: (context: SaveContext<Model, unknown>) => Promise<unknown>;
  readonly respond?: (context: RespondContext<Reply, unknown, unknown>) => Reply;
}

declare const rulesType: unique symbol;
declare const replyType: unique symbol;

export interface ActionDefinition<
  Name extends string = string,
  Rules = unknown,
  Out = unknown,
  Method extends HttpMethod = HttpMethod,
> {
  readonly name: Name;
  readonly on: 'collection' | 'member';
  readonly method: Method;
  /** Path below the resource: '', '/:id', '/:id/restore', '/:id/refund', '/quote'. */
  readonly path: string;
  readonly builtin: boolean;
  readonly hooks: ActionHooks;
  /** Action options: `trashed` lets index accept ?trashed=with|only. */
  readonly options: { readonly trashed?: boolean };
  /** The reply schema for OpenAPI, when the action declares one (D14). */
  readonly reply?: ReplyDeclaration;
  /** Type only: the resolved rules schema, for route and RPC types. */
  readonly [rulesType]?: Rules;
  /** Type only: the reply (default or from respond), for route and RPC types. */
  readonly [replyType]?: Out;
}

/** The resolved rules schema of an action definition. */
export type ActionRules<A> = A extends ActionDefinition<string, infer R, unknown> ? R : never;
/** The reply of an action definition: the default, or what its respond hook returns. */
export type ActionReply<A> = A extends ActionDefinition<string, unknown, infer O> ? O : never;

type Public<M extends Model, Hidden extends string> = PublicRow<M, Extract<Hidden, Column<M>>>;

export type { IndexPage } from './hooks.ts';

/**
 * A custom action's HTTP method: what its spec says, or POST. When `method` is omitted TS
 * falls back to the constraint rather than a generic default (D12), hence the conditional.
 */
type MethodOf<Method> = HttpMethod extends Method ? 'post' : Method;

/** A row reply of this resource: the public record, at a status. */
type RowReply<M extends Model, Hidden extends string, Status extends number> = Reply<
  Status,
  Public<M, Hidden>
>;

type PageReply<M extends Model, Hidden extends string> = Reply<200, IndexPage<Public<M, Hidden>>>;

/**
 * The action, or the reason its declared reply does not describe the actual one (D14). The
 * reason is not an ActionDefinition, so blend() rejects the actions list that holds it. The
 * check runs on the return type because the spec's own type is read before R and Result
 * are inferred (see ReplyOption).
 */
type Checked<X, Default, D> =
  D extends ActionDefinition<string, unknown, infer Out>
    ? unknown extends ReplyCheck<X, Out, Default>
      ? D
      : ReplyCheck<X, Out, Default>
    : D;

export type ActionBuilder<M extends Model, Hidden extends string = never> = {
  index<const R extends Reply, const X extends ReplySchema>(
    spec?: IndexSpec<M, R, Hidden> & ReplyOption<X>,
  ): Checked<
    X,
    PageReply<M, Hidden>,
    ActionDefinition<'index', IndexRules, ResolvedReply<R, PageReply<M, Hidden>>, 'get'>
  >;
  show<const R extends Reply, const X extends ReplySchema>(
    spec?: RecordSpec<M, 'show', R, RowReply<M, Hidden, 200>, Hidden> & ReplyOption<X>,
  ): Checked<
    X,
    RowReply<M, Hidden, 200>,
    ActionDefinition<'show', EmptyRules, ResolvedReply<R, RowReply<M, Hidden, 200>>, 'get'>
  >;
  store<S extends z.ZodType, const R extends Reply, const X extends ReplySchema>(
    spec?: StoreSpec<M, S, R, Hidden> & ReplyOption<X>,
  ): Checked<
    X,
    RowReply<M, Hidden, 201>,
    ActionDefinition<
      'store',
      ResolvedRules<S, DefaultRules<M, 'store'>>,
      ResolvedReply<R, RowReply<M, Hidden, 201>>,
      'post'
    >
  >;
  update<S extends z.ZodType, const R extends Reply, const X extends ReplySchema>(
    spec?: UpdateSpec<M, S, R, Hidden> & ReplyOption<X>,
  ): Checked<
    X,
    RowReply<M, Hidden, 200>,
    ActionDefinition<
      'update',
      ResolvedRules<S, DefaultRules<M, 'update'>>,
      ResolvedReply<R, RowReply<M, Hidden, 200>>,
      'patch'
    >
  >;
  destroy<const R extends Reply, const X extends ReplySchema>(
    spec?: RecordSpec<M, 'destroy', R, Reply<204, null>, Hidden> & ReplyOption<X>,
  ): Checked<
    X,
    Reply<204, null>,
    ActionDefinition<'destroy', EmptyRules, ResolvedReply<R, Reply<204, null>>, 'delete'>
  >;
  /** A custom action on one record: `POST /:id/<name>` unless `method` says otherwise. */
  member<
    const N extends string,
    S extends z.ZodType,
    const R extends Reply,
    const Method extends HttpMethod,
    const X extends ReplySchema,
  >(
    name: N,
    spec?: MemberSpec<M, N, S, R, Hidden> & { method?: Method } & ReplyOption<X>,
  ): Checked<
    X,
    RowReply<M, Hidden, 200>,
    ActionDefinition<
      N,
      ResolvedRules<S, EmptyRules>,
      ResolvedReply<R, RowReply<M, Hidden, 200>>,
      MethodOf<Method>
    >
  >;
  /**
   * A custom action on the collection: `POST /<name>` unless `method` says otherwise.
   * Nothing is loaded or saved.
   */
  collection<
    const N extends string,
    S extends z.ZodType,
    Result extends Record<string, unknown>,
    const R extends Reply,
    const Method extends HttpMethod,
    const X extends ReplySchema,
  >(
    name: N,
    spec?: CollectionSpec<M, N, S, Result, R> & { method?: Method } & ReplyOption<X>,
  ): Checked<
    X,
    Reply<200, Result>,
    ActionDefinition<
      N,
      ResolvedRules<S, EmptyRules>,
      ResolvedReply<R, Reply<200, Result>>,
      MethodOf<Method>
    >
  >;
} & (SoftDeletes<M> extends true
  ? {
      restore<const R extends Reply, const X extends ReplySchema>(
        spec?: RecordSpec<M, 'restore', R, RowReply<M, Hidden, 200>, Hidden> & ReplyOption<X>,
      ): Checked<
        X,
        RowReply<M, Hidden, 200>,
        ActionDefinition<'restore', EmptyRules, ResolvedReply<R, RowReply<M, Hidden, 200>>, 'post'>
      >;
    }
  : unknown);

/**
 * Resource-level hooks: the middle of the cascade (schema, app, resource, action). They run
 * for every action of the resource, so each must return the type it receives. Declared as
 * methods so a resource of a concrete model still fits the generic Resource type.
 */
export interface ResourceHooks<M extends Model = Model> {
  rules?<T extends z.ZodType>(context: { prev: T; action: string }): T;
  authorize?(
    context: AuthorizeContext<string, unknown, Row<M> | undefined>,
  ): boolean | Promise<boolean>;
  respond?<R extends Reply>(context: { prev: R; action: string }): R;
}

/** One policy for every action, or a policy per action with an optional default. */
export type PolicySpec<M extends Model> =
  | Policy<M>
  | ({ default?: Policy<M> } & { [action: string]: Policy<M> | undefined });

export interface ResourceSpec<
  M extends Model,
  A extends readonly ActionDefinition[],
  H extends readonly Column<M>[],
> {
  policy: PolicySpec<M>;
  /** Columns never returned in responses (e.g. password). */
  hidden?: H;
  /** Hooks that run for every action of this resource. */
  hooks?: ResourceHooks<M>;
  actions: (a: ActionBuilder<M, H[number]>) => A;
}

export interface Resource<
  M extends Model = Model,
  A extends readonly ActionDefinition[] = readonly ActionDefinition[],
  H extends readonly string[] = readonly string[],
> {
  readonly kind: 'blendx/resource';
  readonly model: M;
  readonly actions: A;
  readonly hidden: H;
  /** The policy of every exposed action, after applying `default`. */
  readonly policies: { readonly [action: string]: Policy<M> };
  readonly hooks: ResourceHooks<M>;
}

/** Thrown when a resource definition is invalid. Surfaces when blends are loaded. */
export class BlendxDefinitionError extends Error {
  constructor(resource: string, message: string) {
    super(`blend(${resource}): ${message}`);
    this.name = 'BlendxDefinitionError';
  }
}

const CUSTOM_NAME = /^[a-z][a-z0-9_]*$/;
const PATH_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;
const BUILTIN: ReadonlySet<string> = new Set<BuiltinAction>([
  'index',
  'show',
  'store',
  'update',
  'destroy',
  'restore',
]);
const HOOK_NAMES = ['rules', 'load', 'authorize', 'calculate', 'save', 'respond'] as const;

type AnySpec = { [K in (typeof HOOK_NAMES)[number]]?: ActionHooks[K] } & {
  method?: HttpMethod;
  path?: string;
  trashed?: boolean;
  reply?: unknown;
};

const isSchema = (value: unknown): value is z.ZodType =>
  typeof value === 'object' && value !== null && '_zod' in value;

/** A declared reply as blend() keeps it (D14), or undefined when it has none or a bad one. */
function replyOf(reply: unknown): ReplyDeclaration | null | undefined {
  if (reply === undefined) return undefined;
  if (isSchema(reply)) return Object.freeze({ schema: reply });
  const { status, body } = (typeof reply === 'object' && reply !== null ? reply : {}) as {
    status?: unknown;
    body?: unknown;
  };
  const success = typeof status === 'number' && Number.isInteger(status) && status >= 200;
  return success && status < 300 && isSchema(body) ? Object.freeze({ status, schema: body }) : null;
}

function define(
  name: string,
  on: ActionDefinition['on'],
  method: HttpMethod,
  path: string,
  builtin: boolean,
  spec: AnySpec = {},
  reply?: ReplyDeclaration,
): ActionDefinition {
  const hooks: Record<string, unknown> = {};
  for (const hook of HOOK_NAMES) {
    if (spec[hook]) hooks[hook] = spec[hook];
  }
  return Object.freeze({
    name,
    on,
    method,
    path,
    builtin,
    hooks: Object.freeze(hooks) as ActionHooks,
    options: Object.freeze(spec.trashed ? { trashed: true } : {}),
    ...(reply ? { reply } : {}),
  });
}

function builderFor(model: Model) {
  const fail = (message: string): never => {
    throw new BlendxDefinitionError(model.name, message);
  };
  /** define(), with the spec's reply checked and normalized. */
  const make = (
    name: string,
    on: ActionDefinition['on'],
    method: HttpMethod,
    path: string,
    builtin: boolean,
    spec?: AnySpec,
  ) => {
    const reply = replyOf(spec?.reply);
    if (reply === null) {
      fail(`action "${name}" has a reply that is neither a zod schema nor { status, body }`);
    }
    return define(name, on, method, path, builtin, spec, reply ?? undefined);
  };
  const custom = (on: ActionDefinition['on'], name: string, spec: AnySpec = {}) => {
    if (BUILTIN.has(name)) fail(`custom action "${name}" reuses a built-in action name`);
    if (!CUSTOM_NAME.test(name)) {
      fail(`custom action "${name}" must be lowercase letters, digits and _`);
    }
    const segment = spec.path ?? name;
    if (!PATH_SEGMENT.test(segment)) {
      fail(`custom action "${name}" has an invalid path "${segment}"`);
    }
    return make(
      name,
      on,
      spec.method ?? 'post',
      on === 'member' ? `/:id/${segment}` : `/${segment}`,
      false,
      spec,
    );
  };
  return {
    index: (spec?: AnySpec) => {
      if (spec?.trashed && model.meta.softDelete === null) {
        fail('trashed needs a soft-delete table (a nullable deleted_at timestamp)');
      }
      return make('index', 'collection', 'get', '', true, spec);
    },
    show: (spec?: AnySpec) => make('show', 'member', 'get', '/:id', true, spec),
    store: (spec?: AnySpec) => make('store', 'collection', 'post', '', true, spec),
    update: (spec?: AnySpec) => make('update', 'member', 'patch', '/:id', true, spec),
    destroy: (spec?: AnySpec) => make('destroy', 'member', 'delete', '/:id', true, spec),
    restore: (spec?: AnySpec) => {
      if (model.meta.softDelete === null) {
        fail('restore needs a soft-delete table (a nullable deleted_at timestamp)');
      }
      return make('restore', 'member', 'post', '/:id/restore', true, spec);
    },
    member: (name: string, spec?: AnySpec) => custom('member', name, spec),
    collection: (name: string, spec?: AnySpec) => custom('collection', name, spec),
  };
}

const isPolicy = (value: unknown): value is Policy =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Policy).check === 'function' &&
  typeof (value as Policy).kind === 'string';

/**
 * Declares a resource: the model, its policy, hidden columns and exposed actions.
 * M is inferred from `model` only: a generic policy like `allow.public` would otherwise
 * widen it to Model and erase the table's column types.
 */
export function blend<
  M extends Model,
  A extends readonly ActionDefinition[],
  const H extends readonly Column<M>[] = [],
>(model: M, spec: ResourceSpec<NoInfer<M>, A, H>): Resource<M, A, H> {
  const fail = (message: string): never => {
    throw new BlendxDefinitionError(model.name, message);
  };

  const actions = spec.actions(builderFor(model) as unknown as ActionBuilder<M, H[number]>);
  const seen = new Set<string>();
  for (const action of actions) {
    if (seen.has(action.name)) fail(`action "${action.name}" is listed twice`);
    seen.add(action.name);
  }

  const policies: Record<string, Policy<M>> = {};
  const policy = spec.policy;
  for (const action of actions) {
    const chosen = isPolicy(policy) ? policy : (policy[action.name] ?? policy.default);
    if (!chosen) fail(`action "${action.name}" has no policy; add it or a default`);
    else policies[action.name] = chosen;
  }
  if (!isPolicy(policy)) {
    for (const key of Object.keys(policy)) {
      if (key !== 'default' && !seen.has(key)) fail(`policy for "${key}", which is not an action`);
    }
  }

  const hidden = spec.hidden ?? ([] as unknown as H);
  const columns = new Set(Object.keys(getTableColumns(model.table)));
  for (const column of hidden) {
    if (!columns.has(column)) fail(`hidden column "${column}" is not a column of ${model.name}`);
  }

  return Object.freeze({
    kind: 'blendx/resource',
    model,
    actions,
    hidden,
    policies: Object.freeze(policies),
    hooks: Object.freeze({ ...spec.hooks }),
  });
}
