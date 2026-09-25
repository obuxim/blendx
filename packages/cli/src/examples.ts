/**
 * Runs review/<resource>.examples.yaml for every blend (P10.5): inside `blendx review --check`,
 * and from an app's own tests through `@blendx/cli/examples`. This module does not load the
 * TypeScript compiler, so importing it stays cheap.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { type App, runExamples } from '@blendx/core';
import { parse } from 'yaml';
import { loadConfig, type ResolvedConfig } from './config.ts';
import type { BlendModule } from './emit-routes.ts';
import { loadApp, loadBlends } from './generate.ts';

export interface ExamplesResult {
  passed: number;
  /** One readable line per failed example, starting with its examples file. */
  failures: string[];
}

/** The examples of blends already loaded, for `blendx review --check`. */
export async function runExampleFiles(
  config: ResolvedConfig,
  blends: readonly Pick<BlendModule, 'resource'>[],
  app: App,
): Promise<ExamplesResult> {
  const total: ExamplesResult = { passed: 0, failures: [] };
  for (const { resource } of blends) {
    const path = join(config.review, `${resource.model.name}.examples.yaml`);
    if (!existsSync(path)) continue;
    const label = relative(config.root, path).split(sep).join('/');
    let examples: unknown;
    try {
      examples = parse(await readFile(path, 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      total.failures.push(`${label}: not valid YAML: ${reason}`);
      continue;
    }
    const run = runExamples(resource, app, examples);
    total.passed += run.passed;
    total.failures.push(...run.failures.map((failure) => `${label}: ${failure}`));
  }
  return total;
}

/**
 * Every examples file of the app in `cwd`, for its own tests:
 *   expect((await checkExamples(appRoot)).failures).toEqual([]);
 */
export async function checkExamples(cwd: string): Promise<ExamplesResult> {
  const config = await loadConfig(cwd);
  return runExampleFiles(config, await loadBlends(config), await loadApp(config));
}
