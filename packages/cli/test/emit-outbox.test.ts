/**
 * P16.5 (D27): outbox.gen.ts. Once the app has a later hook, it re-exports core's outbox table,
 * which drizzle-kit then creates with the app's own tables; otherwise it exports nothing.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { outbox } from '@blendx/core';
import { emitOutbox } from '../src/emit-outbox.ts';
import { expectGolden } from './support/golden.ts';

const golden = join(import.meta.dir, 'golden', 'outbox.gen.ts');

describe('emitOutbox', () => {
  test('with a later hook: the outbox table', async () => {
    await expectGolden(golden, emitOutbox(true));
  });

  test('the golden re-exports the very table the engine and the worker use', async () => {
    const generated = await import(golden);
    expect(generated.outbox).toBe(outbox);
  });

  test('without one: no table', () => {
    const output = emitOutbox(false);
    expect(output).toContain('export {};');
    expect(output).not.toContain('blendx/drizzle');
  });
});
