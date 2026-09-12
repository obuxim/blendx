import { describe, expect, test } from 'bun:test';
import {
  jsonPointer,
  PROBLEM_CONTENT_TYPE,
  type ProblemStatus,
  problem,
  validationProblem,
} from '@blendx/core';
import { z } from 'zod';

function zodError(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected validation to fail');
  return result.error;
}

describe('problem()', () => {
  test('each status has its title, and the type is about:blank by default', () => {
    expect(problem(404)).toEqual({ type: 'about:blank', title: 'Not Found', status: 404 });
    const statuses: ProblemStatus[] = [400, 401, 403, 404, 409, 422, 500];
    expect(statuses.map((status) => problem(status).title)).toEqual([
      'Bad Request',
      'Unauthorized',
      'Forbidden',
      'Not Found',
      'Conflict',
      'Unprocessable Content',
      'Internal Server Error',
    ]);
  });

  test('a detail, and a type URI from the app type base', () => {
    expect(
      problem(409, { detail: 'email is taken', typeBase: 'https://errors.example.com/' }),
    ).toEqual({
      type: 'https://errors.example.com/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'email is taken',
    });
  });

  test('is served as application/problem+json', () => {
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });
});

describe('jsonPointer()', () => {
  test('follows RFC 6901, escaping ~ and /', () => {
    expect(jsonPointer(['tags', 0])).toBe('/tags/0');
    expect(jsonPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    expect(jsonPointer([])).toBe('');
  });
});

describe('validationProblem()', () => {
  test('body: one error per field, each with a pointer; every unknown key listed', () => {
    const rules = z.object({ a: z.number(), tags: z.array(z.string()) }).strict();
    const body = validationProblem(
      zodError(rules, { a: 'x', tags: [1], is_admin: true, role: 'x' }),
      {
        in: 'body',
      },
    );
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'The request did not pass validation.',
    });
    expect(body.errors?.map((error) => error.pointer)).toEqual([
      '/a',
      '/tags/0',
      '/is_admin',
      '/role',
    ]);
    expect(body.errors?.at(-1)).toEqual({ pointer: '/role', detail: 'is not an accepted field' });
    expect(body.errors?.[0]?.detail).toBeString();
  });

  test('query: errors name the parameter instead of a pointer', () => {
    const rules = z.object({ page: z.string().regex(/^\d+$/) }).strict();
    const query = validationProblem(zodError(rules, { page: 'x', total: '1' }), {
      in: 'query',
      typeBase: 'https://errors.example.com',
    });
    expect(query.type).toBe('https://errors.example.com/validation-error');
    expect(query.errors?.map((error) => error.parameter)).toEqual(['page', 'total']);
    expect(query.errors?.every((error) => error.pointer === undefined)).toBe(true);
  });
});
