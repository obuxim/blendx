import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BlendxConfigError,
  CONFIG_DEFAULTS,
  type Config,
  type ConfigInput,
  defineConfig,
} from '@blendx/core';

export const CONFIG_FILES = ['blendx.config.ts', 'blendx.config.js', 'blendx.config.mjs'] as const;

/** The config with every path made absolute, plus where it was found. */
export type ResolvedConfig = Config & {
  /** The folder holding the config file; relative paths resolve against it. */
  readonly root: string;
  readonly file: string;
};

/** Finds, imports and validates the app's blendx config in `cwd`. */
export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const file = CONFIG_FILES.map((name) => join(cwd, name)).find((path) => existsSync(path));
  if (!file) {
    throw new BlendxConfigError(
      `no blendx config in ${cwd} (looked for ${CONFIG_FILES.join(', ')})`,
    );
  }

  const loaded: unknown = (await import(pathToFileURL(file).href)).default;
  if (typeof loaded !== 'object' || loaded === null) {
    throw new BlendxConfigError(`${file} must default-export defineConfig({ ... })`);
  }
  const config = defineConfig(loaded as ConfigInput);

  const root = dirname(file);
  const absolute = (path: string) => (isAbsolute(path) ? path : resolve(root, path));
  const paths = Object.fromEntries(
    Object.keys(CONFIG_DEFAULTS).map((key) => [
      key,
      absolute(config[key as keyof typeof CONFIG_DEFAULTS]),
    ]),
  ) as Record<keyof typeof CONFIG_DEFAULTS, string>;

  return Object.freeze({ ...config, ...paths, root, file });
}
