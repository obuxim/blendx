/** P7.7/P17.18: real PostgreSQL coverage for configured server drivers. */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataMigration } from '@blendx/core';
import { sql } from 'drizzle-orm';
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

    test(`${driver} records a data migration transactionally`, async () => {
      const migrations = await mkdtemp(join(tmpdir(), 'blendx-empty-migrations-'));
      const table = `blendx_data_migration_probe_${driver.replace('-', '_')}`;
      const id = `20260925_${driver.replace('-', '_')}_data_migration_probe`;
      const database = await createDatabase({ database: { driver, url: undefined } });
      try {
        await database.db.execute(sql.raw(`create table ${table} (id integer primary key)`));
        const step = dataMigration({
          id,
          async up({ tx }) {
            await tx.execute(sql.raw(`insert into ${table} values (1)`));
          },
        });
        expect(await database.migrate(migrations, [step])).toEqual({ schema: 0, data: [id] });
        expect(await query(database, `select id from ${table}`)).toEqual([{ id: 1 }]);
      } finally {
        await database.db.execute(sql.raw(`drop table if exists ${table}`));
        await database.db
          .execute(sql`delete from blendx.__blendx_data_migrations where id = ${id}`)
          .catch(() => undefined);
        await database.close();
        await rm(migrations, { recursive: true, force: true });
      }
    });
  }
});
