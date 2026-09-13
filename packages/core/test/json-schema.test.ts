/** P10.1: the one-line schema descriptions the review YAML shows a human reviewer. */
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { describeFields, describeSchema, toJsonSchema } from '../src/json-schema.ts';

describe('describeSchema', () => {
  test.each([
    [{ type: 'number' }, 'number'],
    [{ type: 'boolean' }, 'boolean'],
    [{ type: 'integer', minimum: -2147483648, maximum: 2147483647 }, 'integer'],
    [{ type: 'integer', minimum: 1, maximum: 100 }, 'integer from 1 to 100'],
    [{ type: 'integer', minimum: 1 }, 'integer from 1'],
    [{ type: 'number', maximum: 10 }, 'number up to 10'],
    [{ type: ['string', 'null'], maxLength: 255 }, 'string, at most 255 characters, or null'],
    [{ type: 'string', format: 'uuid' }, 'string (uuid)'],
    // P15.5: a format says what zod's pattern for it would, so the pattern is left out.
    [
      { type: 'string', format: 'email', maxLength: 255, pattern: '^[^@]+@[^@]+$' },
      'string (email), at most 255 characters',
    ],
    [{ type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, 'string (date)'],
    [{ type: 'string', pattern: '^[1-9][0-9]*$' }, 'string, matching ^[1-9][0-9]*$'],
    [{ type: 'string', enum: ['pending', 'paid'] }, 'one of pending, paid'],
    [{ anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] }, 'one of a, b, or null'],
    [{ type: 'array', items: { type: 'string' } }, 'list of string'],
    [{ const: 'x' }, 'exactly "x"'],
    [{ type: 'null' }, 'null'],
    [{}, 'any JSON'],
  ])('%j reads as %p', (schema, text) => {
    expect(describeSchema(schema)).toBe(text);
  });
});

describe('describeFields', () => {
  test('each property in order, marking optional fields and defaults', () => {
    const schema = z.object({
      a: z.number(),
      note: z.string().max(80).nullable().optional(),
      quantity: z.number().int().default(1),
    });
    expect(describeFields(toJsonSchema(schema, 'input'))).toEqual({
      a: 'number',
      note: 'string, at most 80 characters, or null, optional',
      quantity: 'integer, optional, default 1',
    });
  });
});
