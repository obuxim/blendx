/** P17.19: CLI discovery and reporting for versioned data migrations. */
import { afterAll, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase } from 'blendx';
import { sql } from 'blendx/drizzle';
import { loadConfig } from '../src/config.ts';
import { main } from '../src/main.ts';
import { loadDataMigrations } from '../src/migrate.ts';

const roots: string[] = [];

async function app() {
  const scratch = join(import.meta.dir, '..', '.tmp');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'data-migrate-'));
  roots.push(root);
  await cp(join(import.meta.dir, 'fixtures', 'data-migrations-app'), root, { recursive: true });
  await writeFile(
    join(root, 'blendx.config.ts'),
    `import { defineConfig } from 'blendx';\n\nexport default defineConfig({ database: { driver: 'pglite', url: ${JSON.stringify(join(root, 'pgdata'))} } });\n`,
  );
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function cli(root: string, ...argv: string[]) {
  let out = '';
  let err = '';
  const io = {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd: root,
  };
  return { code: await main(argv, { io }), out, err };
}

function module(id: string, body = '') {
  return `import { dataMigration } from 'blendx';\n\nexport default dataMigration({ id: '${id}', async up() { ${body} } });\n`;
}

test('migrate up backfills fixture rows once and reports data migration IDs', async () => {
  const root = await app();
  expect(await cli(root, 'migrate', 'up')).toEqual({
    code: 0,
    out: 'applied 2 migrations from drizzle\napplied data migration 20260926_backfill_order_placed_on\n',
    err: '',
  });

  const database = await createDatabase({
    database: { driver: 'pglite', url: join(root, 'pgdata') },
  });
  try {
    const result = await database.db.execute(sql.raw('select placed_on from orders where id = 1'));
    const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
    expect(rows).toEqual([{ placed_on: '2026-09-01' }]);
  } finally {
    await database.close();
  }

  expect(await cli(root, 'migrate', 'up')).toEqual({
    code: 0,
    out: 'drizzle: no pending migrations\ndata-migrations: no pending data migrations\n',
    err: '',
  });
});

test('loader accepts a missing directory and orders top-level TypeScript modules', async () => {
  const root = await app();
  const migrations = join(root, 'data-migrations');
  await rm(migrations, { recursive: true });
  expect(await loadDataMigrations(await loadConfig(root))).toEqual([]);

  await mkdir(migrations);
  await writeFile(join(migrations, '20260927_zeta.ts'), module('20260927_zeta'));
  await writeFile(join(migrations, '20260927_alpha.ts'), module('20260927_alpha'));
  await writeFile(join(migrations, '20260927_ignored.d.ts'), 'export {};\n');
  await writeFile(join(migrations, '20260927_ignored.test.ts'), 'export {};\n');
  expect(
    (await loadDataMigrations(await loadConfig(root))).map((migration) => migration.id),
  ).toEqual(['20260927_alpha', '20260927_zeta']);
});

test('loader names invalid default exports and filename mismatches', async () => {
  const invalidRoot = await app();
  const invalid = join(invalidRoot, 'data-migrations', '20260925_invalid.ts');
  await writeFile(invalid, 'export default {};\n');
  await expect(loadDataMigrations(await loadConfig(invalidRoot))).rejects.toThrow(
    'data-migrations/20260925_invalid.ts must default-export dataMigration(...)',
  );

  const mismatchRoot = await app();
  const mismatch = join(mismatchRoot, 'data-migrations', '20260925_file_name.ts');
  await writeFile(mismatch, module('20260925_declared_name'));
  await expect(loadDataMigrations(await loadConfig(mismatchRoot))).rejects.toThrow(
    'data-migrations/20260925_file_name.ts declares 20260925_declared_name; name it data-migrations/20260925_declared_name.ts',
  );
});

test('a failed data step names its ID and cause, then stops later steps', async () => {
  const root = await app();
  const migrations = join(root, 'data-migrations');
  await writeFile(
    join(migrations, '20260925_failing.ts'),
    module('20260925_failing', "throw new Error('backfill exploded');"),
  );
  await writeFile(
    join(migrations, '20260927_later.ts'),
    module('20260927_later', "throw new Error('later migration ran');"),
  );

  expect(await cli(root, 'migrate', 'up')).toEqual({
    code: 1,
    out: '',
    err: 'data migration 20260925_failing failed: backfill exploded\n',
  });
  const database = await createDatabase({
    database: { driver: 'pglite', url: join(root, 'pgdata') },
  });
  try {
    const result = await database.db.execute(sql.raw('select placed_on from orders where id = 1'));
    const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
    expect(rows).toEqual([{ placed_on: null }]);
  } finally {
    await database.close();
  }
});
