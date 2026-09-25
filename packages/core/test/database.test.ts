import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzleCliPath, generateMigrations } from './support/database.ts';

test('drizzle-kit arguments use forward slashes on Windows paths', () => {
  expect(drizzleCliPath('C:\\work\\blendx\\schema.gen.ts')).toBe('C:/work/blendx/schema.gen.ts');
  expect(drizzleCliPath('/tmp/blendx/schema.gen.ts')).toBe('/tmp/blendx/schema.gen.ts');
});

test('a failed drizzle-kit generation removes its temporary output directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blendx-db-test-'));
  try {
    await expect(generateMigrations(join(root, 'missing.schema.ts'), root)).rejects.toThrow(
      'drizzle-kit generate failed',
    );
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
