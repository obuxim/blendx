/**
 * Test helper: a PGlite database migrated from a generated schema file. drizzle-kit (on
 * Bun) writes the migration into a temp folder, and drizzle's PGlite migrator applies it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@blendx/core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const coreDir = join(import.meta.dir, '..', '..');

export const goldenSchema = (name: 'addition' | 'shop') =>
  join(coreDir, '..', 'dbml', 'test', 'golden', `${name}.schema.gen.ts`);

export interface TestDatabase {
  db: Db;
  close(): Promise<void>;
}

export async function migratedDatabase(schemaFile: string): Promise<TestDatabase> {
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
  const client = new PGlite();
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: out });
  return {
    db: db as unknown as Db,
    async close() {
      await client.close();
      await rm(out, { recursive: true, force: true });
    },
  };
}
