export const PACKAGE = '@blendx/conformance';

export {
  type CaseExpect,
  type CaseFile,
  type CaseRequest,
  type CaseStep,
  type ConformanceCase,
  MATCHERS,
  type Matcher,
  type Method,
} from './case.ts';
export { matchBody, matchHeaders } from './match.ts';
export {
  type CaseResult,
  type ConformanceResult,
  type Fetch,
  type RunOptions,
  runConformance,
} from './run.ts';
