import { describe, expect, test } from 'bun:test';
import { BlendxConfigError, defineConfig } from '@blendx/core';

describe('defineConfig', () => {
  test('fills in the conventional layout and the pg driver', () => {
    expect(defineConfig()).toEqual({
      schema: './schema.dbml',
      blends: './blends',
      app: './src/app.ts',
      generated: './src/generated',
      review: './review',
      migrations: './drizzle',
      database: { driver: 'pg', url: undefined },
      openapi: { title: 'blendx API', version: '0.1.0' },
    });
  });

  test('keeps what the app sets', () => {
    const config = defineConfig({
      schema: './db/schema.dbml',
      database: { driver: 'pglite', url: 'memory://' },
      openapi: { title: 'Addition API', version: '1.0.0' },
    });
    expect(config.schema).toBe('./db/schema.dbml');
    expect(config.blends).toBe('./blends');
    expect(config.database).toEqual({ driver: 'pglite', url: 'memory://' });
    expect(config.openapi).toEqual({ title: 'Addition API', version: '1.0.0' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('rejects unknown drivers and empty paths', () => {
    expect(() => defineConfig({ database: { driver: 'mysql' as never } })).toThrow(
      new BlendxConfigError(
        'config.database.driver must be one of pg, postgres-js, bun-sql, pglite; got "mysql"',
      ),
    );
    expect(() => defineConfig({ blends: ' ' })).toThrow(
      new BlendxConfigError('config.blends must be a non-empty path'),
    );
  });
});
