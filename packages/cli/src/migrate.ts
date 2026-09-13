/**
 * `blendx migrate generate` runs the drizzle-kit this CLI pins, from the app root, with the
 * generated drizzle.config.gen.ts: it writes the next migration into the migrations folder.
 * `blendx migrate up` applies the pending ones through createDatabase, with the configured
 * driver's own migrator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from 'blendx';
import { CliError, type Command, type Io } from './command.ts';
import { loadConfig, type ResolvedConfig } from './config.ts';
import { emitSchemaFile } from './generate.ts';

const USAGE = 'migrate generate [--name <name>] | blendx migrate up';

const shown = (config: ResolvedConfig, path: string) => relative(config.root, path) || '.';

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
  const database = await createDatabase(config);
  try {
    const applied = await database.migrate(config.migrations);
    io.out(
      applied === 0
        ? `${where}: no pending migrations\n`
        : `applied ${applied} migration${applied === 1 ? '' : 's'} from ${where}\n`,
    );
    return 0;
  } finally {
    await database.close();
  }
}

export const migrate: Command = {
  name: 'migrate',
  summary: 'generate: write the next migration; up: apply the pending ones',
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
