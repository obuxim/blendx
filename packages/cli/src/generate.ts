/**
 * `blendx generate` writes the generated folder in two phases. Phase one turns schema.dbml
 * into schema.gen.ts. Phase two imports the blends, which import that schema, and the app
 * module, and emits routes.gen.ts, client.gen.ts, register.gen.ts, drizzle.config.gen.ts and
 * openapi.json.
 * A file is only rewritten when its content changes. With --check nothing is written: each
 * drifted file prints a unified diff, and the command exits 1. Replies that openapi.json
 * cannot describe print as warnings, which never fail the command.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type App, buildOpenApi, type Resource, stringifyOpenApi } from '@blendx/core';
import { emitDrizzle, loadSchema } from '@blendx/dbml';
import { CliError, type Command } from './command.ts';
import { loadConfig, type ResolvedConfig } from './config.ts';
import { unifiedDiff } from './diff.ts';
import { emitClient } from './emit-client.ts';
import { emitDrizzleConfig } from './emit-drizzle-config.ts';
import { emitRegister } from './emit-register.ts';
import { type BlendModule, emitRoutes } from './emit-routes.ts';
import { relativeTo } from './paths.ts';

/** What `generate` writes, in the order it writes them. */
export const GENERATED_FILES = [
  'schema.gen.ts',
  'routes.gen.ts',
  'client.gen.ts',
  'register.gen.ts',
  'drizzle.config.gen.ts',
  'openapi.json',
] as const;

export type GeneratedFile = (typeof GENERATED_FILES)[number];

/** A path relative to the app root, for messages. */
const shown = (config: ResolvedConfig, path: string) => relative(config.root, path) || '.';

/** Phase one: schema.dbml to schema.gen.ts. Schema errors carry file:line:column. */
export async function emitSchemaFile(config: ResolvedConfig): Promise<string> {
  const source = await readFile(config.schema, 'utf8');
  return emitDrizzle(await loadSchema(source, shown(config, config.schema)), {
    importFrom: 'blendx/drizzle',
  });
}

const isResource = (value: unknown): value is Resource =>
  typeof value === 'object' && value !== null && (value as Resource).kind === 'blendx/resource';

const isApp = (value: unknown): value is App =>
  typeof value === 'object' && value !== null && (value as App).kind === 'blendx/app';

/** Imports every blends/<table>.ts. Each must default-export blend() of its own table. */
export async function loadBlends(config: ResolvedConfig): Promise<BlendModule[]> {
  const names = (await readdir(config.blends))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts'))
    .sort();
  const blends: BlendModule[] = [];
  for (const name of names) {
    const file = join(config.blends, name);
    const resource: unknown = (await import(pathToFileURL(file).href)).default;
    if (!isResource(resource)) {
      throw new CliError(`${shown(config, file)} must default-export blend(...)`);
    }
    const table = resource.model.name;
    if (name !== `${table}.ts`) {
      const expected = shown(config, join(config.blends, `${table}.ts`));
      throw new CliError(`${shown(config, file)} blends ${table}; name it ${expected}`);
    }
    blends.push({ specifier: relativeTo(config.generated, file), resource });
  }
  return blends;
}

/** Imports the app module, which must default-export defineApp(...). */
export async function loadApp(config: ResolvedConfig): Promise<App> {
  const app: unknown = (await import(pathToFileURL(config.app).href)).default;
  if (!isApp(app)) {
    throw new CliError(`${shown(config, config.app)} must default-export defineApp(...)`);
  }
  return app;
}

/** Phase two: the files that need the blends and the app, and the OpenAPI warnings. */
export function emitAppFiles(
  config: ResolvedConfig,
  blends: readonly BlendModule[],
  app: App,
): { files: Record<Exclude<GeneratedFile, 'schema.gen.ts'>, string>; warnings: string[] } {
  const resources = blends.map((blend) => blend.resource);
  const openapi = buildOpenApi({ app, resources, info: config.openapi });
  return {
    files: {
      // routes.gen.ts first: it refuses two blends of one table and two actions on one route.
      'routes.gen.ts': emitRoutes(blends),
      'client.gen.ts': emitClient(resources),
      'register.gen.ts': emitRegister(relativeTo(config.generated, config.app)),
      'drizzle.config.gen.ts': emitDrizzleConfig({
        schema: relativeTo(config.root, join(config.generated, 'schema.gen.ts')),
        out: relativeTo(config.root, config.migrations),
      }),
      'openapi.json': stringifyOpenApi(openapi.document),
    },
    warnings: openapi.warnings,
  };
}

function checkInputs(config: ResolvedConfig): void {
  const inputs = [
    [config.schema, 'schema', ''],
    [config.blends, 'blends folder', ''],
    [config.app, 'app module', ' (it default-exports defineApp)'],
  ] as const;
  for (const [path, what, hint] of inputs) {
    if (!existsSync(path)) throw new CliError(`no ${what} at ${shown(config, path)}${hint}`);
  }
}

const readIfExists = async (path: string) =>
  existsSync(path) ? await readFile(path, 'utf8') : undefined;

export const generate: Command = {
  name: 'generate',
  summary: 'Write the generated files from schema.dbml and the blends',
  options: {
    check: {
      type: 'boolean',
      description: 'Write nothing; print a diff and exit 1 if a file is out of date',
    },
  },
  async run({ values, cwd, io }) {
    const config = await loadConfig(cwd);
    checkInputs(config);
    const check = values.check === true;
    const stale: string[] = [];

    /** Writes the file if it changed; with --check, reports how it differs instead. */
    const settle = async (name: GeneratedFile, content: string) => {
      const path = join(config.generated, name);
      const current = await readIfExists(path);
      if (current === content) return;
      const label = shown(config, path);
      stale.push(label);
      if (!check) {
        await mkdir(config.generated, { recursive: true });
        await writeFile(path, content);
      } else if (current === undefined) {
        io.out(`${label} is missing\n`);
      } else {
        io.out(unifiedDiff(current, content, { from: label, to: `${label} (generated)` }));
      }
    };

    await settle('schema.gen.ts', await emitSchemaFile(config));
    const schemaFile = join(config.generated, 'schema.gen.ts');
    if (check && !existsSync(schemaFile)) {
      throw new CliError(
        `${shown(config, schemaFile)} is missing, and the blends import it; run \`blendx generate\``,
      );
    }
    const blends = await loadBlends(config);
    const { files, warnings } = emitAppFiles(config, blends, await loadApp(config));
    for (const warning of warnings) io.err(`warning: ${warning}\n`);
    for (const name of GENERATED_FILES) {
      if (name !== 'schema.gen.ts') await settle(name, files[name]);
    }

    if (stale.length === 0) {
      io.out(`${shown(config, config.generated)} is up to date\n`);
      return 0;
    }
    if (check) {
      const what = stale.length === 1 ? `${stale[0]} is` : `${stale.length} generated files are`;
      throw new CliError(`${what} out of date; run \`blendx generate\``);
    }
    io.out(stale.map((path) => `wrote ${path}\n`).join(''));
    return 0;
  },
};
