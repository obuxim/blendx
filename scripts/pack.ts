/**
 * Packs the six packages for npm (docs/decisions.md D35): `bun run pack <folder>` writes one
 * tarball per package into the folder. The repository's manifests stay on the sources, so the
 * tests and the typecheck run without a build; this script derives each publish manifest:
 * `exports` and `bin` on dist/, `files` limited to it, the shared version in place of
 * `workspace:*`, no dev dependencies, not private. Run `bun run build` first.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ORDER } from './build.ts';

const root = join(import.meta.dir, '..');
const REPOSITORY = 'https://github.com/obuxim/blendx';

interface Manifest {
  name: string;
  version: string;
  description?: string;
  exports?: Record<string, string>;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** `./src/x.ts` as it is published: the built module and its declarations under dist/. */
function built(source: string): { types: string; default: string } {
  const stem = source.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '');
  return { types: `${stem}.d.ts`, default: `${stem}.js` };
}

/** The publish manifest of one package, from the workspace one. */
export function publishManifest(
  manifest: Manifest,
  versions: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const version = versions.get(manifest.name);
  if (!version) throw new Error(`${manifest.name}: no version`);
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([name, range]) => {
      if (!range.startsWith('workspace:')) return [name, range];
      const sibling = versions.get(name);
      if (!sibling) throw new Error(`${manifest.name} depends on ${name}, which is not packed`);
      return [name, sibling];
    }),
  );
  return {
    name: manifest.name,
    version,
    description: manifest.description,
    license: 'MIT',
    repository: {
      type: 'git',
      url: `git+${REPOSITORY}.git`,
      directory: `packages/${manifest.name.replace(/^@blendx\//, '')}`,
    },
    homepage: `${REPOSITORY}#readme`,
    type: 'module',
    files: ['dist', 'README.md', 'LICENSE'],
    ...(manifest.bin
      ? {
          bin: Object.fromEntries(
            Object.entries(manifest.bin).map(([name, source]) => [name, built(source).default]),
          ),
        }
      : {}),
    exports: Object.fromEntries(
      Object.entries(manifest.exports ?? {}).map(([subpath, source]) => [subpath, built(source)]),
    ),
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    ...(manifest.peerDependencies ? { peerDependencies: manifest.peerDependencies } : {}),
    ...(manifest.peerDependenciesMeta
      ? { peerDependenciesMeta: manifest.peerDependenciesMeta }
      : {}),
    publishConfig: { access: 'public' },
  };
}

/** A README for the npm page: what the package is, and where the docs are. */
function readme(manifest: Manifest): string {
  return `# ${manifest.name}\n\n${manifest.description ?? ''}\n\nPart of [blendx](${REPOSITORY}), an AI-first, API-only TypeScript framework: the only code anyone writes is business logic; everything else is derived from \`schema.dbml\`. The guide is in the repository under \`docs/guide/\`.\n`;
}

async function main(destination: string) {
  const folders = ORDER.map((name) => join(root, 'packages', name));
  const manifests = await Promise.all(
    folders.map(
      async (folder) =>
        JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as Manifest,
    ),
  );
  const versions = new Map(manifests.map((manifest) => [manifest.name, manifest.version]));
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    throw new Error(`the packages must share one version, found ${[...distinct].join(', ')} (D35)`);
  }
  await mkdir(destination, { recursive: true });
  const stage = await mkdtemp(join(tmpdir(), 'blendx-pack-'));
  try {
    for (const [index, manifest] of manifests.entries()) {
      const folder = folders[index] ?? '';
      const target = join(stage, manifest.name.replace('/', '__'));
      await mkdir(target, { recursive: true });
      await cp(join(folder, 'dist'), join(target, 'dist'), { recursive: true });
      await cp(join(root, 'LICENSE'), join(target, 'LICENSE'));
      await writeFile(join(target, 'README.md'), readme(manifest));
      await writeFile(
        join(target, 'package.json'),
        `${JSON.stringify(publishManifest(manifest, versions), null, 2)}\n`,
      );
      const pack = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', destination], {
        cwd: target,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (pack.exitCode !== 0) {
        throw new Error(`pack: ${manifest.name} failed:\n${pack.stdout}\n${pack.stderr}`);
      }
      console.log(`packed ${manifest.name}@${manifest.version}`);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [destination] = process.argv.slice(2);
  if (!destination) {
    console.error('usage: bun run pack <folder>');
    process.exit(2);
  }
  await main(resolve(destination));
}
