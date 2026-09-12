/**
 * P7.7: createDatabase against real PostgreSQL (BLENDX_TEST_DB=pg with DATABASE_URL). Only a
 * `select` runs, so the database is left as it was.
 */
import { describe, expect, test } from 'bun:test';
import { createDatabase } from '../src/database.ts';
import { query } from './support/query.ts';

const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

describe.skipIf(!realPostgres)('createDatabase on PostgreSQL', () => {
  for (const driver of ['pg', 'bun-sql'] as const) {
    test(`${driver} connects through DATABASE_URL`, async () => {
      const database = await createDatabase({ database: { driver, url: undefined } });
      try {
        expect(database.driver).toBe(driver);
        expect(await query(database, 'select 1 as one')).toEqual([{ one: 1 }]);
      } finally {
        await database.close();
      }
    });
  }
});
