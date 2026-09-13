/**
 * P10.4: `blendx review` writes review/<resource>.yaml for each blend, and `--check` reports
 * drift with a diff and exit 1. Files without a blend are removed; human-owned
 * *.examples.yaml files are never touched. Runs on a copy of the shop-app fixture, and each
 * run builds a TypeScript program, so the tests are few and patient.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../src/main.ts';

const TIMEOUT = 60_000;

let app: string;
beforeAll(async () => {
  // Inside the package, so the copy still resolves blendx from packages/cli/node_modules.
  const scratch = join(import.meta.dir, '..', '.tmp');
  await mkdir(scratch, { recursive: true });
  app = await mkdtemp(join(scratch, 'review-'));
  await cp(join(import.meta.dir, 'fixtures', 'shop-app'), app, { recursive: true });
});
afterAll(() => rm(app, { recursive: true, force: true }));

async function cli(...argv: string[]) {
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
  const code = await main(argv, { io });
  return { code, out, err };
}

const reviewFile = (name: string) => join(app, 'review', name);

describe('blendx review', () => {
  test(
    'writes one file per blend',
    async () => {
      expect(await cli('review')).toEqual({
        code: 0,
        out: 'wrote review/order_notes.yaml\nwrote review/orders.yaml\nwrote review/users.yaml\n',
        err: '',
      });
      const orders = await readFile(reviewFile('orders.yaml'), 'utf8');
      expect(orders).toContain('\nsource: blends/orders.ts\n');
      expect(orders).toContain('\n  quote:\n');
    },
    TIMEOUT,
  );

  test(
    '--check: up to date exits 0',
    async () => {
      expect(await cli('review', '--check')).toEqual({
        code: 0,
        out: 'review is up to date\n',
        err: '',
      });
    },
    TIMEOUT,
  );

  test(
    '--check: an edited file and a file without a blend drift; nothing is written',
    async () => {
      const orders = reviewFile('orders.yaml');
      const original = await readFile(orders, 'utf8');
      const edited = original.replace('authorize: public', 'authorize: admins only');
      expect(edited).not.toBe(original);
      await writeFile(orders, edited);
      await writeFile(reviewFile('refunds.yaml'), 'format: 1\n');
      await writeFile(reviewFile('orders.examples.yaml'), 'store: []\n');

      const { code, out, err } = await cli('review', '--check');
      expect(code).toBe(1);
      expect(out).toContain('--- review/orders.yaml\n+++ review/orders.yaml (generated)\n');
      expect(out).toContain('\n-      authorize: admins only\n+      authorize: public\n');
      expect(out).toContain('review/refunds.yaml has no blend any more\n');
      expect(out).not.toContain('examples');
      expect(err).toBe('2 review files are out of date; run `blendx review`\n');
      expect(await readFile(orders, 'utf8')).toBe(edited);
    },
    TIMEOUT,
  );

  test(
    'a run rewrites drift, removes files without a blend, and keeps the examples',
    async () => {
      expect(await cli('review')).toEqual({
        code: 0,
        out: 'wrote review/orders.yaml\nremoved review/refunds.yaml\n',
        err: '',
      });
      expect((await readdir(join(app, 'review'))).sort()).toEqual([
        'order_notes.yaml',
        'orders.examples.yaml',
        'orders.yaml',
        'users.yaml',
      ]);
      expect(await readFile(reviewFile('orders.examples.yaml'), 'utf8')).toBe('store: []\n');
    },
    TIMEOUT,
  );
});
