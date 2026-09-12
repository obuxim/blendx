/**
 * blend(): declares a resource. The actions callback returns the exposed actions, one
 * call per action, which is how `calculate` gets its input type from `rules`
 * (docs/decisions.md D12). Nothing is exposed unless it is listed, and every listed
 * action needs a policy (default-deny).
 */
import { getTableColumns } from 'drizzle-orm';
import type { z } from 'zod';
import type { Column, Model, Row, SoftDeletes, Writes } from './model.ts';
import type { Policy } from './policy.ts';
import type { DefaultRules, EmptyRules, ResolvedRules } from './rules.ts';

export type BuiltinAction = 'index' | 'show' | 'store' | 'update' | 'destroy' | 'restore';
export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

/** Hooks as stored at runtime. P3.4 adds load, authorize, save and respond. */
export interface ActionHooks {
  readonly rules?: (context: { prev: z.ZodType }) => z.ZodType;
  readonly calculate?: (context: { input: unknown; record: unknown }) => unknown;
}

declare const rulesType: unique symbol;

export interface ActionDefinition<Name extends string = string, Rules = unknown> {
  readonly name: Name;
  readonly on: 'collection' | 'member';
  readonly method: HttpMethod;
  /** Path below the resource: '', '/:id', '/:id/restore', '/:id/refund', '/quote'. */
  readonly path: string;
  readonly builtin: boolean;
  readonly hooks: ActionHooks;
  /** Type only: the resolved rules schema, carried for route and RPC types. */
  readonly [rulesType]?: Rules;
}

export interface HookSpec<
  M extends Model,
  Action extends string,
  S extends z.ZodType,
  Rec,
  Result = Writes<M>,
> {
  /** Receives the action's default rules and returns the rules to validate with. */
  rules?: (context: { prev: DefaultRules<M, Action> }) => S;
  /** Pure and synchronous: validated input (and the loaded record) in, values out. */
  calculate?: (context: {
    input: z.output<ResolvedRules<S, DefaultRules<M, Action>>>;
    record: Rec;
  }) => Result;
}

export interface CustomSpec<M extends Model, Name extends string, S extends z.ZodType, Rec, Result>
  extends HookSpec<M, Name, S, Rec, Result> {
  /** Defaults to 'post'. */
  method?: HttpMethod;
  /** Path segment; defaults to the action name. */
  path?: string;
}

export type ActionBuilder<M extends Model> = {
  index(): ActionDefinition<'index', EmptyRules>;
  show(): ActionDefinition<'show', EmptyRules>;
  store<S extends z.ZodType>(
    spec?: HookSpec<M, 'store', S, undefined>,
  ): ActionDefinition<'store', ResolvedRules<S, DefaultRules<M, 'store'>>>;
  update<S extends z.ZodType>(
    spec?: HookSpec<M, 'update', S, Row<M>>,
  ): ActionDefinition<'update', ResolvedRules<S, DefaultRules<M, 'update'>>>;
  destroy(): ActionDefinition<'destroy', EmptyRules>;
  /** A custom action on one record: `POST /:id/<name>` by default. */
  member<const N extends string, S extends z.ZodType>(
    name: N,
    spec?: CustomSpec<M, N, S, Row<M>, Writes<M>>,
  ): ActionDefinition<N, ResolvedRules<S, EmptyRules>>;
  /** A custom action on the collection: `POST /<name>` by default. Nothing is saved. */
  collection<const N extends string, S extends z.ZodType>(
    name: N,
    spec?: CustomSpec<M, N, S, undefined, Record<string, unknown>>,
  ): ActionDefinition<N, ResolvedRules<S, EmptyRules>>;
} & (SoftDeletes<M> extends true
  ? { restore(): ActionDefinition<'restore', EmptyRules> }
  : unknown);

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
  actions: (a: ActionBuilder<M>) => A;
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

type AnySpec = {
  rules?: ActionHooks['rules'];
  calculate?: ActionHooks['calculate'];
  method?: HttpMethod;
  path?: string;
};

function define(
  name: string,
  on: ActionDefinition['on'],
  method: HttpMethod,
  path: string,
  builtin: boolean,
  spec: AnySpec = {},
): ActionDefinition {
  const hooks: ActionHooks = {
    ...(spec.rules ? { rules: spec.rules } : {}),
    ...(spec.calculate ? { calculate: spec.calculate } : {}),
  };
  return Object.freeze({ name, on, method, path, builtin, hooks: Object.freeze(hooks) });
}

function builderFor(model: Model) {
  const fail = (message: string) => {
    throw new BlendxDefinitionError(model.name, message);
  };
  const custom = (on: ActionDefinition['on'], name: string, spec: AnySpec = {}) => {
    if (BUILTIN.has(name)) fail(`custom action "${name}" reuses a built-in action name`);
    if (!CUSTOM_NAME.test(name)) {
      fail(`custom action "${name}" must be lowercase letters, digits and _`);
    }
    const segment = spec.path ?? name;
    if (!PATH_SEGMENT.test(segment))
      fail(`custom action "${name}" has an invalid path "${segment}"`);
    return define(
      name,
      on,
      spec.method ?? 'post',
      on === 'member' ? `/:id/${segment}` : `/${segment}`,
      false,
      spec,
    );
  };
  return {
    index: () => define('index', 'collection', 'get', '', true),
    show: () => define('show', 'member', 'get', '/:id', true),
    store: (spec?: AnySpec) => define('store', 'collection', 'post', '', true, spec),
    update: (spec?: AnySpec) => define('update', 'member', 'patch', '/:id', true, spec),
    destroy: () => define('destroy', 'member', 'delete', '/:id', true),
    restore: () => {
      if (model.meta.softDelete === null) {
        fail('restore needs a soft-delete table (a nullable deleted_at timestamp)');
      }
      return define('restore', 'member', 'post', '/:id/restore', true);
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

  const actions = spec.actions(builderFor(model) as unknown as ActionBuilder<M>);
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
  });
}
