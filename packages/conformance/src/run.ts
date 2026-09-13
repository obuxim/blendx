/**
 * runConformance (P11.2): runs cases against any server through a fetch function, so every
 * runtime can be checked the same way. Each case starts from `reset()`; its steps run in
 * order, and the first failing step ends the case, since later steps build on it.
 */
import type { ConformanceCase } from './case.ts';
import { matchBody, matchHeaders } from './match.ts';

export type Fetch = (request: Request) => Response | Promise<Response>;

export interface RunOptions {
  /** Brings the database back to the fixture's starting state. Runs before every case. */
  reset: () => void | Promise<void>;
  /** Prefix for request paths. Defaults to http://blendx.test, for in-process servers. */
  baseUrl?: string;
}

export interface CaseResult {
  id: string;
  title: string;
  /** Empty when the case passed. */
  problems: string[];
}

export interface ConformanceResult {
  passed: number;
  failed: CaseResult[];
  /** Every case, in the order it ran. */
  results: CaseResult[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The value at a JSON pointer (RFC 6901), or undefined. */
function resolvePointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  return pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), value);
}

async function runCase(test: ConformanceCase, fetch: Fetch, baseUrl: string): Promise<string[]> {
  const captured = new Map<string, unknown>();
  for (const [index, step] of test.steps.entries()) {
    const { request, expect } = step;
    const label = `step ${index + 1} (${request.method} ${request.path})`;

    const missing = [...request.path.matchAll(/\{(\w+)\}/g)]
      .map((found) => found[1] ?? '')
      .filter((name) => !captured.has(name));
    if (missing.length > 0) return [`${label}: nothing captured as {${missing.join('}, {')}}`];
    const path = request.path.replace(/\{(\w+)\}/g, (_, name: string) =>
      encodeURIComponent(String(captured.get(name))),
    );

    const hasBody = request.body !== undefined;
    const response = await fetch(
      new Request(`${baseUrl}${path}`, {
        method: request.method,
        headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...request.headers },
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      }),
    );
    const text = await response.text();
    let body: unknown;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    const problems = [
      ...(response.status === expect.status
        ? []
        : [`status: expected ${expect.status}, got ${response.status}`]),
      ...(expect.headers ? matchHeaders(expect.headers, response.headers) : []),
      ...('body' in expect ? matchBody(expect.body, body) : []),
    ];
    if (problems.length > 0) return problems.map((problem) => `${label}: ${problem}`);

    for (const [name, pointer] of Object.entries(step.capture ?? {})) {
      const value = resolvePointer(body, pointer);
      if (value === undefined) return [`${label}: nothing at ${pointer} to capture as {${name}}`];
      captured.set(name, value);
    }
  }
  return [];
}

/** Runs every case in order and reports which passed and why the others failed. */
export async function runConformance(
  cases: readonly ConformanceCase[],
  fetch: Fetch,
  options: RunOptions,
): Promise<ConformanceResult> {
  const baseUrl = options.baseUrl ?? 'http://blendx.test';
  const results: CaseResult[] = [];
  for (const test of cases) {
    await options.reset();
    results.push({ id: test.id, title: test.title, problems: await runCase(test, fetch, baseUrl) });
  }
  const failed = results.filter((result) => result.problems.length > 0);
  return { passed: results.length - failed.length, failed, results };
}
