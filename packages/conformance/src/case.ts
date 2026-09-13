/** The conformance case format (packages/spec/conformance.md), as TypeScript types. */

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface CaseRequest {
  method: Method;
  /** `{name}` is replaced by a value captured earlier in the same case. */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Sent exactly as written, as application/json, instead of `body`: for malformed JSON. */
  text?: string;
}

export interface CaseExpect {
  status: number;
  /** Names match case-insensitively; content-type parameters are ignored. */
  headers?: Record<string, string>;
  /** Matched by matchBody. Without it the body is not checked. */
  body?: unknown;
}

export interface CaseStep {
  request: CaseRequest;
  expect: CaseExpect;
  /** Names for values in the response body, by JSON pointer: `{ "order": "/id" }`. */
  capture?: Record<string, string>;
}

export interface ConformanceCase {
  /** Unique across the suite: a derivation rule id, an error status, or another stable name. */
  id: string;
  title: string;
  /** Run in order, from a reset database. */
  steps: CaseStep[];
}

export interface CaseFile {
  format: 1;
  /** The app the cases run against, such as "shop". */
  fixture: string;
  cases: ConformanceCase[];
}

export const MATCHERS = ['$any', '$int', '$timestamp', '$absent'] as const;
export type Matcher = (typeof MATCHERS)[number];
