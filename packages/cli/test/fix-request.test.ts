/**
 * P10.6: the fix-request workflow (packages/spec/review-format.md). A reviewer edits the
 * review YAML, or adds an example, to ask for a change; `blendx review --check` fails with
 * the diff or the failing example; the blend is changed until the check passes. Runs the
 * real CLI in fresh processes, since the blend changes between runs, on a copy of the
 * addition example.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

const TIMEOUT = 60_000;
const example = join(import.meta.dir, '..', '..', '..', 'examples', 'addition');
const bin = join(import.meta.dir, '..', 'src', 'bin.ts');

let app: string;
beforeAll(async () => {
  // Inside the package, so the copy still resolves blendx from packages/cli/node_modules.
  const scratch = join(import.meta.dir, '..', '.tmp');
  await mkdir(scratch, { recursive: true });
  app = await mkdtemp(join(scratch, 'fix-request-'));
  const skipped = [`${sep}node_modules`, `${sep}.data`];
  await cp(example, app, {
    recursive: true,
    filter: (source) => !skipped.some((part) => source.includes(`${example}${part}`)),
  });
});
afterAll(() => rm(app, { recursive: true, force: true }));

function blendx(...args: string[]) {
  const run = Bun.spawnSync([process.execPath, bin, ...args, '--cwd', app], { timeout: 30_000 });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

const file = (...parts: string[]) => join(app, ...parts);
const edit = async (path: string, from: string, to: string) => {
  const text = await readFile(path, 'utf8');
  expect(text).toContain(from);
  await writeFile(path, text.replace(from, to));
};

describe('the fix-request workflow', () => {
  test(
    'an edit to the review YAML fails the check until the blend does what it says',
    async () => {
      expect(blendx('review', '--check').code).toBe(0);

      // The reviewer asks for destroy to need a signed-in user, by editing the YAML.
      const reviewPath = file('review', 'addition_results.yaml');
      const review = await readFile(reviewPath, 'utf8');
      const destroy = review.indexOf('\n  destroy:\n');
      const requested =
        review.slice(0, destroy) +
        review.slice(destroy).replace('authorize: public', 'authorize: authenticated');
      await writeFile(reviewPath, requested);

      const failing = blendx('review', '--check');
      expect(failing.code).toBe(1);
      expect(failing.out).toContain(
        '\n-      authorize: authenticated\n+      authorize: public\n',
      );
      expect(failing.err).toBe(
        'review/addition_results.yaml is out of date; run `blendx review`\n',
      );

      // The fix is in the blend, never in the YAML; generate refreshes openapi.json.
      await edit(
        file('blends', 'addition_results.ts'),
        'policy: allow.public,',
        'policy: { default: allow.public, destroy: allow.authenticated },',
      );
      expect(blendx('generate').code).toBe(0);
      expect(blendx('review', '--check')).toEqual({
        code: 0,
        out: 'review is up to date\n4 examples passed\n',
        err: '',
      });
      expect(await readFile(reviewPath, 'utf8')).toBe(requested);
    },
    TIMEOUT,
  );

  test(
    'a new example fails the check until calculate produces it; then review rewrites',
    async () => {
      const examplesPath = file('review', 'addition_results.examples.yaml');
      const examples = await readFile(examplesPath, 'utf8');
      await writeFile(
        examplesPath,
        `${examples}  - name: rounds to cents\n    input: { a: 0.1, b: 0.2 }\n    writes: { result: 0.3 }\n`,
      );

      const failing = blendx('review', '--check');
      expect(failing.code).toBe(1);
      expect(failing.out).toBe(
        'review/addition_results.examples.yaml: store #5 (rounds to cents): writes {"result":0.30000000000000004}, expected {"result":0.3}\n',
      );
      expect(failing.err).toBe('1 example failed\n');

      // calculate changes; the examples pass, but the review still shows the old source.
      await edit(
        file('blends', 'addition_results.ts'),
        '({ result: input.a + input.b })',
        '({ result: Math.round((input.a + input.b) * 100) / 100 })',
      );
      const stale = blendx('review', '--check');
      expect(stale.code).toBe(1);
      expect(stale.out).toContain(
        '\n+        ({ input }) => ({ result: Math.round((input.a + input.b) * 100) / 100 })\n',
      );
      expect(stale.err).toBe('review/addition_results.yaml is out of date; run `blendx review`\n');

      expect(blendx('review')).toEqual({
        code: 0,
        out: 'wrote review/addition_results.yaml\n',
        err: '',
      });
      expect(blendx('review', '--check')).toEqual({
        code: 0,
        out: 'review is up to date\n5 examples passed\n',
        err: '',
      });
    },
    TIMEOUT,
  );
});
