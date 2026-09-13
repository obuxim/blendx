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
    expect(out).toMatch(/drizzle\/\d{14}_init\/migration\.sql/);
    expect(await migrations()).toEqual([expect.stringMatching(/^\d{14}_init$/)]);
  }, 60_000);

  test('generate with no schema change adds nothing', async () => {
    const { code, out } = await cli('migrate', 'generate');
    expect(code).toBe(0);
    expect(out).toContain('No schema changes');
    expect(await migrations()).toEqual([expect.stringMatching(/^\d{14}_init$/)]);
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

  test('up refuses the drizzle-kit 0.x layout and says how to convert it', async () => {
    const meta = join(app, 'drizzle', 'meta');
    await mkdir(meta);
    await writeFile(join(meta, '_journal.json'), '{}');
    try {
      expect(await cli('migrate', 'up')).toEqual({
        code: 1,
        out: '',
        err: "drizzle is in the drizzle-kit 0.x layout (meta/_journal.json), which drizzle-kit 1.0 does not read; convert it once with drizzle-kit 1.0's `up` command\n",
      });
    } finally {
      await rm(meta, { recursive: true });
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

describe('the outbox table (D27)', () => {
  const bin = join(import.meta.dir, '..', 'src', 'bin.ts');

  /** The bin in a fresh process, so that an edited blend is not read from this one's cache. */
  const spawnCli = (...argv: string[]) => {
    const run = Bun.spawnSync([process.execPath, bin, ...argv, '--cwd', app], {
      timeout: 60_000,
    });
    return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
  };

  /** Gives the copy's orders update a later hook. */
  const addLaterHook = async () => {
    const file = join(app, 'blends', 'orders.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('a.update(),', 'a.update({ later: () => {} }),'));
  };

  test('generate refuses while outbox.gen.ts is out of date', async () => {
    await addLaterHook();
    expect(spawnCli('migrate', 'generate')).toEqual({
      code: 1,
      out: '',
      err: 'src/generated/outbox.gen.ts is out of date; run `blendx generate` first\n',
    });
  }, 60_000);

  test("a later hook's first migration creates the outbox table", async () => {
    await addLaterHook();
    expect(spawnCli('generate').code).toBe(0);
    const outboxFile = await readFile(join(app, 'src', 'generated', 'outbox.gen.ts'), 'utf8');
    expect(outboxFile).toContain('export { outbox } from "blendx/drizzle";');

    expect(spawnCli('migrate', 'generate', '--name', 'outbox').code).toBe(0);
    const folder = (await migrations()).find((name) => name.endsWith('_outbox'));
    expect(folder).toBeDefined();
    const sql = await readFile(join(app, 'drizzle', String(folder), 'migration.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE "blendx_outbox"');
    expect(sql).not.toContain('CREATE TABLE "orders"');
  }, 120_000);
});
