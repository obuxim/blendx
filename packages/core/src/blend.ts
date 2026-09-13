/**
 * blend(): declares a resource. The actions callback returns the exposed actions, one
 * call per action, which is how `calculate` gets its input type from `rules`
 * (docs/decisions.md D12). Nothing is exposed unless it is listed, and every listed
 * action needs a policy (default-deny).
 */
import { getColumns } from 'drizzle-orm';
import type { z } from 'zod';
import { saves } from './engine.ts';
import type {
  AfterContext,
  AuthorizeContext,
  CalculateContext,
  CollectionSpec,
  IndexPage,
  IndexSpec,
  LaterContext,
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
import type {
  Column,
  Model,
  PublicRow,
  Relation,
  RelationTable,
  Row,
  SoftDeletes,
} from './model.ts';
import type { Policy } from './policy.ts';
import { relationsOf } from './relations.ts';
import type { DefaultRules, EmptyRules, IncludeRules, IndexRules, ResolvedRules } from './rules.ts';

export type BuiltinAction = 'index' | 'show' | 'store' | 'update' | 'destroy' | 'restore' | 'purge';
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
  /** Actions that write only: runs once the write has committed (D26). */
  readonly after?: (context: AfterContext<Model, unknown, unknown>) => unknown;
  /** Actions that write only: run from the outbox, at least once (D27). */
  readonly later?: (context: LaterContext<Model, unknown, unknown>) => unknown;
  /** index only: the column values the listing is limited to, from the identity (D22). */
  readonly scope?: (context: { auth: unknown }) => Readonly<Record<string, unknown>>;
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
  /** Path below the resource: '', '/:id', '/:id/restore', '/:id/purge', '/:id/refund', '/quote'. */
  readonly path: string;
  readonly builtin: boolean;
  readonly hooks: ActionHooks;
  /**
   * Action options: `trashed` lets index accept ?trashed=with|only; `reveal` names the
   * hidden columns the action's reply carries (D24).
   */
  readonly options: { readonly trashed?: boolean; readonly reveal?: readonly string[] };
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

/** `reveal` on an action that replies with one record: hidden columns its reply carries (D24). */
type RevealOption<V> = { reveal?: V };

/**
 * The hidden columns an action's reply still leaves out: every one, unless it reveals some.
 * When `reveal` is omitted TS falls back to V's constraint (D12), hence the conditional.
 */
type StillHidden<Hidden extends string, V> = readonly Hidden[] extends V
  ? Hidden
  : Exclude<Hidden, V extends readonly (infer Revealed)[] ? Revealed : never>;

/** A row reply of this resource: the public record, at a status. */
type RowReply<
  M extends Model,
  Hidden extends string,
  Status extends number,
  Extra = unknown,
> = Reply<Status, Public<M, Hidden> & Extra>;

type PageReply<M extends Model, Hidden extends string, Extra = unknown> = Reply<
  200,
  IndexPage<Public<M, Hidden> & Extra>
>;

/** A target blend's public record (D28): its columns, minus its hidden ones. */
type IncludedRow<T> =
  T extends Resource<infer TM, readonly ActionDefinition[], infer TH>
    ? PublicRow<TM, Extract<TH[number], Column<TM>>>
    : never;

/** What `?include=` may add to a record of index or show: each include's record, or null (D28). */
export type Included<I> = [keyof I] extends [never]
  ? unknown
  : { [K in keyof I]?: IncludedRow<I[K]> | null };

/** show's rules: an empty object, or `?include=` when the blend declares includes (D28). */
type ShowRules<I> = [keyof I] extends [never] ? EmptyRules : IncludeRules;

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

export type ActionBuilder<
  M extends Model,
  Hidden extends string = never,
  I = Record<never, never>,
> = {
  index<const R extends Reply, const X extends ReplySchema>(
    spec?: IndexSpec<M, R, Hidden, Included<I>> & ReplyOption<X>,
  ): Checked<
    X,
    PageReply<M, Hidden, Included<I>>,
    ActionDefinition<
      'index',
      IndexRules,
      ResolvedReply<R, PageReply<M, Hidden, Included<I>>>,
      'get'
    >
  >;
  show<const R extends Reply, const X extends ReplySchema, const V extends readonly Hidden[]>(
    spec?: RecordSpec<
      M,
      'show',
      R,
      RowReply<M, StillHidden<Hidden, V>, 200, Included<I>>,
      StillHidden<Hidden, V>,
      Included<I>
    > &
      ReplyOption<X> &
      RevealOption<V>,
  ): Checked<
    X,
    RowReply<M, StillHidden<Hidden, V>, 200, Included<I>>,
    ActionDefinition<
      'show',
      ShowRules<I>,
      ResolvedReply<R, RowReply<M, StillHidden<Hidden, V>, 200, Included<I>>>,
      'get'
    >
  >;
  store<
    S extends z.ZodType,
    const R extends Reply,
    const X extends ReplySchema,
    const V extends readonly Hidden[],
  >(
    spec?: StoreSpec<M, S, R, StillHidden<Hidden, V>> & ReplyOption<X> & RevealOption<V>,
  ): Checked<
    X,
    RowReply<M, StillHidden<Hidden, V>, 201>,
    ActionDefinition<
      'store',
      ResolvedRules<S, DefaultRules<M, 'store'>>,
      ResolvedReply<R, RowReply<M, StillHidden<Hidden, V>, 201>>,
      'post'
    >
  >;
  update<
    S extends z.ZodType,
    const R extends Reply,
    const X extends ReplySchema,
    const V extends readonly Hidden[],
  >(
    spec?: UpdateSpec<M, S, R, StillHidden<Hidden, V>> & ReplyOption<X> & RevealOption<V>,
  ): Checked<
    X,
    RowReply<M, StillHidden<Hidden, V>, 200>,
    ActionDefinition<
      'update',
      ResolvedRules<S, DefaultRules<M, 'update'>>,
      ResolvedReply<R, RowReply<M, StillHidden<Hidden, V>, 200>>,
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
    const V extends readonly Hidden[],
  >(
    name: N,
    spec?: MemberSpec<M, N, S, R, StillHidden<Hidden, V>> & {
      method?: Method;
    } & ReplyOption<X> &
      RevealOption<V>,
  ): Checked<
    X,
    RowReply<M, StillHidden<Hidden, V>, 200>,
    ActionDefinition<
      N,
      ResolvedRules<S, EmptyRules>,
      ResolvedReply<R, RowReply<M, StillHidden<Hidden, V>, 200>>,
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
      restore<
        const R extends Reply,
        const X extends ReplySchema,
        const V extends readonly Hidden[],
      >(
        spec?: RecordSpec<
          M,
          'restore',
          R,
          RowReply<M, StillHidden<Hidden, V>, 200>,
          StillHidden<Hidden, V>
        > &
          ReplyOption<X> &
          RevealOption<V>,
      ): Checked<
        X,
        RowReply<M, StillHidden<Hidden, V>, 200>,
        ActionDefinition<
          'restore',
          EmptyRules,
          ResolvedReply<R, RowReply<M, StillHidden<Hidden, V>, 200>>,
          'post'
        >
      >;
      /** Deletes the row for good, soft-deleted or not: `DELETE /:id/purge`, 204 (D29). */
      purge<const R extends Reply, const X extends ReplySchema>(
        spec?: RecordSpec<M, 'purge', R, Reply<204, null>, Hidden> & ReplyOption<X>,
      ): Checked<
        X,
        Reply<204, null>,
        ActionDefinition<'purge', EmptyRules, ResolvedReply<R, Reply<204, null>>, 'delete'>
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
  /** After each write of this resource commits, before the action's own after (D26). */
  after?(context: AfterContext<M, Row<M> | undefined, unknown> & { action: string }): unknown;
  /** From the outbox, for each write of this resource (D27). */
  later?(context: LaterContext<M, Row<M> | undefined, unknown> & { action: string }): unknown;
}

/** One policy for every action, or a policy per action with an optional default. */
export type PolicySpec<M extends Model> =
  | Policy<M>
  | ({ default?: Policy<M> } & { [action: string]: Policy<M> | undefined });

/** A blend of the table a relation points to (D28). */
export type IncludeTarget<M extends Model, R extends string> = Resource<
  Model & { readonly name: RelationTable<M, R> }
>;

/** What `?include=` may nest: relations of the table, each through a blend of its target (D28). */
export type IncludesSpec<M extends Model> = { readonly [R in Relation<M>]?: IncludeTarget<M, R> };

export interface ResourceSpec<
  M extends Model,
  A extends readonly ActionDefinition[],
  H extends readonly Column<M>[],
  I extends IncludesSpec<M> = Record<never, never>,
> {
  policy: PolicySpec<M>;
  /** Columns never returned in responses (e.g. password), unless an action reveals them. */
  hidden?: H;
  /** The rows `?include=` may nest, each through its target blend's show (D28). */
  includes?: I & { readonly [K in Exclude<keyof I, Relation<M>>]: never };
  /** Hooks that run for every action of this resource. */
  hooks?: ResourceHooks<M>;
  actions: (a: ActionBuilder<M, H[number], I>) => A;
}

export interface Resource<
  M extends Model = Model,
  A extends readonly ActionDefinition[] = readonly ActionDefinition[],
  H extends readonly string[] = readonly string[],
  I extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
  readonly kind: 'blendx/resource';
  readonly model: M;
  readonly actions: A;
  readonly hidden: H;
  /** The policy of every exposed action, after applying `default`. */
  readonly policies: { readonly [action: string]: Policy<M> };
  readonly hooks: ResourceHooks<M>;
  /** What `?include=` may nest, by relation name, each a blend of its target (D28). */
  readonly includes: I;
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
  'purge',
]);
/** The hooks an action spec may hold: one per stage, and an index's scope (D22). */
const HOOK_NAMES = [
  'rules',
  'load',
  'authorize',
  'calculate',
  'save',
  'later',
  'after',
  'respond',
  'scope',
] as const;

type AnySpec = { [K in (typeof HOOK_NAMES)[number]]?: ActionHooks[K] } & {
  method?: HttpMethod;
  path?: string;
  trashed?: boolean;
  reveal?: readonly string[];
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
    options: Object.freeze({
      ...(spec.trashed ? { trashed: true } : {}),
      ...(spec.reveal ? { reveal: Object.freeze([...spec.reveal]) } : {}),
    }),
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
    for (const hook of ['after', 'later'] as const) {
      if (spec?.[hook] !== undefined && !saves({ on, action: name })) {
        fail(`${name} writes nothing, so it has no ${hook}`);
      }
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
      if (spec?.scope !== undefined && typeof spec.scope !== 'function') {
        fail('scope must be a function of the identity');
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
    purge: (spec?: AnySpec) => {
      if (model.meta.softDelete === null) {
        fail(
          'purge needs a soft-delete table (a nullable deleted_at timestamp); destroy already deletes for good',
        );
      }
      return make('purge', 'member', 'delete', '/:id/purge', true, spec);
    },
    member: (name: string, spec?: AnySpec) => custom('member', name, spec),
    collection: (name: string, spec?: AnySpec) => custom('collection', name, spec),
  };
}

const isResource = (value: unknown): value is Resource =>
  typeof value === 'object' && value !== null && (value as Resource).kind === 'blendx/resource';

const isPolicy = (value: unknown): value is Policy =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Policy).check === 'function' &&
  typeof (value as Policy).kind === 'string';

/** Replies with one record: store, and member actions other than destroy and purge (D24). */
const repliesWithOneRecord = (action: ActionDefinition) =>
  action.on === 'member'
    ? !(action.builtin && (action.name === 'destroy' || action.name === 'purge'))
    : action.name === 'store';

/**
 * Declares a resource: the model, its policy, hidden columns and exposed actions.
 * M is inferred from `model` only: a generic policy like `allow.public` would otherwise
 * widen it to Model and erase the table's column types.
 */
export function blend<
  M extends Model,
  A extends readonly ActionDefinition[],
  const H extends readonly Column<M>[] = [],
  const I extends IncludesSpec<M> = Record<never, never>,
>(model: M, spec: ResourceSpec<NoInfer<M>, A, H, I>): Resource<M, A, H, I> {
  const fail = (message: string): never => {
    throw new BlendxDefinitionError(model.name, message);
  };

  const actions = spec.actions(builderFor(model) as unknown as ActionBuilder<M, H[number], I>);
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
  const columns = new Set(Object.keys(getColumns(model.table)));
  for (const column of hidden) {
    if (!columns.has(column)) fail(`hidden column "${column}" is not a column of ${model.name}`);
  }

  // D28: each include is a relation of the table, through a blend of its target with a show.
  const relations = relationsOf(model);
  const includes = (spec.includes ?? {}) as Readonly<Record<string, unknown>>;
  for (const [name, target] of Object.entries(includes)) {
    const relation = relations.get(name);
    const show = isResource(target)
      ? target.actions.find((action) => action.name === 'show')
      : undefined;
    if (!relation) {
      const known = [...relations.keys()].join(', ') || 'none';
      fail(`include "${name}" is not a relation of ${model.name} (its relations: ${known})`);
    } else if (columns.has(name)) {
      fail(`include "${name}" has the name of a column of ${model.name}`);
    } else if (!isResource(target)) {
      fail(`include "${name}" is not a blend; two blends cannot include each other (D28)`);
    } else if (target.model.name !== relation.table) {
      fail(`include "${name}" points to ${relation.table}, not to ${target.model.name}`);
    } else if (!show) {
      fail(
        `include "${name}": ${relation.table} does not expose show, which decides who sees its rows`,
      );
    } else if (show.hooks.load) {
      fail(
        `include "${name}": the show of ${relation.table} has a load hook, which an include cannot run`,
      );
    }
  }

  // D24: an action reveals hidden columns, and only in a reply that holds one record.
  for (const action of actions) {
    const reveal = action.options.reveal ?? [];
    if (reveal.length === 0) continue;
    if (!repliesWithOneRecord(action)) {
      fail(`action "${action.name}" cannot reveal: it does not reply with one record`);
    }
    for (const column of reveal) {
      if (!(hidden as readonly string[]).includes(column)) {
        fail(`action "${action.name}" reveals "${column}", which is not hidden`);
      }
    }
  }

  return Object.freeze({
    kind: 'blendx/resource',
    model,
    actions,
    hidden,
    policies: Object.freeze(policies),
    hooks: Object.freeze({ ...spec.hooks }),
    includes: Object.freeze({ ...includes }) as I,
  });
}
