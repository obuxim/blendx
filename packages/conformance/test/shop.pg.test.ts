/**
 * P11.5: the conformance suite on Bun against real PostgreSQL through the pg driver
 * (BLENDX_TEST_DB=pg with DATABASE_URL). It drops and recreates that database's public
 * schema, so use a scratch database. Node + pg runs through harness/node.ts.
 */
import { describe, expect, test } from 'bun:test';
import { loadCases, runSuite } from '../harness/shop.ts';

const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

describe.skipIf(!realPostgres)('conformance on PostgreSQL', () => {
  test('every case passes on Bun with pg', async () => {
    const result = await runSuite({ driver: 'pg', url: undefined });
    expect(result.failed).toEqual([]);
    expect(result.passed).toBe((await loadCases()).length);
  }, 120_000);

  test('every case passes on Bun with bun-sql (P11.7)', async () => {
    const result = await runSuite({ driver: 'bun-sql', url: undefined });
    expect(result.failed).toEqual([]);
    expect(result.passed).toBe((await loadCases()).length);
  }, 120_000);
});
