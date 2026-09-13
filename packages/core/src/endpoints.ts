/**
 * Endpoint definitions: the flat, runtime view of a resource that the route generator,
 * the OpenAPI builder and the review step read. The order is fixed, whatever order the
 * actions were listed in.
 */
import type {
  ActionDefinition,
  ActionHooks,
  HttpMethod,
  Resource,
  ResourceHooks,
} from './blend.ts';
import { type HasManySpec, isHasMany } from './blend.ts';
import type { ReplyDeclaration } from './hooks.ts';
import type { Model } from './model.ts';
import type { Policy } from './policy.ts';
import { foreignKeysTo, relationsOf } from './relations.ts';

/**
 * What `?include=<name>` nests, as the engine and the generators read it: a belongs-to (D28),
 * the row the foreign key `column` of this table points to; or a has-many (D31), the rows of
 * the target whose `column` points here, at most `limit` per row, in `sort` order.
 */
export type IncludeDefinition =
  | { readonly kind: 'belongsTo'; readonly column: string; readonly target: Resource }
  | {
      readonly kind: 'hasMany';
      readonly column: string;
      readonly target: Resource;
      readonly limit: number;
      readonly sort: { readonly column: string; readonly descending: boolean };
    };

/** A resource's includes resolved (D28, D31); blend() has checked them. */
export function resolveIncludes(resource: Resource): Readonly<Record<string, IncludeDefinition>> {
  const relations = relationsOf(resource.model);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(resource.includes ?? {}).map(([name, value]): [string, IncludeDefinition] => {
        if (isHasMany(value)) {
          const { blend: target, by, limit, sort } = value as HasManySpec;
          const column = by ?? foreignKeysTo(target.model, resource.model.name)[0] ?? '';
          const descending = sort?.startsWith('-') ?? false;
          const orderBy = sort ? sort.replace(/^-/, '') : (target.model.meta.primaryKey ?? '');
          return [
            name,
            Object.freeze({
              kind: 'hasMany',
              column,
              target,
              limit,
              sort: Object.freeze({ column: orderBy, descending }),
            }),
          ];
        }
        return [
          name,
          Object.freeze({
            kind: 'belongsTo',
            column: relations.get(name)?.column ?? `${name}_id`,
            target: value as Resource,
          }),
        ];
      }),
    ),
  );
}

export interface EndpointDefinition {
  /** `<table>.<action>`: a stable id for OpenAPI operation ids, review files and logs. */
  readonly id: string;
  readonly resource: string;
  readonly action: string;
  readonly method: HttpMethod;
  /** The full path: /orders, /orders/:id, /orders/:id/refund, /orders/quote. */
  readonly path: string;
  readonly on: 'collection' | 'member';
  readonly builtin: boolean;
  readonly model: Model;
  readonly policy: Policy;
  /** Columns this action's replies leave out: the hidden ones, minus any it reveals (D24). */
  readonly hidden: readonly string[];
  /** The hidden columns this action's reply carries (D24), when it reveals any. */
  readonly revealed?: readonly string[];
  /** index only: accepts ?trashed=with|only. */
  readonly trashed: boolean;
  /** The action's own hooks. */
  readonly hooks: ActionHooks;
  /** The resource-level hooks, shared by every action of the resource. */
  readonly resourceHooks: ResourceHooks;
  /** The reply schema the action declares for OpenAPI (D14), if any. */
  readonly reply?: ReplyDeclaration;
  /** index and show: what `?include=` may nest, by relation name (D28). Empty elsewhere. */
  readonly includes: Readonly<Record<string, IncludeDefinition>>;
}

const BUILTIN_ORDER = ['index', 'store', 'show', 'update', 'destroy', 'restore', 'purge'];

/** The status of the default reply: 201 for store, 204 for destroy and purge, 200 otherwise. */
export function defaultStatus(endpoint: Pick<EndpointDefinition, 'action' | 'builtin'>): number {
  if (!endpoint.builtin) return 200;
  if (endpoint.action === 'store') return 201;
  return endpoint.action === 'destroy' || endpoint.action === 'purge' ? 204 : 200;
}

/**
 * Collection routes come first, so /orders/quote is not swallowed by /orders/:id.
 * Built-in actions keep a fixed order; custom actions sort by name.
 */
function rank(action: ActionDefinition): [group: number, position: number, name: string] {
  const group = (action.on === 'collection' ? 0 : 2) + (action.builtin ? 0 : 1);
  return [group, action.builtin ? BUILTIN_ORDER.indexOf(action.name) : 0, action.name];
}

function byRank(a: ActionDefinition, b: ActionDefinition): number {
  const [ga, pa, na] = rank(a);
  const [gb, pb, nb] = rank(b);
  return ga - gb || pa - pb || (na < nb ? -1 : na > nb ? 1 : 0);
}

/** The endpoints of one resource, in route order. */
export function toEndpoints(resource: Resource): EndpointDefinition[] {
  const { model, hidden, policies } = resource;
  const includes = resolveIncludes(resource);
  const reads = (action: ActionDefinition) =>
    action.builtin && (action.name === 'index' || action.name === 'show');
  return [...resource.actions].sort(byRank).map((action) => {
    const policy = policies[action.name];
    if (!policy) throw new Error(`${model.name}.${action.name} has no policy`);
    const revealed = action.options?.reveal?.length ? action.options.reveal : undefined;
    return Object.freeze({
      id: `${model.name}.${action.name}`,
      resource: model.name,
      action: action.name,
      method: action.method,
      path: `/${model.name}${action.path}`,
      on: action.on,
      builtin: action.builtin,
      model,
      policy,
      // D24: a reply leaves out the hidden columns, minus those the action reveals.
      hidden: revealed ? hidden.filter((column) => !revealed.includes(column)) : hidden,
      ...(revealed ? { revealed } : {}),
      trashed: action.options?.trashed === true,
      hooks: action.hooks,
      resourceHooks: resource.hooks as ResourceHooks,
      ...(action.reply ? { reply: action.reply } : {}),
      // D28: only index and show take ?include=.
      includes: reads(action) ? includes : {},
    });
  });
}
