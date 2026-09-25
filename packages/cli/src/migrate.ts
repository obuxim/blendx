/**
 * `blendx migrate generate` runs the drizzle-kit this CLI pins, from the app root, with the
 * generated drizzle.config.gen.ts: it writes the next migration into the migrations folder.
 * `blendx migrate up` applies the pending ones through createDatabase, with the configured
 * driver's own migrator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabase, type DataMigration, DataMigrationError } from 'blendx';
import { CliError, type Command, type Io } from './command.ts';
import { loadConfig, type ResolvedConfig } from './config.ts';
import { emitOutboxFile, emitSchemaFile } from './generate.ts';

const USAGE = 'migrate generate [--name <name>] | blendx migrate up';

const shown = (config: ResolvedConfig, path: string) =>
  relative(config.root, path).split(sep).join('/') || '.';

const isDataMigration = (value: unknown): value is DataMigration =>
  typeof value === 'object' &&
  value !== null &&
  (value as DataMigration).kind === 'blendx/data-migration' &&
  typeof (value as DataMigration).id === 'string' &&
  typeof (value as DataMigration).up === 'function';

/** Imports top-level, versioned data migrations from the configured directory (D38). */
export async function loadDataMigrations(
  config: ResolvedConfig,
): Promise<readonly DataMigration[]> {
  if (!existsSync(config.dataMigrations)) return [];
  const names = (await readdir(config.dataMigrations, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts') &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => entry.name)
    .sort();
  const migrations: DataMigration[] = [];
  for (const name of names) {
    const file = join(config.dataMigrations, name);
    let value: unknown;
    try {
      value = (await import(pathToFileURL(file).href)).default;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CliError(`${shown(config, file)} could not load: ${reason}`);
    }
    if (!isDataMigration(value)) {
      throw new CliError(`${shown(config, file)} must default-export dataMigration(...)`);
    }
    const stem = name.slice(0, -'.ts'.length);
    if (value.id !== stem) {
      throw new CliError(
        `${shown(config, file)} declares ${value.id}; name it ${shown(config, join(config.dataMigrations, `${value.id}.ts`))}`,
      );
    }
    migrations.push(value);
  }
  return migrations;
}

/** drizzle-kit's CLI entry, from the version this package depends on. */
const drizzleKitBin = () =>
  join(dirname(fileURLToPath(import.meta.resolve('drizzle-kit'))), 'bin.cjs');

async function generateMigration(config: ResolvedConfig, name: string | undefined, io: Io) {
  const drizzleConfig = join(config.generated, 'drizzle.config.gen.ts');
  const schemaFile = join(config.generated, 'schema.gen.ts');
  if (!existsSync(drizzleConfig) || !existsSync(schemaFile)) {
    throw new CliError(
      `${shown(config, config.generated)} has no drizzle config; run \`blendx generate\` first`,
    );
  }
  if ((await readFile(schemaFile, 'utf8')) !== (await emitSchemaFile(config))) {
    throw new CliError(
      `${shown(config, schemaFile)} is out of date; run \`blendx generate\` first`,
    );
  }
  // A new later hook needs its table in this migration (D27), so outbox.gen.ts must be current.
  const outboxFile = join(config.generated, 'outbox.gen.ts');
  const outbox = existsSync(outboxFile) ? await readFile(outboxFile, 'utf8') : undefined;
  if (outbox !== (await emitOutboxFile(config))) {
    throw new CliError(
      `${shown(config, outboxFile)} is out of date; run \`blendx generate\` first`,
    );
  }

  const args = [drizzleKitBin(), 'generate', `--config=${drizzleConfig}`];
  if (name) args.push(`--name=${name}`);
  const run = spawnSync(process.execPath, args, {
    cwd: config.root,
    encoding: 'utf8',
    stdio: io.interactive ? 'inherit' : 'pipe',
  });
  if (run.error) throw run.error;
  if (run.stdout) io.out(run.stdout);
  if (run.stderr) io.err(run.stderr);
  if (run.status !== 0) throw new CliError(`drizzle-kit generate failed (exit ${run.status})`);
  return 0;
}

/** drizzle-kit 1.0 writes one folder per migration, each holding its migration.sql. */
const hasMigrations = (folder: string) =>
  existsSync(folder) &&
  readdirSync(folder, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && existsSync(join(folder, entry.name, 'migration.sql')),
  );

async function applyMigrations(config: ResolvedConfig, io: Io) {
  const where = shown(config, config.migrations);
  if (existsSync(join(config.migrations, 'meta', '_journal.json'))) {
    throw new CliError(
      `${where} is in the drizzle-kit 0.x layout (meta/_journal.json), which drizzle-kit 1.0 does not read; convert it once with drizzle-kit 1.0's \`up\` command`,
    );
  }
  if (!hasMigrations(config.migrations)) {
    throw new CliError(`no migrations in ${where}; run \`blendx migrate generate\``);
  }
  const dataMigrations = await loadDataMigrations(config);
  const database = await createDatabase(config);
  try {
    let applied: Awaited<ReturnType<typeof database.migrate>>;
    try {
      applied = await database.migrate(config.migrations, dataMigrations);
    } catch (error) {
      if (error instanceof DataMigrationError) {
        const reason = error.cause instanceof Error ? error.cause.message : String(error.cause);
        throw new CliError(`data migration ${error.id} failed: ${reason}`);
      }
      throw error;
    }
    io.out(
      applied.schema === 0
        ? `${where}: no pending migrations\n`
        : `applied ${applied.schema} migration${applied.schema === 1 ? '' : 's'} from ${where}\n`,
    );
    if (applied.data.length === 0) {
      io.out(`${shown(config, config.dataMigrations)}: no pending data migrations\n`);
    } else {
      for (const id of applied.data) io.out(`applied data migration ${id}\n`);
    }
    return 0;
  } finally {
    await database.close();
  }
}

export const migrate: Command = {
  name: 'migrate',
  summary: 'generate: write the next schema migration; up: apply pending schema and data steps',
  usage: USAGE,
  options: {
    name: { type: 'string', placeholder: 'name', description: 'The new migration name (generate)' },
  },
  async run({ values, positionals, cwd, io }) {
    const [action, ...extra] = positionals;
    if ((action !== 'generate' && action !== 'up') || extra.length > 0) {
      throw new CliError(`usage: blendx ${USAGE}`, 2);
    }
    const config = await loadConfig(cwd);
    return action === 'generate'
      ? generateMigration(config, typeof values.name === 'string' ? values.name : undefined, io)
      : applyMigrations(config, io);
  },
};
