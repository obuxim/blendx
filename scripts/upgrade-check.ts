/**
 * The upgrade check of the release gate (docs/releasing.md): the addition example exactly as
 * the previous release committed it, generated files and review included, with its blendx
 * dependencies moved to the six freshly packed tarballs, then what a user does after bumping:
 * `blendx generate`, `blendx review`, `tsc --noEmit` and its tests. It prints which generated
 * and review files the upgrade rewrote, which is what the changelog's upgrade section says.
 * `bun run upgrade:check [v<previous>]`; CI runs it beside the packing test. The previous
 * release defaults to the highest `v*` tag below the version in packages/blendx/package.json.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { changedFiles, type Manifest, previousTag, upgradeManifest } from './upgrade.ts';

const root = join(import.meta.dir, '..');
const EXAMPLE = 'examples/addition';

/** A path tar and git accept on every platform. */
const posix = (path: string) => path.replaceAll('\\', '/');

function run(label: string, command: string[], cwd: string, input?: Uint8Array) {
  console.log(`\nupgrade check: ${label}`);
  const result = Bun.spawnSync(command, {
    cwd,
    stdin: input,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    console.error(`upgrade check: ${label} failed`);
    process.exit(result.exitCode ?? 1);
  }
}

function capture(command: string[], cwd: string): Uint8Array {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed`);
  return result.stdout;
}

const manifest = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Manifest;

/** Every file under `folder`, by path relative to `app`, with its content. */
async function snapshot(app: string, folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(join(app, folder), { recursive: true, withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(posix(relative(app, path)), await readFile(path, 'utf8'));
  }
  return files;
}

const current = (await manifest(join(root, 'packages', 'blendx', 'package.json'))).version;
if (!current) throw new Error('packages/blendx/package.json has no version');
const tags = new TextDecoder()
  .decode(capture(['git', 'tag', '--list', 'v*'], root))
  .split(/\r?\n/)
  .filter(Boolean);
const previous = process.argv[2] ?? previousTag(tags, current);
if (!previous) {
  console.error(
    `upgrade check: no release tag below ${current} among ${tags.join(', ') || 'no tags'}`,
  );
  process.exit(1);
}
console.log(`upgrade check: ${EXAMPLE} at ${previous}, upgraded to ${current} from the tarballs`);

const work = await mkdtemp(join(tmpdir(), 'blendx-upgrade-check-'));
try {
  const tarballs = join(work, 'tarballs');
  run('build', ['bun', 'run', 'build'], root);
  run('pack', ['bun', 'run', 'pack', tarballs], root);
  const packed = await readdir(tarballs);
  const tarball = (name: string) => {
    const stem = name.replace(/^@blendx\//, 'blendx-');
    const file = packed.find((candidate) => new RegExp(`^${stem}-\\d`).test(candidate));
    if (!file) throw new Error(`no tarball for ${name} among ${packed.join(', ')}`);
    return `file:${join(tarballs, file)}`;
  };

  // The example as the previous release committed it: git archive, extracted with tar, which
  // Windows ships too. The archive's line endings follow the checkout's attributes; the
  // comparison below ignores them.
  const archive = capture(['git', 'archive', '--format=tar', previous, EXAMPLE], root);
  run('extract', ['tar', '-x', '-f', '-', '-C', posix(work)], work, archive);
  const app = join(work, EXAMPLE);

  const rootManifest = await manifest(join(root, 'package.json'));
  const pin = (name: string) => {
    const version = rootManifest.devDependencies?.[name];
    if (!version) throw new Error(`no pinned version for ${name} in package.json`);
    return version;
  };
  const upgraded = upgradeManifest(await manifest(join(app, 'package.json')), tarball, {
    '@types/bun': pin('@types/bun'),
    typescript: pin('typescript'),
  });
  await writeFile(join(app, 'package.json'), `${JSON.stringify(upgraded, null, 2)}\n`);
  // The example's tsconfig extends the repository's, which the archive does not hold.
  const base = JSON.parse(await readFile(join(root, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: Record<string, unknown>;
  };
  await writeFile(
    join(app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: { ...base.compilerOptions, types: ['bun'] },
        include: ['.'],
        exclude: ['node_modules', 'web'],
      },
      null,
      2,
    )}\n`,
  );

  run('bun install', ['bun', 'install'], app);
  const generatedBefore = await snapshot(app, 'src/generated');
  const reviewBefore = await snapshot(app, 'review');
  run('blendx generate', ['bunx', 'blendx', 'generate'], app);
  run('blendx review', ['bunx', 'blendx', 'review'], app);
  const changes = [
    ...changedFiles(generatedBefore, await snapshot(app, 'src/generated')),
    ...changedFiles(reviewBefore, await snapshot(app, 'review')),
  ];
  console.log(`\nupgrade check: what ${previous} -> ${current} rewrote`);
  if (changes.length === 0)
    console.log('  nothing: the generated files and the review are as they were');
  for (const change of changes) console.log(`  ${change.status}: ${change.path}`);
  run('tsc --noEmit', ['bunx', 'tsc', '--noEmit'], app);
  run('bun test', ['bun', 'test'], app);
  console.log(`\nupgrade check: ok (${previous} -> ${current})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
