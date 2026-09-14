/**
 * The packing test (docs/decisions.md D35): builds and packs the six packages, makes a fresh
 * app from the addition example that installs blendx, @blendx/cli and @blendx/react from the
 * tarballs, and runs it as a user would: generate, review --check, tsc, its tests on Bun, and
 * the API on Node through the built JavaScript. `bun run pack:test`; CI runs it beside check.
 */
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const example = join(root, 'examples', 'addition');

function run(label: string, command: string[], cwd: string) {
  console.log(`\npack test: ${label}`);
  const result = Bun.spawnSync(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) {
    console.error(`pack test: ${label} failed`);
    process.exit(result.exitCode ?? 1);
  }
}

const manifest = async (path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as {
    version: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

const work = await mkdtemp(join(tmpdir(), 'blendx-pack-test-'));
try {
  const tarballs = join(work, 'tarballs');
  run('build', ['bun', 'run', 'build'], root);
  run('pack', ['bun', 'run', 'pack', tarballs], root);

  const packed = await readdir(tarballs);
  /** The tarball of a package: blendx-0.1.0.tgz, blendx-core-0.1.0.tgz. */
  const tarball = (name: string) => {
    const stem = name.replace(/^@blendx\//, 'blendx-');
    const file = packed.find((candidate) => new RegExp(`^${stem}-\\d`).test(candidate));
    if (!file) throw new Error(`no tarball for ${name} among ${packed.join(', ')}`);
    return `file:${join(tarballs, file)}`;
  };

  const app = join(work, 'app');
  for (const entry of ['schema.dbml', 'blendx.config.ts', 'server.ts', 'src/app.ts']) {
    await cp(join(example, entry), join(app, entry));
  }
  for (const folder of ['blends', 'drizzle', 'review', 'test']) {
    await cp(join(example, folder), join(app, folder), { recursive: true });
  }

  // The versions the repository pins, so the app installs what blendx was built against.
  const [exampleManifest, rootManifest, reactManifest] = await Promise.all([
    manifest(join(example, 'package.json')),
    manifest(join(root, 'package.json')),
    manifest(join(root, 'packages', 'react', 'package.json')),
  ]);
  const pin = (from: Record<string, string> | undefined, name: string) => {
    const version = from?.[name];
    if (!version) throw new Error(`no pinned version for ${name}`);
    return version;
  };
  await writeFile(
    join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: 'blendx-pack-test',
        private: true,
        type: 'module',
        dependencies: {
          '@blendx/react': tarball('@blendx/react'),
          '@electric-sql/pglite': pin(exampleManifest.dependencies, '@electric-sql/pglite'),
          '@tanstack/react-query': pin(reactManifest.devDependencies, '@tanstack/react-query'),
          blendx: tarball('blendx'),
          pg: pin(exampleManifest.dependencies, 'pg'),
          react: pin(reactManifest.devDependencies, 'react'),
        },
        devDependencies: {
          '@blendx/cli': tarball('@blendx/cli'),
          '@types/bun': pin(rootManifest.devDependencies, '@types/bun'),
          typescript: pin(rootManifest.devDependencies, 'typescript'),
        },
        // The packages depend on each other by version; none is on the registry here.
        overrides: {
          '@blendx/core': tarball('@blendx/core'),
          '@blendx/dbml': tarball('@blendx/dbml'),
          '@blendx/hono': tarball('@blendx/hono'),
          blendx: tarball('blendx'),
        },
      },
      null,
      2,
    )}\n`,
  );
  const base = JSON.parse(await readFile(join(root, 'tsconfig.base.json'), 'utf8')) as {
    compilerOptions: Record<string, unknown>;
  };
  await writeFile(
    join(app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: { ...base.compilerOptions, types: ['bun'] },
        include: ['.'],
        exclude: ['node_modules'],
      },
      null,
      2,
    )}\n`,
  );
  // The API on Node, through the built JavaScript: a request in, the saved row out.
  await writeFile(
    join(app, 'node-check.ts'),
    [
      "import { fileURLToPath } from 'node:url';",
      "import { createBlendxClient } from '@blendx/react';",
      "import { createDatabase, createServer } from 'blendx';",
      "import { hc } from 'blendx/client';",
      "import app from './src/app.ts';",
      "import { tables } from './src/generated/client.gen.ts';",
      "import { routes } from './src/generated/routes.gen.ts';",
      '',
      "const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });",
      "await database.migrate(fileURLToPath(new URL('./drizzle', import.meta.url)));",
      'const server = createServer({ app, db: database.db, routes });',
      "const created = await server.request('/addition_results', {",
      "  method: 'POST',",
      "  headers: { 'content-type': 'application/json' },",
      '  body: JSON.stringify({ a: 4, b: 3 }),',
      '});',
      'const row = await created.json();',
      'if (created.status !== 201 || row.result !== 7) {',
      "  throw new Error('node: expected 201 with result 7, got ' + created.status + ' ' + JSON.stringify(row));",
      '}',
      'const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>',
      '  server.request(input, init)) as typeof globalThis.fetch;',
      "const api = createBlendxClient(hc('http://blendx.test', { fetch }), tables);",
      "if (typeof api.addition_results.index.queryOptions !== 'function') throw new Error('node: no client');",
      'await database.close();',
      "console.log('node ' + process.version + ': created ' + JSON.stringify(row));",
      '',
    ].join('\n'),
  );

  run('bun install', ['bun', 'install'], app);
  run('blendx generate', ['bunx', 'blendx', 'generate'], app);
  run('blendx review --check', ['bunx', 'blendx', 'review', '--check'], app);
  run('tsc --noEmit', ['bunx', 'tsc', '--noEmit'], app);
  run('bun test', ['bun', 'test'], app);
  run('node', ['node', 'node-check.ts'], app);
  console.log('\npack test: ok');
} finally {
  await rm(work, { recursive: true, force: true });
}
