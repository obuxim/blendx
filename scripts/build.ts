/**
 * The publish build (docs/decisions.md D35): dist/ for every package, with declarations and
 * `.ts` imports rewritten to `.js`, in dependency order, since each package's build resolves
 * its siblings to their built declarations (tsconfig.build.json `paths`).
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
/** Dependency order: a package comes after every package it imports. */
export const ORDER = ['dbml', 'core', 'hono', 'blendx', 'cli', 'react'] as const;

for (const name of ORDER) {
  const folder = join(root, 'packages', name);
  await rm(join(folder, 'dist'), { recursive: true, force: true });
  const tsc = Bun.spawnSync(['bun', 'x', 'tsc', '-p', join(folder, 'tsconfig.build.json')], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (tsc.exitCode !== 0) {
    console.error(`build: ${name} failed`);
    process.exit(tsc.exitCode ?? 1);
  }
  console.log(`built packages/${name}/dist`);
}
