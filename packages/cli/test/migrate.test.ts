/**
 * P7.6: `blendx migrate generate` runs the pinned drizzle-kit with drizzle.config.gen.ts, and
 * `blendx migrate up` applies what it wrote through createDatabase. It runs on a copy of the
 * shop-app fixture with a PGlite data folder; migrate.pg.test.ts repeats it on PostgreSQL.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase } from 'blendx';
import { sql } from 'blendx/drizzle';
import { main } from '../src/main.ts';

let app: string;
beforeAll(async () => {
  // Inside the package, so the copy still resolves blendx from packages/cli/node_modules.
  const scratch = join(import.meta.dir, '..', '.tmp');
  await mkdir(scratch, { recursive: true });
  app = await mkdtemp(join(scratch, 'migrate-'));
  await cp(join(import.meta.dir, 'fixtures', 'shop-app'), app, { recursive: true });
  const database = { driver: 'pglite', url: join(app, 'pgdata') };
  await writeFile(
    join(app, 'blendx.config.ts'),
    `import { defineConfig } from 'blendx';\n\nexport default defineConfig({ database: ${JSON.stringify(database)} });\n`,
  );
}, 30_000);
afterAll(() => rm(app, { recursive: true, force: true }));

async function cli(...argv: string[]) {
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
  const code = await main(argv, { io });
  return { code, out, err };
}

const migrations = () => readdir(join(app, 'drizzle')).then((names) => names.sort());

describe('blendx migrate', () => {
  test('generate writes the first migration with drizzle-kit', async () => {
    const { code, out } = await cli('migrate', 'generate', '--name', 'init');
    expect(code).toBe(0);
    expect(out).toContain('0000_init.sql');
    expect(await migrations()).toEqual(['0000_init.sql', 'meta']);
  }, 60_000);

  test('generate with no schema change adds nothing', async () => {
    const { code, out } = await cli('migrate', 'generate');
    expect(code).toBe(0);
    expect(out).toContain('No schema changes');
    expect(await migrations()).toEqual(['0000_init.sql', 'meta']);
  }, 60_000);

  test('up applies the migration once', async () => {
    expect(await cli('migrate', 'up')).toEqual({
      code: 0,
      out: 'applied 1 migration from drizzle\n',
      err: '',
    });
    expect(await cli('migrate', 'up')).toEqual({
      code: 0,
      out: 'drizzle: no pending migrations\n',
      err: '',
    });

    const database = await createDatabase({
      database: { driver: 'pglite', url: join(app, 'pgdata') },
    });
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
  });

  test('generate refuses while schema.gen.ts is out of date', async () => {
    const schema = join(app, 'schema.dbml');
    const original = await readFile(schema, 'utf8');
    await writeFile(schema, `${original}\nTable tags {\n  id integer [pk, increment]\n}\n`);
    try {
      expect(await cli('migrate', 'generate')).toEqual({
        code: 1,
        out: '',
        err: 'src/generated/schema.gen.ts is out of date; run `blendx generate` first\n',
      });
    } finally {
      await writeFile(schema, original);
    }
  });

  test('up without migrations says what to run', async () => {
    const folder = join(app, 'drizzle');
    await rename(folder, `${folder}.bak`);
    try {
      expect(await cli('migrate', 'up')).toEqual({
        code: 1,
        out: '',
        err: 'no migrations in drizzle; run `blendx migrate generate`\n',
      });
    } finally {
      await rename(`${folder}.bak`, folder);
    }
  });

  test('an unknown action is a usage error', async () => {
    expect(await cli('migrate', 'sideways')).toEqual({
      code: 2,
      out: '',
      err: 'usage: blendx migrate generate [--name <name>] | blendx migrate up\n',
    });
  });
});
