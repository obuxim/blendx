/**
 * P7.2: register.gen.ts and drizzle.config.gen.ts. The register golden lives in its own
 * tsconfig project (test/register), which proves the augmentation reaches blendx; module
 * augmentation is global, so the root project must not include it.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { emitDrizzleConfig } from '../src/emit-drizzle-config.ts';
import { emitRegister } from '../src/emit-register.ts';
import { relativeTo } from '../src/paths.ts';
import { expectGolden } from './support/golden.ts';

describe('emitRegister', () => {
  test('registers the app module with blendx', async () => {
    await expectGolden(
      join(import.meta.dir, 'register', 'generated', 'register.gen.ts'),
      emitRegister(relativeTo('/app/generated', '/app/app.ts')),
    );
  });
});

describe('emitDrizzleConfig', () => {
  const golden = join(import.meta.dir, 'golden', 'drizzle.config.gen.ts');

  test('schema and migrations folder, relative to the app root', async () => {
    const root = '/app';
    await expectGolden(
      golden,
      emitDrizzleConfig({
        schema: relativeTo(root, '/app/src/generated/schema.gen.ts'),
        out: relativeTo(root, '/app/drizzle'),
      }),
    );
  });

  test('default-exports the object drizzle-kit reads', async () => {
    const { default: config } = await import(golden);
    expect(config).toEqual({
      dialect: 'postgresql',
      schema: './src/generated/schema.gen.ts',
      out: './drizzle',
    });
  });
});

describe('relativeTo', () => {
  test('always starts with ./ or ../ and uses /', () => {
    expect(relativeTo('/app/src/generated', '/app/blends/orders.ts')).toBe(
      '../../blends/orders.ts',
    );
    expect(relativeTo('/app/src/generated', '/app/src/generated/schema.gen.ts')).toBe(
      './schema.gen.ts',
    );
    expect(relativeTo('/app', '/app/drizzle')).toBe('./drizzle');
    expect(relativeTo('/app/src', '/app')).toBe('..');
  });
});
