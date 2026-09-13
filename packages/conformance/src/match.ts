/**
 * How a response is compared with a case's expectation (packages/spec/conformance.md). Every
 * mismatch is one line starting with where it happened: a JSON pointer into the body, or
 * the header name.
 */

/** A date-time as PostgreSQL returns it, or with `T` and a UTC offset (docs/decisions.md D15). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value: unknown) => (value === undefined ? 'nothing' : JSON.stringify(value));

/** RFC 6901: `~` and `/` inside a key are escaped. */
const segment = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

function matchValue(expected: unknown, actual: unknown, pointer: string): string[] {
  const where = pointer === '' ? '(body)' : pointer;
  const expectedIs = (what: string) => [`${where}: expected ${what}, got ${show(actual)}`];

  if (typeof expected === 'string' && expected.startsWith('$')) {
    if (expected.startsWith('$$')) {
      const literal = expected.slice(1);
      return actual === literal ? [] : expectedIs(show(literal));
    }
    switch (expected) {
      case '$any':
        return actual === undefined ? expectedIs('a value') : [];
      case '$int':
        return Number.isInteger(actual) ? [] : expectedIs('an integer');
      case '$timestamp':
        return typeof actual === 'string' && TIMESTAMP.test(actual)
          ? []
          : expectedIs('a timestamp');
      case '$absent':
        return actual === undefined ? [] : expectedIs('nothing');
      default:
        return [`${where}: unknown matcher ${expected}; use $any, $int, $timestamp or $absent`];
    }
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return expectedIs('an array');
    if (actual.length !== expected.length) {
      return [`${where}: expected ${expected.length} items, got ${actual.length}`];
    }
    return expected.flatMap((item, index) =>
      matchValue(item, actual[index], `${pointer}/${segment(index)}`),
    );
  }

  if (isObject(expected)) {
    if (!isObject(actual)) return expectedIs('an object');
    return Object.entries(expected).flatMap(([key, item]) =>
      matchValue(item, actual[key], `${pointer}/${segment(key)}`),
    );
  }

  return expected === actual ? [] : expectedIs(show(expected));
}

/**
 * Mismatches between an expected body and the actual one. `actual` is the parsed JSON, or
 * undefined when the response had no body.
 */
export function matchBody(expected: unknown, actual: unknown): string[] {
  return matchValue(expected, actual, '');
}

/** Mismatches between expected headers and a response's; content-type parameters are ignored. */
export function matchHeaders(
  expected: Record<string, string>,
  actual: { get(name: string): string | null },
): string[] {
  return Object.entries(expected).flatMap(([name, value]) => {
    const got = actual.get(name);
    const compared = name.toLowerCase() === 'content-type' ? got?.split(';')[0]?.trim() : got;
    return compared === value
      ? []
      : [`${name}: expected ${show(value)}, got ${show(got ?? undefined)}`];
  });
}
