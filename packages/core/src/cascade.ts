/**
 * The hook cascade (docs/decisions.md D3). Every stage starts from the schema default,
 * then the app, resource and action hooks run in that order, each receiving the result
 * of the level above. Value stages (rules, authorize, calculate, respond) pass `prev`;
 * effect stages (load, save) pass `runDefault`. after (D26) is neither: it has no default,
 * so every level's hook runs, and none replaces another. Provenance records which levels
 * shaped each stage, for the review YAML.
 */
import { z } from 'zod';
import type { App, RegisteredAuth } from './app.ts';
import { defaultRules } from './derive-rules.ts';
import type { EndpointDefinition } from './endpoints.ts';
import { toEndpoints } from './endpoints.ts';
import { defaultEffects, saves } from './engine.ts';
import type { Db, Reply } from './hooks.ts';

export type Level = 'schema' | 'app' | 'resource' | 'action';
export type Stage =
  | 'rules'
  | 'load'
  | 'authorize'
  | 'calculate'
  | 'save'
  | 'later'
  | 'after'
  | 'respond';
export const STAGES: readonly Stage[] = [
  'rules',
  'load',
  'authorize',
  'calculate',
  'save',
  'later',
  'after',
  'respond',
];

/** The stages only actions that write have (D26, D27). */
const COMMIT_STAGES: ReadonlySet<string> = new Set(['later', 'after']);

type Auth = RegisteredAuth | null;

export interface LoadInput {
  db: Db;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  /** The validated input (for index: the parsed query). */
  input: unknown;
  auth: Auth;
  /** True when the action will write: load the row FOR UPDATE. */
  lock?: boolean;
}

export interface SaveInput {
  tx: Db;
  writes: Record<string, unknown>;
  record: unknown;
  auth: Auth;
}

/** What after receives, once the write has committed (D26). */
export interface AfterInput {
  /** The database, outside the committed transaction. */
  db: Db;
  saved: unknown;
  record: unknown;
  input: unknown;
  auth: Auth;
}

/** What a later hook receives from the worker (D27): the stored context, db, its id and attempt. */
export interface LaterInput extends AfterInput {
  id: number;
  attempt: number;
}

/** An include (D28): the foreign key column, and the target's show that decides each row. */
export interface IncludedTarget {
  readonly column: string;
  readonly show: ResolvedEndpoint;
}

/** The engine's schema-level load and save for one endpoint. */
export interface EffectDefaults {
  load(context: LoadInput): Promise<unknown>;
  save(context: SaveInput): Promise<unknown>;
}

export interface ResolvedEndpoint extends EndpointDefinition {
  /** The rules to validate with: the default, then app, resource and action rules. */
  readonly rules: z.ZodType;
  /** Which levels shaped each stage, in cascade order. */
  readonly provenance: Readonly<Record<Stage, readonly Level[]>>;
  /** From the policy: a request without an identity gets 401 before validation. */
  readonly requiresAuth: boolean;
  /** index and show: each include's target, as its show runs for GET /<table>/:id (D28). */
  readonly included: Readonly<Record<string, IncludedTarget>>;
  load(context: LoadInput): Promise<unknown>;
  authorize(context: { auth: Auth; record: unknown; input: unknown }): Promise<boolean>;
  /** `prev` is the schema default: the validated input's writable columns. */
  calculate(context: { prev: Record<string, unknown>; input: unknown; record: unknown }): unknown;
  save(context: SaveInput): Promise<unknown>;
  /** Every level's after hook, in order, for an action that writes; `report` gets what one throws. */
  after(context: AfterInput, report: (error: unknown) => void): Promise<void>;
  /** The later hook an outbox entry names by its level (D27), or undefined when there is none. */
  laterAt(level: Level): ((context: LaterInput) => Promise<unknown>) | undefined;
  /** `prev` is the schema default reply. */
  respond(context: { prev: Reply; record: unknown; result: unknown }): Reply;
}

/**
 * Unknown request keys are rejected (D4). A plain z.object from a rules hook strips them
 * silently, so it is made strict; `.loose()` is the explicit way to accept them.
 */
function strictByDefault(rules: z.ZodType): z.ZodType {
  return rules instanceof z.ZodObject && rules.def.catchall === undefined ? rules.strict() : rules;
}

/** Composes an endpoint's stages across the app, resource and action levels. */
export function resolveEndpoint(
  endpoint: EndpointDefinition,
  options: { app: App; defaults: EffectDefaults },
): ResolvedEndpoint {
  const { app, defaults } = options;
  const { model, action } = endpoint;
  const appHooks = app.spec.hooks ?? {};
  const resourceHooks = endpoint.resourceHooks;
  const actionHooks = endpoint.hooks;

  const writes = saves(endpoint);
  // App and resource later and after hooks run only for actions that write (D26, D27).
  const has = (hooks: object, name: string) =>
    typeof (hooks as Record<string, unknown>)[name] === 'function' &&
    (!COMMIT_STAGES.has(name) || writes);
  // An index's scope shapes its load at the action level, as a load hook would (D22).
  const byAction = (stage: Stage) =>
    has(actionHooks, stage) || (stage === 'load' && has(actionHooks, 'scope'));
  const provenance = Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      Object.freeze([
        'schema',
        ...(has(appHooks, stage) ? ['app'] : []),
        ...(has(resourceHooks, stage) ? ['resource'] : []),
        ...(byAction(stage) ? ['action'] : []),
      ]),
    ]),
  ) as Record<Stage, readonly Level[]>;

  let rules: z.ZodType = defaultRules(
    model,
    { name: action, builtin: endpoint.builtin },
    {
      hidden: endpoint.hidden,
      maxPerPage: app.index.maxPerPage,
      trashed: endpoint.trashed,
      includes: Object.keys(endpoint.includes ?? {}),
    },
  );
  if (appHooks.rules) rules = appHooks.rules({ prev: rules, model, action });
  if (resourceHooks.rules) rules = resourceHooks.rules({ prev: rules, action });
  if (actionHooks.rules) rules = actionHooks.rules({ prev: rules });
  rules = strictByDefault(rules);

  // D28: each include's target show, with this app, as it answers GET /<table>/:id.
  const included = Object.freeze(
    Object.fromEntries(
      Object.entries(endpoint.includes ?? {}).map(([name, { column, target }]) => {
        const show = toEndpoints(target).find((definition) => definition.action === 'show');
        if (!show) throw new Error(`${model.name}: include "${name}" has no show to go through`);
        const resolved = resolveEndpoint(show, { app, defaults: defaultEffects(show) });
        return [name, Object.freeze({ column, show: resolved })];
      }),
    ),
  );

  return Object.freeze({
    ...endpoint,
    rules,
    provenance: Object.freeze(provenance),
    requiresAuth: endpoint.policy.requiresAuth,
    included,

    load: (context: LoadInput) => {
      const runDefault = () => defaults.load(context);
      return actionHooks.load
        ? actionHooks.load({ ...context, lock: context.lock === true, runDefault })
        : runDefault();
    },

    authorize: async ({ auth, record, input }: { auth: Auth; record: unknown; input: unknown }) => {
      let allowed = await endpoint.policy.check({ auth, record, input, action } as never);
      if (appHooks.authorize)
        allowed = await appHooks.authorize({ prev: allowed, auth, model, action });
      const context = { auth, record, input, action } as never as { record: undefined };
      if (resourceHooks.authorize) {
        allowed = await resourceHooks.authorize({ ...context, prev: allowed } as never);
      }
      if (actionHooks.authorize) {
        allowed = await actionHooks.authorize({ ...context, prev: allowed } as never);
      }
      return allowed;
    },

    calculate: (context: { prev: Record<string, unknown>; input: unknown; record: unknown }) =>
      actionHooks.calculate ? actionHooks.calculate(context as never) : context.prev,

    save: (context: SaveInput) => {
      const runDefault = (writes: Record<string, unknown> = context.writes) =>
        defaults.save({ ...context, writes });
      return actionHooks.save
        ? actionHooks.save({ ...context, runDefault } as never)
        : runDefault();
    },

    after: async (context: AfterInput, report: (error: unknown) => void) => {
      if (!writes) return;
      // Each level runs even when one before it failed: an audit log must not stop an email.
      const run = async (hook: (() => unknown) | undefined) => {
        if (!hook) return;
        try {
          await hook();
        } catch (error) {
          report(error);
        }
      };
      const { after: appAfter } = appHooks;
      const { after: resourceAfter } = resourceHooks;
      const { after: actionAfter } = actionHooks;
      await run(appAfter && (() => appAfter.call(appHooks, { ...context, model, action })));
      await run(
        resourceAfter && (() => resourceAfter.call(resourceHooks, { ...context, action } as never)),
      );
      await run(actionAfter && (() => actionAfter(context as never)));
    },

    laterAt: (level: Level) => {
      if (!writes) return undefined;
      const { later: appLater } = appHooks;
      const { later: resourceLater } = resourceHooks;
      const { later: actionLater } = actionHooks;
      if (level === 'app' && appLater) {
        return async (context: LaterInput) =>
          appLater.call(appHooks, { ...context, model, action });
      }
      if (level === 'resource' && resourceLater) {
        return async (context: LaterInput) =>
          resourceLater.call(resourceHooks, { ...context, action } as never);
      }
      if (level === 'action' && actionLater) {
        return async (context: LaterInput) => actionLater(context as never);
      }
      return undefined;
    },

    respond: ({ prev, record, result }: { prev: Reply; record: unknown; result: unknown }) => {
      let reply = prev;
      if (appHooks.respond) reply = appHooks.respond({ prev: reply, model, action });
      if (resourceHooks.respond) reply = resourceHooks.respond({ prev: reply, action });
      if (actionHooks.respond) reply = actionHooks.respond({ prev: reply, record, result });
      return reply;
    },
  });
}
