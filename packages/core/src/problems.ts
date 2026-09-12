/**
 * RFC 9457 Problem Details: the body of every blendx error response (docs/decisions.md
 * D4), served as application/problem+json. Validation problems list every failing field,
 * with a JSON pointer into the request body (RFC 6901) or the query parameter name.
 */
import type { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

export interface ProblemError {
  /** What is wrong with this field, in plain words. */
  detail: string;
  /** JSON pointer to the field in the request body. */
  pointer?: string;
  /** The query parameter, when the query failed validation. */
  parameter?: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: ProblemStatus;
  detail?: string;
  errors?: ProblemError[];
}

export interface ProblemOptions {
  detail?: string;
  errors?: ProblemError[];
  /** Base URI for problem types (defineApp problems.typeBase). Without it, type is about:blank. */
  typeBase?: string;
}

const PROBLEMS: Record<ProblemStatus, { title: string; slug: string }> = {
  400: { title: 'Bad Request', slug: 'bad-request' },
  401: { title: 'Unauthorized', slug: 'unauthorized' },
  403: { title: 'Forbidden', slug: 'forbidden' },
  404: { title: 'Not Found', slug: 'not-found' },
  409: { title: 'Conflict', slug: 'conflict' },
  422: { title: 'Unprocessable Content', slug: 'validation-error' },
  500: { title: 'Internal Server Error', slug: 'internal-error' },
};

export function problem(status: ProblemStatus, options: ProblemOptions = {}): ProblemDetails {
  const { title, slug } = PROBLEMS[status];
  return {
    type: options.typeBase ? `${options.typeBase.replace(/\/+$/, '')}/${slug}` : 'about:blank',
    title,
    status,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.errors === undefined ? {} : { errors: options.errors }),
  };
}

/** RFC 6901: `/a/0/b`, with `~` written as `~0` and `/` as `~1`. */
export function jsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

/** A 422 listing every invalid field, from the body or from the query. */
export function validationProblem(
  error: z.ZodError,
  options: { in: 'body' | 'query'; typeBase?: string },
): ProblemDetails {
  const errors = error.issues.flatMap((issue): ProblemError[] => {
    const unknown = issue.code === 'unrecognized_keys';
    const paths = unknown ? issue.keys.map((key) => [...issue.path, key]) : [issue.path];
    const detail = unknown ? 'is not an accepted field' : issue.message;
    return paths.map((path) =>
      options.in === 'query'
        ? { parameter: String(path[0] ?? ''), detail }
        : { pointer: jsonPointer(path), detail },
    );
  });
  return problem(422, {
    detail: 'The request did not pass validation.',
    errors,
    typeBase: options.typeBase,
  });
}
