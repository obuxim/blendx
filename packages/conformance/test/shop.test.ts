/** P11.4: the conformance suite against the shop fixture, on Bun with PGlite. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { loadCases, type Shop, startShop } from '../harness/shop.ts';
import { runConformance } from '../src/run.ts';

let shop: Shop;
beforeAll(async () => {
  shop = await startShop();
}, 60_000);
afterAll(() => shop.close());

test('every case passes on Bun with PGlite', async () => {
  const cases = await loadCases();
  const result = await runConformance(cases, shop.fetch, { reset: shop.reset });
  expect(result.failed).toEqual([]);
  expect(result.passed).toBe(cases.length);
}, 60_000);
