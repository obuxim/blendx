/**
 * P1.5 spike, kept as a regression test.
 *
 * Proves the migration path blendx will use: drizzle-kit generates SQL from a schema
 * file, and drizzle's PGlite migrator applies it in-process inside bun test. It also
 * records how Postgres errors surface through drizzle and PGlite, which the P5.7 error
 * mapping depends on.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { additionResults, customers } from './fixtures/p1-5-schema.ts';

const coreDir = join(import.meta.dir, '..', '..');
const schemaPath = join(import.meta.dir, 'fixtures', 'p1-5-schema.ts');
const client = new PGlite();
const db = drizzle({ client });
let outDir = '';

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'blendx-p1-5-'));
  const kit = Bun.spawnSync(
    [
      process.execPath,
      'x',
      '--bun',
      'drizzle-kit',
      'generate',
      '--dialect=postgresql',
      `--schema=${schemaPath}`,
      `--out=${outDir}`,
      '--name=init',
    ],
    { cwd: coreDir, stdout: 'pipe', stderr: 'pipe' },
  );
  if (kit.exitCode !== 0) {
    throw new Error(`drizzle-kit generate failed:\n${kit.stdout}\n${kit.stderr}`);
  }
  await migrate(db, { migrationsFolder: outDir });
}, 60_000);

afterAll(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

/** SQLSTATE of a failed query, wherever drizzle or the driver put it. */
function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

const failure = (query: PromiseLike<unknown>) =>
  Promise.resolve(query).then(
    () => undefined,
    (error: unknown) => error,
  );

describe('P1.5 drizzle-kit migration applied by PGlite', () => {
  test('drizzle-kit wrote one migration folder: its SQL and its snapshot', async () => {
    const folders = await readdir(outDir);
    expect(folders).toEqual([expect.stringMatching(/^\d{14}_init$/)]);
    const files = await readdir(join(outDir, folders[0] ?? ''));
    expect(files.sort()).toEqual(['migration.sql', 'snapshot.json']);
  });

  test('the migrated schema accepts rows and fills defaults', async () => {
    const [row] = await db.insert(additionResults).values({ result: 7 }).returning();
    expect(row).toMatchObject({ id: 1, result: 7, deleted_at: null });
    expect(typeof row?.created_at).toBe('string');
  });

  test('unique violation surfaces SQLSTATE 23505', async () => {
    await db.insert(customers).values({ email: 'ada@example.com' });
    const error = await failure(db.insert(customers).values({ email: 'ada@example.com' }));
    expect(pgCode(error)).toBe('23505');
  });

  test('over-long varchar surfaces SQLSTATE 22001', async () => {
    const error = await failure(db.insert(customers).values({ email: 'x'.repeat(21) }));
    expect(pgCode(error)).toBe('22001');
  });

  test('invalid enum value surfaces SQLSTATE 22P02', async () => {
    const error = await failure(
      db.insert(customers).values({ email: 'bob@example.com', status: 'shipped' as never }),
    );
    expect(pgCode(error)).toBe('22P02');
  });
});
