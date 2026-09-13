/**
 * P10.5: review examples run without a database, the way the engine runs an action: the
 * resolved rules validate the input, calculate runs on it, and the result is compared.
 * A failure is one readable line.
 */
import { describe, expect, test } from 'bun:test';
import { allow, blend, defineApp } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { runExamples } from '../src/examples.ts';

const additions = blend(addition.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.update(),
    a.show(),
    a.collection('preview', {
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ sum: input.a + input.b }),
    }),
    a.member('double', {
      calculate: ({ record }) => ({ result: (record.result ?? 0) * 2 }),
    }),
  ],
});

const app = defineApp({});
const run = (examples: unknown) => runExamples(additions, app, examples);
const row = { id: 1, result: 3, created_at: null, updated_at: null, deleted_at: null };

describe('runExamples', () => {
  test('examples that hold: writes, returns, rejects, and plain accepted input', () => {
    expect(
      run({
        store: [
          { name: 'adds a and b', input: { a: 4, b: 3 }, writes: { result: 7 } },
          { input: { a: 'four' }, rejects: ['/a', '/b'] },
          { input: { a: 1, b: 2, result: 9 }, rejects: ['/result'] },
        ],
        update: [{ record: row, input: { result: 10 }, writes: { result: 10 } }],
        show: [{ input: {} }],
        preview: [{ input: { a: 4, b: 3 }, returns: { sum: 7 } }],
        double: [{ record: row, writes: { result: 6 } }],
      }),
    ).toEqual({ passed: 7, failures: [] });
  });

  test('a wrong result names what calculate wrote and what was expected', () => {
    expect(run({ store: [{ input: { a: 4, b: 3 }, writes: { result: 8 } }] })).toEqual({
      passed: 0,
      failures: ['store #1: writes {"result":7}, expected {"result":8}'],
    });
  });

  test('validation that rejects the wrong fields, or nothing at all', () => {
    expect(
      run({
        store: [
          { input: { a: 'four', b: 3 }, rejects: ['/b'] },
          { input: { a: 1, b: 2 }, rejects: '/a' },
        ],
      }).failures,
    ).toEqual([
      'store #1: rejected at ["/a"], expected ["/b"]',
      'store #2: expected the input to be rejected at ["/a"], but it passed',
    ]);
  });

  test('input that should pass but is rejected says why, with the example name', () => {
    const [failure] = run({
      store: [{ name: 'strings', input: { a: '1', b: 2 }, writes: { result: 3 } }],
    }).failures;
    expect(failure).toStartWith('store #1 (strings): input rejected: /a: ');
  });

  test('mistakes in the file itself are failures too', () => {
    expect(
      run({
        refund: [],
        store: [{ input: { a: 1, b: 1 }, writs: { result: 2 } }],
        preview: [{ input: { a: 1, b: 1 }, writes: { sum: 2 } }],
        show: [{ input: {}, writes: {} }],
        update: 'none',
      }).failures,
    ).toEqual([
      'refund: addition_results has no action "refund"',
      'store #1: unknown key "writs"; use input, record, writes, returns or rejects',
      'preview #1: preview returns; use returns, not writes',
      'show #1: show does not calculate; give only input or rejects',
      'update: expected a list of examples',
    ]);
    expect(run(['store']).failures).toEqual([
      'the file must map action names to lists of examples',
    ]);
    expect(run(null)).toEqual({ passed: 0, failures: [] });
  });

  test('a calculate that throws is a failure, not a crash', () => {
    const [failure] = run({ double: [{ writes: { result: 0 } }] }).failures;
    expect(failure).toStartWith('double #1: calculate threw: ');
  });
});
