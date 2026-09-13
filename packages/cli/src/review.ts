/**
 * `blendx review` writes review/<resource>.yaml for every blend (P10.4): the review model
 * from core, with calculate's source read by one TypeScript 6 program. Files whose blend is
 * gone are removed. With --check nothing is written: drift prints a unified diff and exits
 * 1, like `generate --check`. Human-owned *.examples.yaml files are never touched; --check
 * runs them (P10.5), and a failing example fails the check.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { reviewResource } from '@blendx/core';
import { extractHooks } from './calculates.ts';
import { CliError, type Command } from './command.ts';
import { loadConfig } from './config.ts';
import { unifiedDiff } from './diff.ts';
import { emitReview } from './emit-review.ts';
import { runExampleFiles } from './examples.ts';
import { loadApp, loadBlends } from './generate.ts';

/** Generated review files; `<resource>.examples.yaml` belongs to the humans. */
const isReviewFile = (name: string) => name.endsWith('.yaml') && !name.endsWith('.examples.yaml');

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const review: Command = {
  name: 'review',
  summary: 'Write review/<resource>.yaml: what each action does, for a human to check',
  options: {
    check: {
      type: 'boolean',
      description: 'Write nothing; print a diff and exit 1 if a file is out of date',
    },
  },
  async run({ values, cwd, io }) {
    const config = await loadConfig(cwd);
    const check = values.check === true;
    const shown = (path: string) => relative(config.root, path) || '.';

    if (!existsSync(config.blends))
      throw new CliError(`no blends folder at ${shown(config.blends)}`);
    if (!existsSync(config.app)) {
      throw new CliError(`no app module at ${shown(config.app)} (it default-exports defineApp)`);
    }
    const schemaFile = join(config.generated, 'schema.gen.ts');
    if (!existsSync(schemaFile)) {
      throw new CliError(
        `${shown(schemaFile)} is missing, and the blends import it; run \`blendx generate\``,
      );
    }

    const blends = (await loadBlends(config)).map((blend) => ({
      ...blend,
      file: resolve(config.generated, blend.specifier),
    }));
    const app = await loadApp(config);
    // One TypeScript 6 program reads every calculate, and every index's scope (D22).
    const hooks = extractHooks(
      blends.map((blend) => blend.file),
      ['calculate', 'scope'],
    );
    const wanted = new Map(
      blends.map((blend) => [
        `${blend.resource.model.name}.yaml`,
        emitReview({
          review: reviewResource(blend.resource, app),
          calculates: hooks.get(blend.file)?.get('calculate'),
          scopes: hooks.get(blend.file)?.get('scope'),
          source: shown(blend.file),
        }),
      ]),
    );

    const stale: string[] = [];
    const report: string[] = [];
    for (const [name, content] of [...wanted].sort(([a], [b]) => byCodeUnit(a, b))) {
      const path = join(config.review, name);
      const current = existsSync(path) ? await readFile(path, 'utf8') : undefined;
      if (current === content) continue;
      const label = shown(path);
      stale.push(label);
      if (!check) {
        await mkdir(config.review, { recursive: true });
        await writeFile(path, content);
        report.push(`wrote ${label}`);
      } else if (current === undefined) {
        io.out(`${label} is missing\n`);
      } else {
        io.out(unifiedDiff(current, content, { from: label, to: `${label} (generated)` }));
      }
    }

    const existing = existsSync(config.review) ? await readdir(config.review) : [];
    for (const name of existing.filter(isReviewFile).sort(byCodeUnit)) {
      if (wanted.has(name)) continue;
      const path = join(config.review, name);
      const label = shown(path);
      stale.push(label);
      if (check) {
        io.out(`${label} has no blend any more\n`);
      } else {
        await rm(path);
        report.push(`removed ${label}`);
      }
    }

    // The humans' examples run with --check; a plain run only writes.
    const examples = check ? await runExampleFiles(config, blends, app) : undefined;
    for (const failure of examples?.failures ?? []) io.out(`${failure}\n`);

    const problems: string[] = [];
    if (check && stale.length > 0) {
      const what = stale.length === 1 ? `${stale[0]} is` : `${stale.length} review files are`;
      problems.push(`${what} out of date; run \`blendx review\``);
    }
    const failed = examples?.failures.length ?? 0;
    if (failed > 0) problems.push(`${failed} example${failed === 1 ? '' : 's'} failed`);
    if (problems.length > 0) throw new CliError(problems.join('\n'));

    if (stale.length === 0) {
      io.out(`${shown(config.review)} is up to date\n`);
      const passed = examples?.passed ?? 0;
      if (passed > 0) io.out(`${passed} example${passed === 1 ? '' : 's'} passed\n`);
      return 0;
    }
    io.out(report.map((line) => `${line}\n`).join(''));
    return 0;
  },
};
