/**
 * `blendx generate` writes the generated folder in two phases. Phase one turns schema.dbml
 * into schema.gen.ts. Phase two imports the blends, which import that schema, and emits
 * routes.gen.ts, register.gen.ts and drizzle.config.gen.ts. A file is only rewritten when
 * its content changes.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Resource } from '@blendx/core';
import { emitDrizzle, loadSchema } from '@blendx/dbml';
import { CliError, type Command } from './command.ts';
import { loadConfig, type ResolvedConfig } from './config.ts';
import { emitDrizzleConfig } from './emit-drizzle-config.ts';
import { emitRegister } from './emit-register.ts';
import { type BlendModule, emitRoutes } from './emit-routes.ts';
import { relativeTo } from './paths.ts';

/** What `generate` writes, in the order it writes them. */
export const GENERATED_FILES = [
  'schema.gen.ts',
  'routes.gen.ts',
  'register.gen.ts',
  'drizzle.config.gen.ts',
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

/** Phase two: the files that need the blends. */
export function emitAppFiles(
  config: ResolvedConfig,
  blends: readonly BlendModule[],
): Record<Exclude<GeneratedFile, 'schema.gen.ts'>, string> {
  return {
    'routes.gen.ts': emitRoutes(blends),
    'register.gen.ts': emitRegister(relativeTo(config.generated, config.app)),
    'drizzle.config.gen.ts': emitDrizzleConfig({
      schema: relativeTo(config.root, join(config.generated, 'schema.gen.ts')),
      out: relativeTo(config.root, config.migrations),
    }),
  };
}

async function writeIfChanged(path: string, content: string): Promise<boolean> {
  if (existsSync(path) && (await readFile(path, 'utf8')) === content) return false;
  await writeFile(path, content);
  return true;
}

export const generate: Command = {
  name: 'generate',
  summary: 'Write the generated files from schema.dbml and the blends',
  async run({ cwd, io }) {
    const config = await loadConfig(cwd);
    const inputs = [
      [config.schema, 'schema'],
      [config.blends, 'blends folder'],
      [config.app, 'app module (it default-exports defineApp)'],
    ] as const;
    for (const [path, what] of inputs) {
      if (!existsSync(path)) {
        const [kind, hint] = what.split(' (');
        throw new CliError(`no ${kind} at ${shown(config, path)}${hint ? ` (${hint}` : ''}`);
      }
    }

    await mkdir(config.generated, { recursive: true });
    const written: string[] = [];
    const write = async (name: GeneratedFile, content: string) => {
      const path = join(config.generated, name);
      if (await writeIfChanged(path, content)) written.push(shown(config, path));
    };

    await write('schema.gen.ts', await emitSchemaFile(config));
    const files = emitAppFiles(config, await loadBlends(config));
    for (const name of GENERATED_FILES) {
      if (name !== 'schema.gen.ts') await write(name, files[name]);
    }

    io.out(
      written.length > 0
        ? written.map((path) => `wrote ${path}\n`).join('')
        : `${shown(config, config.generated)} is up to date\n`,
    );
    return 0;
  },
};
