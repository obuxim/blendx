/**
 * P10.2: calculate's source and returned keys, read from a real blend file with the
 * TypeScript 6 compiler API: a spread, a literal, a conditional and a method with several
 * returns. Actions without calculate have nothing to extract.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { extractCalculates } from '../src/calculates.ts';

const file = join(import.meta.dir, 'fixtures', 'calculates', 'orders.ts');

describe('extractCalculates', () => {
  const started = performance.now();
  const found = extractCalculates([file]).get(file);
  const elapsed = performance.now() - started;

  test('a spread of prev yields every writable column', () => {
    expect(found?.get('store')?.keys).toEqual([
      'meta',
      'placed_on',
      'public_id',
      'quantity',
      'status',
      'tags',
      'total',
      'user_id',
    ]);
  });

  test('a literal yields its keys, a conditional the union of its branches', () => {
    expect(found?.get('update')?.keys).toEqual(['total']);
    expect(found?.get('pay')?.keys).toEqual(['placed_on', 'status']);
  });

  test('a method with several returns yields every key it can return', () => {
    expect(found?.get('quote')?.keys).toEqual(['discount', 'total']);
    expect(found?.get('quote')?.source.startsWith('calculate({ input }) {')).toBe(true);
  });

  test('source is the hook exactly as written', () => {
    expect(found?.get('pay')?.source).toBe(
      "({ input }) =>\n        input.paid ? { status: 'paid' as const } : { status: 'pending' as const, placed_on: null }",
    );
  });

  test('only actions with a calculate hook appear', () => {
    expect([...(found?.keys() ?? [])].sort()).toEqual(['pay', 'quote', 'store', 'update']);
  });

  test('one program over the blend files stays quick', () => {
    expect(elapsed).toBeLessThan(20_000);
  });
});
