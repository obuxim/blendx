/** P4.2: packages/spec/derivation-rules.md and the derivation tests name the same rule ids. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const ruleIds = (text: string) => [...new Set(text.match(/DR-[A-Z0-9-]*[A-Z0-9]/g) ?? [])].sort();

test('the spec table and the tests list the same derivation rules', async () => {
  const spec = await Bun.file(join(root, 'packages/spec/derivation-rules.md')).text();
  const tests = await Bun.file(join(root, 'packages/core/test/derive-rules.test.ts')).text();
  expect(ruleIds(spec)).toEqual(ruleIds(tests));
  expect(ruleIds(spec)).toHaveLength(24);
});
