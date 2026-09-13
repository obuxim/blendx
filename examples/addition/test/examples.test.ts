/** P10.5: the addition example's review examples hold, run from the app's own tests. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkExamples } from '@blendx/cli/examples';

test('review/addition_results.examples.yaml holds', async () => {
  const result = await checkExamples(join(import.meta.dir, '..'));
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(4);
});
