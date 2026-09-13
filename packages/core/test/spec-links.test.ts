/**
 * P12.1, P12.3: every relative link in packages/spec and in the cookbook resolves, and a link
 * to a test file uses the name of a test in it, so a doc cannot outlive the test that pins it.
 */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = join(import.meta.dir, '..', '..', '..');
const spec = join(root, 'packages', 'spec');

test('links in the docs resolve, and test links name a test in that file', async () => {
  const docs = [
    ...(await readdir(spec))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => join(spec, name)),
    join(root, 'docs', 'cookbook.md'),
  ];
  const problems: string[] = [];
  let testLinks = 0;
  for (const doc of docs) {
    const shown = doc.slice(root.length + 1);
    const text = await readFile(doc, 'utf8');
    for (const [, label = '', target = ''] of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/.test(target) || target.startsWith('#')) continue;
      const path = resolve(dirname(doc), target.split('#')[0] ?? '');
      if (!existsSync(path)) {
        problems.push(`${shown}: ${target} does not exist`);
        continue;
      }
      if (!path.endsWith('.test.ts')) continue;
      testLinks += 1;
      const source = await readFile(path, 'utf8');
      if (!source.includes(`'${label}'`) && !source.includes(`"${label}"`)) {
        problems.push(`${shown}: ${target} has no test named "${label}"`);
      }
    }
  }
  expect(problems).toEqual([]);
  expect(testLinks).toBeGreaterThan(60);
});
