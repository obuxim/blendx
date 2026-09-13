/** P11.4: the conformance suite against the shop fixture, on Bun with PGlite. */
import { expect, test } from 'bun:test';
import { loadCases, runSuite } from '../harness/shop.ts';

test('every case passes on Bun with PGlite', async () => {
  const result = await runSuite();
  expect(result.failed).toEqual([]);
  expect(result.passed).toBe((await loadCases()).length);
}, 60_000);
