import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadConfig } from '@blendx/cli';
import { BlendxConfigError } from '@blendx/core';

const fixtures = join(import.meta.dir, 'fixtures');

describe('loadConfig', () => {
  test('resolves every path against the config folder and keeps the settings', async () => {
    const root = join(fixtures, 'config-app');
    expect(await loadConfig(root)).toEqual({
      root,
      file: join(root, 'blendx.config.ts'),
      schema: join(root, 'db/schema.dbml'),
      blends: join(root, 'blends'),
      app: join(root, 'src/app.ts'),
      generated: join(root, 'src/generated'),
      review: join(root, 'review'),
      migrations: join(root, 'drizzle'),
      dataMigrations: join(root, 'data-migrations'),
      database: { driver: 'pglite', url: 'memory://' },
      openapi: { title: 'Addition API', version: '1.0.0' },
    });
  });

  test('a plain default export is validated and filled with defaults', async () => {
    const root = join(fixtures, 'config-plain');
    const config = await loadConfig(root);
    expect(config.blends).toBe(join(root, 'src/blends'));
    expect(config.schema).toBe(join(root, 'schema.dbml'));
    expect(config.database).toEqual({ driver: 'pg', url: undefined });
  });

  test('an invalid config fails with a clear message', async () => {
    const error = await loadConfig(join(fixtures, 'config-invalid')).catch((e: unknown) => e);
    expect(error).toEqual(
      new BlendxConfigError(
        'config.database.driver must be one of pg, postgres-js, bun-sql, pglite; got "mysql"',
      ),
    );
  });

  test('a folder without a config file', async () => {
    const error = await loadConfig(fixtures).catch((e: unknown) => e);
    expect(error).toEqual(
      new BlendxConfigError(
        `no blendx config in ${fixtures} (looked for blendx.config.ts, blendx.config.js, blendx.config.mjs)`,
      ),
    );
  });
});
