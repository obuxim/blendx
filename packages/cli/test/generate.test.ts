/**
 * P7.4: `blendx generate` on the shop-app fixture, starting from an empty generated folder.
 * The fixture's committed src/generated/ holds the goldens. The fixture is its own tsconfig
 * project, so tsc checks the goldens (register.gen.ts included) without the augmentation
 * leaking into other tests.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GENERATED_FILES } from '../src/generate.ts';
import { main } from '../src/main.ts';
import { expectGolden } from './support/golden.ts';

const fixture = join(import.meta.dir, 'fixtures', 'shop-app');
const goldens = join(fixture, 'src', 'generated');

let app: string;
beforeAll(async () => {
  // Inside the package, so the copy still resolves blendx from packages/cli/node_modules.
  const scratch = join(import.meta.dir, '..', '.tmp');
  await mkdir(scratch, { recursive: true });
  app = await mkdtemp(join(scratch, 'shop-app-'));
  await cp(fixture, app, { recursive: true, filter: (source) => !source.startsWith(goldens) });
});
afterAll(() => rm(app, { recursive: true, force: true }));

async function generate(...args: string[]) {
  let out = '';
  let err = '';
  const io = {
    out: (text: string) => {
      out += text;
    },
    err: (text: string) => {
      err += text;
    },
    cwd: app,
  };
  const code = await main(['generate', ...args], { io });
  return { code, out, err };
}

/** Runs `generate` with `path` changed, then puts it back. */
async function withChanged(path: string, change: () => Promise<void>, check: () => Promise<void>) {
  const original = await readFile(path, 'utf8').catch(() => undefined);
  try {
    await change();
    await check();
  } finally {
    if (original === undefined) await rm(path, { force: true });
    else await writeFile(path, original);
  }
}

describe('blendx generate', () => {
  test('from an empty generated folder: every file, equal to the goldens', async () => {
    const { code, out, err } = await generate();
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toBe(GENERATED_FILES.map((name) => `wrote src/generated/${name}\n`).join(''));
    for (const name of GENERATED_FILES) {
      const actual = await readFile(join(app, 'src', 'generated', name), 'utf8');
      await expectGolden(join(goldens, name), actual);
    }
  });

  test('a second run changes nothing', async () => {
    expect(await generate()).toEqual({ code: 0, out: 'src/generated is up to date\n', err: '' });
  });

  test('the bin runs it and exits', () => {
    const bin = join(import.meta.dir, '..', 'src', 'bin.ts');
    const run = Bun.spawnSync([process.execPath, bin, 'generate', '--cwd', app], {
      timeout: 30_000,
    });
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toBe('src/generated is up to date\n');
  });

  test('schema errors point at schema.dbml with line and column', async () => {
    const schema = join(app, 'schema.dbml');
    const original = await readFile(schema, 'utf8');
    await withChanged(
      schema,
      () => writeFile(schema, `${original}\nTable broken {\n  name text\n}\n`),
      async () => {
        const { code, err } = await generate();
        expect(code).toBe(1);
        expect(err).toMatch(/^schema\.dbml:\d+:\d+ /);
      },
    );
  });

  test('a blend file must default-export blend()', async () => {
    const stray = join(app, 'blends', 'stray.ts');
    await withChanged(
      stray,
      () => writeFile(stray, 'export default { hello: 1 };\n'),
      async () => {
        expect(await generate()).toEqual({
          code: 1,
          out: '',
          err: 'blends/stray.ts must default-export blend(...)\n',
        });
      },
    );
  });

  test('a blend file is named after its table', async () => {
    const alias = join(app, 'blends', 'customers.ts');
    await withChanged(
      alias,
      () => writeFile(alias, "export { default } from './users.ts';\n"),
      async () => {
        expect(await generate()).toEqual({
          code: 1,
          out: '',
          err: 'blends/customers.ts blends users; name it blends/users.ts\n',
        });
      },
    );
  });

  test('the app module must exist', async () => {
    const appFile = join(app, 'src', 'app.ts');
    await rename(appFile, `${appFile}.bak`);
    try {
      expect(await generate()).toEqual({
        code: 1,
        out: '',
        err: 'no app module at src/app.ts (it default-exports defineApp)\n',
      });
    } finally {
      await rename(`${appFile}.bak`, appFile);
    }
  });
});

describe('blendx generate --check (P7.5)', () => {
  const generated = (name: string) => join(app, 'src', 'generated', name);

  test('up to date: exits 0', async () => {
    expect(await generate('--check')).toEqual({
      code: 0,
      out: 'src/generated is up to date\n',
      err: '',
    });
  });

  test('drift: a unified diff on stdout, exit 1, and nothing written', async () => {
    const path = generated('routes.gen.ts');
    const original = await readFile(path, 'utf8');
    const edited = original.replace('.get("/orders/quote"', '.post("/orders/quote"');
    expect(edited).not.toBe(original);
    await withChanged(
      path,
      () => writeFile(path, edited),
      async () => {
        const { code, out, err } = await generate('--check');
        expect(code).toBe(1);
        expect(out).toStartWith(
          '--- src/generated/routes.gen.ts\n+++ src/generated/routes.gen.ts (generated)\n@@ ',
        );
        expect(out).toContain(
          '\n-  .post("/orders/quote", ...run(orders, "quote"))\n+  .get("/orders/quote", ...run(orders, "quote"))\n',
        );
        expect(err).toBe('src/generated/routes.gen.ts is out of date; run `blendx generate`\n');
        expect(await readFile(path, 'utf8')).toBe(edited);
      },
    );
  });

  test('a missing file is reported and not written', async () => {
    const path = generated('register.gen.ts');
    await withChanged(
      path,
      () => rm(path),
      async () => {
        expect(await generate('--check')).toEqual({
          code: 1,
          out: 'src/generated/register.gen.ts is missing\n',
          err: 'src/generated/register.gen.ts is out of date; run `blendx generate`\n',
        });
        expect(await Bun.file(path).exists()).toBe(false);
      },
    );
  });

  test('without schema.gen.ts the blends cannot load, so it stops there', async () => {
    const path = generated('schema.gen.ts');
    await withChanged(
      path,
      () => rm(path),
      async () => {
        expect(await generate('--check')).toEqual({
          code: 1,
          out: 'src/generated/schema.gen.ts is missing\n',
          err: 'src/generated/schema.gen.ts is missing, and the blends import it; run `blendx generate`\n',
        });
      },
    );
  });

  test('a blend change shows up as drift in routes.gen.ts', async () => {
    // A fresh process: this one has already imported (and cached) the blends.
    const bin = join(import.meta.dir, '..', 'src', 'bin.ts');
    const path = join(app, 'blends', 'order_notes.ts');
    const original = await readFile(path, 'utf8');
    const edited = original.replace('[a.index(), a.store()]', '[a.index()]');
    expect(edited).not.toBe(original);
    await withChanged(
      path,
      () => writeFile(path, edited),
      async () => {
        const run = Bun.spawnSync([process.execPath, bin, 'generate', '--check', '--cwd', app], {
          timeout: 30_000,
        });
        expect(run.stderr.toString()).toBe(
          'src/generated/routes.gen.ts is out of date; run `blendx generate`\n',
        );
        expect(run.exitCode).toBe(1);
        expect(run.stdout.toString()).toContain(
          '\n-  .post("/order_notes", ...run(order_notes, "store"))\n',
        );
      },
    );
  });
});
