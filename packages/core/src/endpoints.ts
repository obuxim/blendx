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
import type { Model } from './model.ts';
import type { Policy } from './policy.ts';

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
  readonly hidden: readonly string[];
  /** index only: accepts ?trashed=with|only. */
  readonly trashed: boolean;
  /** The action's own hooks. */
  readonly hooks: ActionHooks;
  /** The resource-level hooks, shared by every action of the resource. */
  readonly resourceHooks: ResourceHooks;
}

const BUILTIN_ORDER = ['index', 'store', 'show', 'update', 'destroy', 'restore'];

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
  return [...resource.actions].sort(byRank).map((action) => {
    const policy = policies[action.name];
    if (!policy) throw new Error(`${model.name}.${action.name} has no policy`);
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
      hidden,
      trashed: action.options?.trashed === true,
      hooks: action.hooks,
      resourceHooks: resource.hooks as ResourceHooks,
    });
  });
}
