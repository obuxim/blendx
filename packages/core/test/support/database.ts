/**
 * Test helpers: databases migrated from a generated schema file. drizzle-kit (on Bun)
 * writes the migration into a temp folder, and drizzle's migrator applies it to PGlite, or
 * to real PostgreSQL when BLENDX_TEST_DB=pg.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@blendx/core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Pool } from 'pg';

const coreDir = join(import.meta.dir, '..', '..');

export const goldenSchema = (name: 'addition' | 'shop' | 'kitchen-sink') =>
  join(coreDir, '..', 'dbml', 'test', 'golden', `${name}.schema.gen.ts`);

/** BLENDX_TEST_DB=pg with DATABASE_URL (a scratch database) enables the real PostgreSQL tests. */
export const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

async function generateMigrations(schemaFile: string): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'blendx-db-'));
  const kit = Bun.spawnSync(
    [
      process.execPath,
      'x',
      '--bun',
      'drizzle-kit',
      'generate',
      '--dialect=postgresql',
      `--schema=${schemaFile}`,
      `--out=${out}`,
      '--name=init',
    ],
    { cwd: coreDir, stdout: 'pipe', stderr: 'pipe' },
  );
  if (kit.exitCode !== 0) {
    throw new Error(`drizzle-kit generate failed:\n${kit.stdout}\n${kit.stderr}`);
  }
  return out;
}

/** An in-process PGlite database. Pass `log` to collect every query, lowercased. */
export async function migratedDatabase(
  schemaFile: string,
  options: { log?: string[] } = {},
): Promise<TestDatabase> {
  const out = await generateMigrations(schemaFile);
  const client = new PGlite();
  const { log } = options;
  const db = drizzle({
    client,
    ...(log ? { logger: { logQuery: (query: string) => log.push(query.toLowerCase()) } } : {}),
  });
  await migrate(db, { migrationsFolder: out });
  return {
    db: db as unknown as Db,
    async close() {
      await client.close();
      await rm(out, { recursive: true, force: true });
    },
  };
}

/**
 * The PostgreSQL database at DATABASE_URL. It drops and recreates the public schema, so
 * point it at a scratch database.
 */
export async function postgresDatabase(schemaFile: string): Promise<TestDatabase & { pool: Pool }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('BLENDX_TEST_DB=pg needs DATABASE_URL pointing at a scratch database');
  const out = await generateMigrations(schemaFile);
  const pool = new Pool({ connectionString: url });
  await pool.query(
    'drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public',
  );
  const db = drizzlePostgres({ client: pool });
  await migratePostgres(db, { migrationsFolder: out });
  return {
    db: db as unknown as Db,
    pool,
    async close() {
      await pool.end();
      await rm(out, { recursive: true, force: true });
    },
  };
}
