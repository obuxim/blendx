/** P7.5: the unified diff that `generate --check` prints, in the format of `diff -u`. */
import { describe, expect, test } from 'bun:test';
import { unifiedDiff } from '../src/diff.ts';

const labels = { from: 'a.ts', to: 'b.ts' };
const lines = (...items: string[]) => items.map((item) => `${item}\n`).join('');

describe('unifiedDiff', () => {
  test('equal texts have no diff', () => {
    expect(unifiedDiff('a\n', 'a\n', labels)).toBe('');
  });

  test('one changed line, with three lines of context on each side', () => {
    const before = lines('a', 'b', 'c', 'd', 'e', 'f', 'g');
    const after = lines('a', 'b', 'c', 'D', 'e', 'f', 'g');
    expect(unifiedDiff(before, after, labels)).toBe(
      lines(
        '--- a.ts',
        '+++ b.ts',
        '@@ -1,7 +1,7 @@',
        ' a',
        ' b',
        ' c',
        '-d',
        '+D',
        ' e',
        ' f',
        ' g',
      ),
    );
  });

  test('distant changes make separate hunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const after = before.map((line) =>
      line === 'l2' || line === 'l18' ? line.toUpperCase() : line,
    );
    expect(unifiedDiff(lines(...before), lines(...after), labels)).toBe(
      lines(
        '--- a.ts',
        '+++ b.ts',
        '@@ -1,5 +1,5 @@',
        ' l1',
        '-l2',
        '+L2',
        ' l3',
        ' l4',
        ' l5',
        '@@ -15,6 +15,6 @@',
        ' l15',
        ' l16',
        ' l17',
        '-l18',
        '+L18',
        ' l19',
        ' l20',
      ),
    );
  });

  test('changes six lines apart share a hunk', () => {
    const before = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);
    const after = before.map((line) =>
      line === 'l2' || line === 'l9' ? line.toUpperCase() : line,
    );
    const diff = unifiedDiff(lines(...before), lines(...after), labels);
    expect(diff.match(/^@@/gm)).toHaveLength(1);
    expect(diff).toContain('@@ -1,12 +1,12 @@\n');
  });

  test('removed lines print before added ones', () => {
    expect(unifiedDiff(lines('a', 'b', 'c'), lines('a', 'x', 'y', 'c'), labels)).toBe(
      lines('--- a.ts', '+++ b.ts', '@@ -1,3 +1,4 @@', ' a', '-b', '+x', '+y', ' c'),
    );
  });

  test('from an empty file, and to one', () => {
    expect(unifiedDiff('', lines('a', 'b'), labels)).toBe(
      lines('--- a.ts', '+++ b.ts', '@@ -0,0 +1,2 @@', '+a', '+b'),
    );
    expect(unifiedDiff(lines('a'), '', labels)).toBe(
      lines('--- a.ts', '+++ b.ts', '@@ -1 +0,0 @@', '-a'),
    );
  });

  test('a missing final newline is marked', () => {
    expect(unifiedDiff('a', 'a\n', labels)).toBe(
      lines('--- a.ts', '+++ b.ts', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+a'),
    );
  });
});
