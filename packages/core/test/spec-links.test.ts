/**
 * P12.1: every relative link in packages/spec resolves, and a link to a test file uses the
 * name of a test in it, so a spec entry cannot outlive the test that pins it.
 */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const spec = join(import.meta.dir, '..', '..', 'spec');

test('links in the spec docs resolve, and test links name a test in that file', async () => {
  const problems: string[] = [];
  let testLinks = 0;
  const docs = (await readdir(spec)).filter((name) => name.endsWith('.md')).sort();
  for (const doc of docs) {
    const text = await readFile(join(spec, doc), 'utf8');
    for (const [, label = '', target = ''] of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
      const path = resolve(spec, target.split('#')[0] ?? '');
      if (!existsSync(path)) {
        problems.push(`${doc}: ${target} does not exist`);
        continue;
      }
      if (!path.endsWith('.test.ts')) continue;
      testLinks += 1;
      const source = await readFile(path, 'utf8');
      if (!source.includes(`'${label}'`) && !source.includes(`"${label}"`)) {
        problems.push(`${doc}: ${target} has no test named "${label}"`);
      }
    }
  }
  expect(problems).toEqual([]);
  expect(testLinks).toBeGreaterThan(50);
});
