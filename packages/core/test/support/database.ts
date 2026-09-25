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

/** Drizzle-kit accepts Windows absolute paths only when its CLI arguments use `/`. */
export const drizzleCliPath = (path: string) => path.replaceAll('\\', '/');

const removeMigrations = (out: string) => rm(out, { recursive: true, force: true });

/** Cleanup from a failed setup must not hide the setup error. */
async function removeAfterFailure(out: string, close?: () => Promise<unknown>) {
  try {
    await close?.();
  } catch {
    // The setup error is the useful one.
  }
  try {
    await removeMigrations(out);
  } catch {
    // The setup error is the useful one.
  }
}

export const goldenSchema = (name: 'addition' | 'shop' | 'kitchen-sink') =>
  join(coreDir, '..', 'dbml', 'test', 'golden', `${name}.schema.gen.ts`);

/** BLENDX_TEST_DB=pg with DATABASE_URL (a scratch database) enables the real PostgreSQL tests. */
export const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

export async function generateMigrations(
  schemaFile: string,
  temporaryRoot = tmpdir(),
): Promise<string> {
  const out = await mkdtemp(join(temporaryRoot, 'blendx-db-'));
  try {
    const kit = Bun.spawnSync(
      [
        process.execPath,
        'x',
        '--bun',
        'drizzle-kit',
        'generate',
        '--dialect=postgresql',
        `--schema=${drizzleCliPath(schemaFile)}`,
        `--out=${drizzleCliPath(out)}`,
        '--name=init',
      ],
      { cwd: coreDir, stdout: 'pipe', stderr: 'pipe' },
    );
    if (kit.exitCode !== 0) {
      throw new Error(`drizzle-kit generate failed:\n${kit.stdout}\n${kit.stderr}`);
    }
    return out;
  } catch (error) {
    await removeAfterFailure(out);
    throw error;
  }
}

/** An in-process PGlite database. Pass `log` to collect every query, lowercased. */
export async function migratedDatabase(
  schemaFile: string,
  options: { log?: string[] } = {},
): Promise<TestDatabase> {
  const out = await generateMigrations(schemaFile);
  let client: PGlite | undefined;
  try {
    client = new PGlite();
    const openedClient = client;
    const { log } = options;
    const db = drizzle({
      client: openedClient,
      ...(log ? { logger: { logQuery: (query: string) => log.push(query.toLowerCase()) } } : {}),
    });
    await migrate(db, { migrationsFolder: out });
    return {
      db: db as unknown as Db,
      async close() {
        await openedClient.close();
        await removeMigrations(out);
      },
    };
  } catch (error) {
    const failedClient = client;
    await removeAfterFailure(out, failedClient ? () => failedClient.close() : undefined);
    throw error;
  }
}

/**
 * The PostgreSQL database at DATABASE_URL. It drops and recreates the public schema, so
 * point it at a scratch database.
 */
export async function postgresDatabase(schemaFile: string): Promise<TestDatabase & { pool: Pool }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('BLENDX_TEST_DB=pg needs DATABASE_URL pointing at a scratch database');
  const out = await generateMigrations(schemaFile);
  let pool: Pool | undefined;
  try {
    pool = new Pool({ connectionString: url });
    const openedPool = pool;
    await openedPool.query(
      'drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public',
    );
    const db = drizzlePostgres({ client: openedPool });
    await migratePostgres(db, { migrationsFolder: out });
    return {
      db: db as unknown as Db,
      pool: openedPool,
      async close() {
        await openedPool.end();
        await removeMigrations(out);
      },
    };
  } catch (error) {
    const failedPool = pool;
    await removeAfterFailure(out, failedPool ? () => failedPool.end() : undefined);
    throw error;
  }
}
