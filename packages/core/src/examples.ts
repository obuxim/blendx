/**
 * Review examples (P10.5). review/<resource>.examples.yaml is human-owned: for each action,
 * a list of examples giving the input (and the record, for member actions) and what
 * calculate must write, what a collection action must return, or which fields validation
 * must reject. runExamples checks them without a database, the way the engine runs an
 * action: validate with the resolved rules, then calculate, then compare.
 */
import type { App } from './app.ts';
import type { Resource } from './blend.ts';
import { type ResolvedEndpoint, resolveEndpoint } from './cascade.ts';
import { toEndpoints } from './endpoints.ts';
import { assertWritable, defaultEffects, defaultPrev } from './engine.ts';
import { validationProblem } from './problems.ts';

export interface ExampleRun {
  passed: number;
  /** One readable line per failed example, starting with the action and its number. */
  failures: string[];
}

const KEYS: ReadonlySet<string> = new Set([
  'name',
  'input',
  'record',
  'writes',
  'returns',
  'rejects',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with sorted keys, so equal values print alike and compare as strings. */
function stable(value: unknown): string {
  const sorted = JSON.stringify(value, (_key, item: unknown) =>
    isObject(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => byCodeUnit(a, b)))
      : item,
  );
  return sorted ?? 'nothing';
}

/** Whether calculate runs for the action: store, update, replace and custom actions. */
const calculates = (endpoint: ResolvedEndpoint) =>
  !endpoint.builtin || ['store', 'update', 'replace'].includes(endpoint.action);

/** The reason an example fails, or undefined when it holds. */
function check(endpoint: ResolvedEndpoint, example: Record<string, unknown>): string | undefined {
  const unknown = Object.keys(example).filter((key) => !KEYS.has(key));
  if (unknown.length > 0) {
    const listed = unknown.map((key) => `"${key}"`).join(', ');
    return `unknown key ${listed}; use input, record, writes, returns or rejects`;
  }

  const parsed = endpoint.rules.safeParse(example.input ?? {});
  const where = endpoint.method === 'get' ? 'query' : 'body';
  const problems = parsed.success
    ? []
    : (validationProblem(parsed.error, { in: where }).errors ?? []);
  if ('rejects' in example) {
    const expected = (Array.isArray(example.rejects) ? example.rejects : [example.rejects])
      .map(String)
      .sort(byCodeUnit);
    if (parsed.success) {
      return `expected the input to be rejected at ${stable(expected)}, but it passed`;
    }
    const got = problems
      .map((problem) => problem.pointer ?? problem.parameter ?? '')
      .sort(byCodeUnit);
    return stable(got) === stable(expected)
      ? undefined
      : `rejected at ${stable(got)}, expected ${stable(expected)}`;
  }
  if (!parsed.success) {
    const reasons = problems.map((p) => `${p.pointer ?? p.parameter}: ${p.detail}`).join('; ');
    return `input rejected: ${reasons}`;
  }

  const collection = !endpoint.builtin && endpoint.on === 'collection';
  const key = collection ? 'returns' : 'writes';
  const other = collection ? 'writes' : 'returns';
  if (!calculates(endpoint)) {
    return 'writes' in example || 'returns' in example
      ? `${endpoint.action} does not calculate; give only input or rejects`
      : undefined;
  }
  if (other in example) return `${endpoint.action} ${key}; use ${key}, not ${other}`;
  if (!(key in example)) return undefined;

  let result: unknown;
  try {
    result = endpoint.calculate({
      prev: defaultPrev(endpoint, parsed.data),
      input: parsed.data,
      record: example.record,
    });
    if (!collection) result = assertWritable(endpoint.model, endpoint.action, result);
  } catch (error) {
    return `calculate threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  return stable(result) === stable(example[key])
    ? undefined
    : `${key} ${stable(result)}, expected ${stable(example[key])}`;
}

/** Runs one resource's examples: the parsed contents of its examples file. */
export function runExamples(resource: Resource, app: App, examples: unknown): ExampleRun {
  const run: ExampleRun = { passed: 0, failures: [] };
  if (examples === null || examples === undefined) return run;
  if (!isObject(examples)) {
    return { passed: 0, failures: ['the file must map action names to lists of examples'] };
  }

  const definitions = new Map(toEndpoints(resource).map((d) => [d.action, d]));
  for (const [action, list] of Object.entries(examples)) {
    const definition = definitions.get(action);
    if (!definition) {
      run.failures.push(`${action}: ${resource.model.name} has no action "${action}"`);
      continue;
    }
    if (!Array.isArray(list)) {
      run.failures.push(`${action}: expected a list of examples`);
      continue;
    }
    const endpoint = resolveEndpoint(definition, {
      app,
      defaults: defaultEffects(definition, { perPage: app.index.perPage }),
    });
    for (const [index, example] of list.entries()) {
      const named =
        isObject(example) && typeof example.name === 'string' ? ` (${example.name})` : '';
      const failure = isObject(example)
        ? check(endpoint, example)
        : 'expected a map with input, and writes, returns or rejects';
      if (failure) run.failures.push(`${action} #${index + 1}${named}: ${failure}`);
      else run.passed += 1;
    }
  }
  return run;
}
