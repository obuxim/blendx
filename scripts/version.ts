/**
 * The shared version of the six packages (docs/decisions.md D35). `bun run version 0.2.0`
 * sets it everywhere and refreshes the lockfile; `bun run version --check v0.2.0` exits
 * non-zero unless that tag names the version of every package, which the release workflow
 * runs before publishing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ORDER } from './build.ts';

const root = join(import.meta.dir, '..');
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const manifestPath = (name: string) => join(root, 'packages', name, 'package.json');

async function versions(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const name of ORDER) {
    const manifest = JSON.parse(await readFile(manifestPath(name), 'utf8')) as {
      name: string;
      version: string;
    };
    found.set(manifest.name, manifest.version);
  }
  return found;
}

async function set(version: string) {
  for (const name of ORDER) {
    const path = manifestPath(name);
    const text = await readFile(path, 'utf8');
    const changed = text.replace(/^(\s*"version": )"[^"]*"/m, `$1"${version}"`);
    if (changed === text) throw new Error(`${path}: no version field`);
    await writeFile(path, changed);
  }
  const install = Bun.spawnSync(['bun', 'install'], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (install.exitCode !== 0) process.exit(install.exitCode ?? 1);
  console.log(`version ${version} set on ${ORDER.length} packages`);
}

async function check(tag: string) {
  const expected = tag.replace(/^v/, '');
  const wrong = [...(await versions())].filter(([, version]) => version !== expected);
  if (wrong.length > 0) {
    for (const [name, version] of wrong)
      console.error(`${name} is ${version}, tag says ${expected}`);
    process.exit(1);
  }
  console.log(`${tag} names the version of every package`);
}

const [first, second] = process.argv.slice(2);
if (first === '--check' && second) {
  await check(second);
} else if (first && SEMVER.test(first)) {
  await set(first);
} else {
  console.error('usage: bun run version <x.y.z> | bun run version --check v<x.y.z>');
  process.exit(2);
}
