/** The review examples of the expenses example hold, run from the app's own tests. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkExamples } from '@blendx/cli/examples';

test('review/*.examples.yaml hold', async () => {
  const result = await checkExamples(join(import.meta.dir, '..'));
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(16);
});
