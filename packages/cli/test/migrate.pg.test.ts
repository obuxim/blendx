/**
 * P7.6: `blendx migrate generate` then `up` on real PostgreSQL (BLENDX_TEST_DB=pg with
 * DATABASE_URL). It resets that database's public and drizzle schemas, so use a scratch one.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase } from 'blendx';
import { sql } from 'blendx/drizzle';
import { main } from '../src/main.ts';

const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

describe.skipIf(!realPostgres)('blendx migrate on PostgreSQL', () => {
  let app: string;
  beforeAll(async () => {
    const scratch = join(import.meta.dir, '..', '.tmp');
    await mkdir(scratch, { recursive: true });
    app = await mkdtemp(join(scratch, 'migrate-pg-'));
    await cp(join(import.meta.dir, 'fixtures', 'shop-app'), app, { recursive: true });
    await writeFile(
      join(app, 'blendx.config.ts'),
      `import { defineConfig } from 'blendx';\n\nexport default defineConfig({ database: { driver: 'pg' } });\n`,
    );

    const database = await createDatabase({ database: { driver: 'pg', url: undefined } });
    try {
      await database.db.execute(sql.raw('drop schema if exists drizzle cascade'));
      await database.db.execute(sql.raw('drop schema if exists public cascade'));
      await database.db.execute(sql.raw('create schema public'));
    } finally {
      await database.close();
    }
  }, 30_000);
  afterAll(() => rm(app, { recursive: true, force: true }));

  const cli = async (...argv: string[]) => {
    let out = '';
    let err = '';
    const io = {
      out: (text: string) => {
        out += text;
      },
      err: (text: string) => {
        err += text;
      },
      cwd: app,
    };
    return { code: await main(argv, { io }), out, err };
  };

  test('generate, then up applies the migration with the pg driver', async () => {
    expect((await cli('migrate', 'generate', '--name', 'init')).code).toBe(0);
    expect(await cli('migrate', 'up')).toEqual({
      code: 0,
      out: 'applied 1 migration from drizzle\n',
      err: '',
    });

    const database = await createDatabase({ database: { driver: 'pg', url: undefined } });
    try {
      const result = await database.db.execute(
        sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
      );
      expect((result as unknown as { rows: unknown[] }).rows).toEqual([
        { table_name: 'order_notes' },
        { table_name: 'orders' },
        { table_name: 'users' },
      ]);
    } finally {
      await database.close();
    }
  }, 60_000);
});
