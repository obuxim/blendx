/**
 * P7.7: createDatabase opens the configured driver. PGlite runs here; pg and bun-sql run
 * against real PostgreSQL in database.pg.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlendxConfigError, defineConfig } from '@blendx/core';
import { createDatabase } from '../src/database.ts';
import { query } from './support/query.ts';

describe('createDatabase', () => {
  test('pglite with no url, or memory://, is in memory', async () => {
    for (const url of [undefined, 'memory://']) {
      const database = await createDatabase({ database: { driver: 'pglite', url } });
      try {
        expect(database.driver).toBe('pglite');
        expect(await query(database, 'select 1 as one')).toEqual([{ one: 1 }]);
      } finally {
        await database.close();
      }
    }
  });

  test('pglite with a folder keeps its data between opens', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'blendx-pglite-'));
    const config = defineConfig({ database: { driver: 'pglite', url: folder } });
    try {
      const first = await createDatabase(config);
      await query(first, 'create table kept (x int)');
      await query(first, 'insert into kept values (7)');
      await first.close();

      const second = await createDatabase(config);
      expect(await query(second, 'select x from kept')).toEqual([{ x: 7 }]);
      await second.close();
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  test('a server driver needs a url from the config or DATABASE_URL', async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const opening = createDatabase({ database: { driver: 'pg', url: undefined } });
      await expect(opening).rejects.toBeInstanceOf(BlendxConfigError);
      await expect(opening).rejects.toThrow(
        'the pg driver needs config.database.url or DATABASE_URL',
      );
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });

  test('a driver package that is not installed is named', async () => {
    // postgres (for postgres-js) is an optional peer that this repo does not install.
    const opening = createDatabase({
      database: { driver: 'postgres-js', url: 'postgres://localhost/none' },
    });
    await expect(opening).rejects.toBeInstanceOf(BlendxConfigError);
    await expect(opening).rejects.toThrow(
      'the postgres-js driver needs the "postgres" package; add it to your dependencies',
    );
  });
});
