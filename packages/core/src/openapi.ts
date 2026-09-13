/**
 * OpenAPI 3.1 for an app, built from its endpoint definitions (D8). Request bodies and query
 * parameters come from each endpoint's resolved rules (zod's input side); replies use each
 * table's public record (the output side). z.toJSONSchema writes draft 2020-12, the dialect
 * OpenAPI 3.1 uses. stringifyOpenApi sorts keys, so the file is deterministic.
 */
import { getColumns } from 'drizzle-orm';
import { z } from 'zod';
import type { App } from './app.ts';
import type { Resource } from './blend.ts';
import { type ResolvedEndpoint, resolveEndpoint } from './cascade.ts';
import { recordSchema } from './derive-rules.ts';
import {
  defaultStatus,
  type EndpointDefinition,
  type IncludeDefinition,
  resolveIncludes,
  toEndpoints,
} from './endpoints.ts';
import { defaultEffects } from './engine.ts';
import { type JsonObject, toJsonSchema } from './json-schema.ts';
import type { Model } from './model.ts';
import { PROBLEM_CONTENT_TYPE } from './problems.ts';

export type { JsonObject } from './json-schema.ts';

export interface OpenApiOptions {
  app: App;
  resources: readonly Resource[];
  info: { title: string; version: string };
}

export interface OpenApiResult {
  document: JsonObject;
  /** Replies the document cannot describe, one line each. */
  warnings: string[];
}

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.literal([400, 401, 403, 404, 409, 422, 500]),
  detail: z.string().optional(),
  errors: z
    .array(
      z.object({
        detail: z.string(),
        pointer: z.string().optional(),
        parameter: z.string().optional(),
      }),
    )
    .optional(),
});

const DESCRIPTIONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'The body is not valid JSON',
  401: 'The request has no identity',
  403: 'The policy or an authorize hook refused it',
  404: 'No such record',
  409: 'It conflicts with existing data',
  422: 'The input is invalid',
};

/** Policies that never answer 403 on their own. */
const OPEN_POLICIES: ReadonlySet<string> = new Set(['public', 'authenticated']);

const propertiesOf = (schema: JsonObject) =>
  (schema.properties ?? {}) as Record<string, JsonObject>;

/**
 * 'YYYY-MM-DD' is an RFC 3339 full-date. String-mode timestamps come back in Postgres's
 * text form ('2026-09-13 04:35:38.784'), which is not an RFC 3339 date-time (D8 note).
 */
function markDates(schema: JsonObject, model: Model): JsonObject {
  const properties = propertiesOf(schema);
  for (const [name, column] of Object.entries(getColumns(model.table))) {
    const property = properties[name];
    if (!property || column.columnType !== 'PgDateString') continue;
    // A nullable column is { type: ['string', 'null'] }; format only constrains the string.
    const types = Array.isArray(property.type) ? property.type : [property.type];
    if (types.includes('string')) property.format = 'date';
  }
  return schema;
}

const ref = (name: string): JsonObject => ({ $ref: `#/components/schemas/${name}` });

const withBody = (type: string, schema: JsonObject) => ({ content: { [type]: { schema } } });

const page = (record: JsonObject): JsonObject => ({
  type: 'object',
  properties: {
    data: { type: 'array', items: record },
    meta: {
      type: 'object',
      properties: {
        page: { type: 'integer' },
        per_page: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: ['page', 'per_page', 'total'],
      additionalProperties: false,
    },
  },
  required: ['data', 'meta'],
  additionalProperties: false,
});

/** A model's public record as JSON Schema, dates marked. */
const recordOf = (model: Model, hidden: readonly string[]): JsonObject =>
  markDates(toJsonSchema(recordSchema(model, hidden), 'output'), model);

/**
 * What one include adds to a record: the target's component, or null (D28); an array of it for
 * a has-many (D31). A target with includes of its own is inlined instead, with each of them as
 * an optional property, so a dotted path is described where it nests (D32).
 */
function includeSchema(include: IncludeDefinition): JsonObject {
  const { target } = include;
  const nested = Object.entries(resolveIncludes(target));
  let record: JsonObject = ref(target.model.name);
  if (nested.length > 0) {
    const own = recordOf(target.model, target.hidden);
    const below = nested.map(([name, child]) => [name, includeSchema(child)]);
    record = { ...own, properties: { ...propertiesOf(own), ...Object.fromEntries(below) } };
  }
  return include.kind === 'hasMany'
    ? { type: 'array', items: record }
    : { anyOf: [record, { type: 'null' }] };
}

/**
 * The success reply: the one the action declares (D14), its default, or an empty schema with
 * a warning when neither describes it.
 */
function replies(endpoint: EndpointDefinition, warnings: string[]): JsonObject {
  const reply = (status: number, schema?: JsonObject): JsonObject => ({
    [String(status)]: {
      description: DESCRIPTIONS[status] ?? `Status ${status}`,
      ...(schema ? withBody('application/json', schema) : {}),
    },
  });
  // D24: a reply that reveals hidden columns is the record and those, not the component.
  // D28, D31, D32: index and show with includes add each include's schema.
  const includes = Object.entries(endpoint.includes ?? {});
  let record: JsonObject = ref(endpoint.resource);
  if (endpoint.revealed || includes.length > 0) {
    const own = recordOf(endpoint.model, endpoint.hidden);
    const nested = includes.map(([name, include]) => [name, includeSchema(include)]);
    record = { ...own, properties: { ...propertiesOf(own), ...Object.fromEntries(nested) } };
  }

  if (endpoint.reply) {
    const status = endpoint.reply.status ?? defaultStatus(endpoint);
    return reply(
      status,
      status === 204 ? undefined : toJsonSchema(endpoint.reply.schema, 'output'),
    );
  }
  if (endpoint.hooks.respond) {
    warnings.push(`${endpoint.id}: its respond hook builds the reply; describe it with reply`);
    return reply(200, {});
  }
  if (!endpoint.builtin) {
    if (endpoint.on === 'member') return reply(200, record);
    warnings.push(`${endpoint.id}: the reply is what calculate returns; describe it with reply`);
    return reply(200, {});
  }
  switch (endpoint.action) {
    case 'index':
      return reply(200, page(record));
    case 'store':
      return reply(201, record);
    case 'destroy':
    case 'purge':
      return reply(204);
    default:
      return reply(200, record);
  }
}

/** The Problem Details replies an endpoint can give, each by a fixed rule. */
function problems(endpoint: ResolvedEndpoint, app: App, body: boolean): JsonObject {
  const authorize =
    endpoint.hooks.authorize ?? endpoint.resourceHooks.authorize ?? app.spec.hooks?.authorize;
  const statuses = [
    ...(body ? [400] : []),
    ...(endpoint.requiresAuth ? [401] : []),
    ...(authorize || !OPEN_POLICIES.has(endpoint.policy.kind) ? [403] : []),
    ...(endpoint.on === 'member' ? [404] : []),
    ...(endpoint.method === 'get' ? [] : [409]),
    // Every endpoint validates strictly, so an unknown key is a 422 anywhere.
    422,
  ];
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      { description: DESCRIPTIONS[status], ...withBody(PROBLEM_CONTENT_TYPE, ref('Problem')) },
    ]),
  );
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The OpenAPI document for an app's resources, and what it could not describe. */
export function buildOpenApi({ app, resources, info }: OpenApiOptions): OpenApiResult {
  const warnings: string[] = [];
  const paths: Record<string, JsonObject> = {};
  const schemas: Record<string, JsonObject> = { Problem: toJsonSchema(problemSchema, 'output') };

  // D28: the record an include points to has a component, even without a blend of its own here;
  // D32: so does every record a path below it reaches.
  const withTargets = (resource: Resource) => {
    for (const { target } of Object.values(resolveIncludes(resource))) {
      schemas[target.model.name] ??= recordOf(target.model, target.hidden);
      withTargets(target);
    }
  };
  const sorted = [...resources].sort((a, b) => byCodeUnit(a.model.name, b.model.name));
  for (const resource of sorted) {
    const { model } = resource;
    const record = recordOf(model, resource.hidden);
    schemas[model.name] = record;
    withTargets(resource);
    const idSchema = (model.meta.primaryKey && propertiesOf(record)[model.meta.primaryKey]) || {
      type: 'string',
    };

    for (const definition of toEndpoints(resource)) {
      const endpoint = resolveEndpoint(definition, {
        app,
        defaults: defaultEffects(definition, { perPage: app.index.perPage }),
      });
      const body = definition.method === 'post' || definition.method === 'patch';
      const input = toJsonSchema(endpoint.rules, 'input');
      const fields = propertiesOf(input);
      const required = new Set((input.required ?? []) as string[]);

      const parameters = [
        ...(definition.on === 'member'
          ? [{ name: 'id', in: 'path', required: true, schema: idSchema }]
          : []),
        ...(definition.method === 'get'
          ? Object.entries(fields).map(([name, schema]) => ({
              name,
              in: 'query',
              required: required.has(name),
              schema,
            }))
          : []),
      ];
      const operation: JsonObject = {
        operationId: definition.id,
        tags: [definition.resource],
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(body && Object.keys(fields).length > 0
          ? { requestBody: { required: true, ...withBody('application/json', input) } }
          : {}),
        responses: { ...replies(definition, warnings), ...problems(endpoint, app, body) },
      };
      const path = definition.path.replace(/:(\w+)/g, '{$1}');
      paths[path] = { ...paths[path], [definition.method]: operation };
    }
  }

  return {
    document: { openapi: '3.1.0', info: { ...info }, paths, components: { schemas } },
    warnings,
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => byCodeUnit(a, b))
      .map(([key, item]) => [key, sortKeys(item)]),
  );
}

const TOP_LEVEL = ['openapi', 'info', 'paths', 'components'];

/** openapi.json text: the top level in the usual order, every other object's keys sorted. */
export function stringifyOpenApi(document: JsonObject): string {
  const ordered = Object.fromEntries([
    ...TOP_LEVEL.filter((key) => key in document).map((key) => [key, sortKeys(document[key])]),
    ...Object.entries(sortKeys(document) as JsonObject).filter(([key]) => !TOP_LEVEL.includes(key)),
  ]);
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
