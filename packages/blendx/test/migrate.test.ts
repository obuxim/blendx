/**
 * P7.6: Database.migrate runs the driver's own drizzle migrator on a drizzle-kit folder and
 * reports how many migrations ran. The CLI tests cover the folder drizzle-kit writes.
 */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase } from '../src/database.ts';
import { query } from './support/query.ts';

const folder = join(import.meta.dir, 'fixtures', 'migrations');

test('pglite: pending migrations run once', async () => {
  const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  try {
    expect(await database.migrate(folder)).toBe(1);
    expect(await database.migrate(folder)).toBe(0);
    expect(await query(database, "insert into notes values (1, 'hi') returning body")).toEqual([
      { body: 'hi' },
    ]);
  } finally {
    await database.close();
  }
});
