/**
 * JSON Schema from zod, shared by OpenAPI (D8) and the review model (P10.1): plain JSON in
 * draft 2020-12, and a one-line description of a schema for a human reviewer.
 */
import { z } from 'zod';

export type JsonObject = { [key: string]: unknown };

/** Plain JSON without $schema; this also drops zod's non-enumerable ~standard (D8 note). */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
  const converted = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { target: 'draft-2020-12', io })),
  ) as JsonObject;
  return Object.fromEntries(Object.entries(converted).filter(([key]) => key !== '$schema'));
}

/** Bounds that only restate the column type (int4, or a safe JavaScript integer). */
const IMPLIED_BOUNDS = [
  [-2147483648, 2147483647],
  [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
];

function bounds(schema: JsonObject): string {
  const { minimum: min, maximum: max } = schema;
  if (IMPLIED_BOUNDS.some(([low, high]) => min === low && max === high)) return '';
  if (typeof min === 'number' && typeof max === 'number') return ` from ${min} to ${max}`;
  if (typeof min === 'number') return ` from ${min}`;
  if (typeof max === 'number') return ` up to ${max}`;
  return '';
}

function describeType(type: string, schema: JsonObject): string {
  switch (type) {
    case 'string': {
      // A format says what a pattern for it would (zod adds one to email, uuid, date and
      // more), and reads far better: `string (date)`, not a regular expression.
      const format = typeof schema.format === 'string' ? schema.format : undefined;
      const details = [
        typeof schema.minLength === 'number' ? `at least ${schema.minLength} characters` : '',
        typeof schema.maxLength === 'number' ? `at most ${schema.maxLength} characters` : '',
        typeof schema.pattern === 'string' && !format ? `matching ${schema.pattern}` : '',
      ].filter(Boolean);
      const name = format ? `string (${format})` : 'string';
      return [name, ...details].join(', ');
    }
    case 'integer':
    case 'number':
      return `${type}${bounds(schema)}`;
    case 'array':
      return schema.items ? `list of ${describeSchema(schema.items as JsonObject)}` : 'list';
    default:
      return type;
  }
}

/** One deterministic line: 'string, at most 255 characters, or null'. */
export function describeSchema(schema: JsonObject): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(', ')}`;
  if ('const' in schema) return `exactly ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.anyOf)) {
    // A null branch reads like a nullable type: ', or null' at the end.
    const branches = schema.anyOf as JsonObject[];
    const real = branches.filter((branch) => branch.type !== 'null');
    const described = real.map(describeSchema).join(' or ');
    return real.length < branches.length ? `${described}, or null` : described;
  }
  const types = (
    Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
  ) as string[];
  const real = types.filter((type) => type !== 'null');
  if (types.length === 0) return 'any JSON';
  if (real.length === 0) return 'null';
  const described = real.map((type) => describeType(type, schema)).join(' or ');
  return real.length < types.length ? `${described}, or null` : described;
}

/** Each property of an object schema in one line, marking optional ones and defaults. */
export function describeFields(schema: JsonObject): Record<string, string> {
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => {
      const optional = required.has(name) ? '' : ', optional';
      const fallback =
        property.default === undefined ? '' : `, default ${JSON.stringify(property.default)}`;
      return [name, `${describeSchema(property)}${optional}${fallback}`];
    }),
  );
}
