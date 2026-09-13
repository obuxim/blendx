/**
 * The review model (P10.1): what `blendx review` shows a human for one resource, as plain
 * data. Each action lists its route, its input (one line per field, from the resolved
 * rules), every stage with the cascade levels that shaped it and what the schema level
 * does, and its reply. The YAML emitter (P10.3) renders it with `# from:` comments, and
 * the CLI adds calculate's source and writes (P10.2).
 */
import type { App } from './app.ts';
import type { Resource } from './blend.ts';
import { type Level, resolveEndpoint, STAGES, type Stage } from './cascade.ts';
import { recordSchema } from './derive-rules.ts';
import { defaultStatus, type EndpointDefinition, toEndpoints } from './endpoints.ts';
import { defaultEffects, saves, writableColumns } from './engine.ts';
import { describeFields, describeSchema, toJsonSchema } from './json-schema.ts';

export interface StageReview {
  /** The levels that shaped the stage, in cascade order. `schema` alone is the default. */
  readonly from: readonly Level[];
  /** What the schema level does, in words. For authorize, the policy. */
  readonly default: string;
}

export interface ReplyReview {
  readonly status: number;
  /** One line, or one line per field of an object body. */
  readonly body: string | Readonly<Record<string, string>>;
}

export interface CalculateReview {
  /** The hook as written. The CLI reads it with the TypeScript 6 compiler API (P10.2). */
  readonly source?: string;
  /** The columns it writes, sorted; for a collection action, the keys it returns. */
  readonly keys: readonly string[];
}

export interface ActionReview {
  readonly name: string;
  /** 'POST /addition_results' */
  readonly route: string;
  readonly input: Readonly<Record<string, string>>;
  readonly stages: Readonly<Record<Stage, StageReview>>;
  /**
   * What calculate writes, for actions that calculate (store, update, custom). Without a
   * hook, the input's writable columns; with one, it is left for the CLI to fill in.
   */
  readonly calculate?: CalculateReview;
  /** An index with a scope (D22); the CLI adds the scope's source and columns. */
  readonly scoped?: true;
  /** The hidden columns this action's reply carries (D24), when it reveals any. */
  readonly reveals?: readonly string[];
  /** The reply, or why it is not described. */
  readonly reply: ReplyReview | string;
}

export interface ResourceReview {
  readonly format: 1;
  readonly resource: string;
  readonly hidden: readonly string[];
  /** The fields of a record in a reply, hidden columns removed. */
  readonly record: Readonly<Record<string, string>>;
  readonly actions: readonly ActionReview[];
}

const EMPTY = 'nothing (an empty object)';
const WRITABLE = "the input's writable columns";

/** What each stage does at the schema level, mirroring the engine's defaultEffects. */
function stageDefaults(endpoint: EndpointDefinition): Record<Exclude<Stage, 'authorize'>, string> {
  const { softDelete, timestamps } = endpoint.model.meta;
  const touch = timestamps.updatedAt ? `, touching ${timestamps.updatedAt}` : '';
  const live = softDelete ? ', not soft-deleted' : '';
  // The engine locks a member row whenever the action saves, whatever its HTTP method.
  const lock = saves(endpoint) ? ', locked for update' : '';
  const row = `the row by id${live}${lock}`;
  const update = `update the row${touch}, when there is something to write`;
  const kind = endpoint.builtin ? endpoint.action : `custom ${endpoint.on}`;

  switch (kind) {
    case 'index':
      return {
        rules: 'page, per_page, sort, and filters on key and indexed columns',
        load: `a filtered, sorted page of rows${softDelete ? ' that are not soft-deleted' : ''}`,
        calculate: 'nothing',
        save: 'nothing',
        respond: '200 with a page of records',
      };
    case 'show':
      return {
        rules: EMPTY,
        load: `the row by id${live}`,
        calculate: 'nothing',
        save: 'nothing',
        respond: '200 with the record',
      };
    case 'store': {
      const stamped = [timestamps.createdAt, timestamps.updatedAt].filter(Boolean);
      return {
        rules: 'the insert columns, without generated ones',
        load: 'nothing',
        calculate: WRITABLE,
        save: stamped.length > 0 ? `insert, setting ${stamped.join(' and ')}` : 'insert',
        respond: '201 with the saved record',
      };
    }
    case 'update':
      return {
        rules: 'the insert columns, all optional',
        load: row,
        calculate: WRITABLE,
        save: update,
        respond: '200 with the saved record',
      };
    case 'destroy':
      return {
        rules: EMPTY,
        load: row,
        calculate: 'nothing',
        save: softDelete ? `soft delete: set ${softDelete}${touch}` : 'delete the row',
        respond: '204 with no body',
      };
    case 'restore':
      return {
        rules: EMPTY,
        load: `the soft-deleted row by id${lock}`,
        calculate: 'nothing',
        save: `clear ${softDelete}${touch}`,
        respond: '200 with the restored record',
      };
    case 'custom member':
      return {
        rules: EMPTY,
        load: row,
        calculate: WRITABLE,
        save: update,
        respond: '200 with the saved record',
      };
    default:
      return {
        rules: EMPTY,
        load: 'nothing',
        calculate: WRITABLE,
        save: 'nothing',
        respond: '200 with what calculate returns',
      };
  }
}

/** The reply as the action declares it (D14) or as blendx derives it. */
function replyOf(endpoint: EndpointDefinition): ReplyReview | string {
  const status = defaultStatus(endpoint);
  if (endpoint.reply) {
    const schema = toJsonSchema(endpoint.reply.schema, 'output');
    const body = schema.properties ? describeFields(schema) : describeSchema(schema);
    return { status: endpoint.reply.status ?? status, body };
  }
  if (endpoint.hooks.respond) {
    return 'not described: its respond hook builds the reply; declare reply';
  }
  if (!endpoint.builtin && endpoint.on === 'collection') {
    return 'not described: it is what calculate returns; declare reply';
  }
  if (endpoint.builtin && endpoint.action === 'index') return { status, body: 'a page of records' };
  if (endpoint.builtin && endpoint.action === 'destroy') return { status, body: 'none' };
  // D24: a reply that reveals hidden columns says which.
  const revealed = endpoint.revealed ? `, with ${endpoint.revealed.join(', ')}` : '';
  return { status, body: `the record${revealed}` };
}

/** The review model of one resource, with the app's hooks and settings applied. */
export function reviewResource(resource: Resource, app: App): ResourceReview {
  const record = describeFields(
    toJsonSchema(recordSchema(resource.model, resource.hidden), 'output'),
  );
  const writable = writableColumns(resource.model);
  const actions = toEndpoints(resource).map((definition) => {
    const endpoint = resolveEndpoint(definition, {
      app,
      defaults: defaultEffects(definition, { perPage: app.index.perPage }),
    });
    const defaults = stageDefaults(definition);
    const stages = Object.fromEntries(
      STAGES.map((stage) => [
        stage,
        Object.freeze({
          from: endpoint.provenance[stage],
          default: stage === 'authorize' ? definition.policy.description : defaults[stage],
        }),
      ]),
    ) as Record<Stage, StageReview>;
    const input = describeFields(toJsonSchema(endpoint.rules, 'input'));
    // The default calculate returns the input's writable columns (engine defaultWrites).
    const calculates = !definition.builtin || ['store', 'update'].includes(definition.action);
    const calculate =
      calculates && !definition.hooks.calculate
        ? {
            keys: Object.keys(input)
              .filter((key) => writable.has(key))
              .sort(),
          }
        : undefined;
    return Object.freeze({
      name: definition.action,
      route: `${definition.method.toUpperCase()} ${definition.path}`,
      input,
      stages: Object.freeze(stages),
      ...(calculate ? { calculate: Object.freeze(calculate) } : {}),
      ...(definition.hooks.scope ? { scoped: true as const } : {}),
      ...(definition.revealed ? { reveals: Object.freeze([...definition.revealed]) } : {}),
      reply: replyOf(definition),
    });
  });
  return Object.freeze({
    format: 1,
    resource: resource.model.name,
    hidden: Object.freeze([...resource.hidden]),
    record,
    actions: Object.freeze(actions),
  });
}
