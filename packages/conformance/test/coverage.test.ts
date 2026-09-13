/**
 * P11.4: the suite covers every derivation rule in packages/spec/derivation-rules.md and every
 * error status, and no two cases share an id.
 */
import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCases } from '../harness/shop.ts';

const ERROR_STATUSES = ['ERR-400', 'ERR-401', 'ERR-403', 'ERR-404', 'ERR-409', 'ERR-422'];

test('every derivation rule and error status has a case, and ids are unique', async () => {
  const spec = await readFile(
    join(import.meta.dir, '..', '..', 'spec', 'derivation-rules.md'),
    'utf8',
  );
  const rules = [...new Set(spec.match(/DR-[A-Z0-9-]*[A-Z0-9]/g) ?? [])];
  const ids = (await loadCases()).map((test) => test.id);

  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  expect(rules.filter((rule) => !ids.includes(rule))).toEqual([]);
  expect(ERROR_STATUSES.filter((status) => !ids.includes(status))).toEqual([]);
  expect(rules).toHaveLength(26);
});
