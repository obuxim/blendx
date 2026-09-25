/**
 * createDatabase(config): opens the app's database with the configured driver (D7). Each
 * driver package is an optional peer, imported only when chosen, so an app installs just
 * its own. It lives in the facade because drivers are runtime-specific; core stays portable.
 */
import {
  BlendxConfigError,
  type Config,
  type DatabaseDriver,
  type DataMigration,
  type Db,
} from '@blendx/core';
import { sql } from 'drizzle-orm';

export interface MigrationResult {
  /** Drizzle schema migrations applied during this call. */
  readonly schema: number;
  /** Data-migration IDs applied during this call, in version order. */
  readonly data: readonly string[];
}

/** A data migration failed and its transaction was rolled back. */
export class DataMigrationError extends Error {
  constructor(
    readonly id: string,
    options: ErrorOptions,
  ) {
    super(`data migration ${id} failed`, options);
    this.name = 'DataMigrationError';
  }
}

export interface Database {
  readonly driver: DatabaseDriver;
  readonly db: Db;
  /**
   * Applies pending Drizzle schema migrations in `folder`, then pending data migrations. Each
   * data migration runs transactionally and is recorded in Blendx's completion ledger.
   */
  migrate(folder: string, dataMigrations?: readonly DataMigration[]): Promise<MigrationResult>;
  /** Ends the connection pool, or closes the PGlite instance. */
  close(): Promise<void>;
}

/** Only `database` is read, so a full config or just that part both work. */
export type DatabaseConfig = Pick<Config, 'database'>;

/** Loose types for the optional driver packages; each is only imported when chosen. */
interface PostgresJs {
  default: (url: string) => { end(): Promise<void> };
}

const missing = (error: unknown, specifier: string) => {
  const message = String(error instanceof Error ? error.message : error);
  return /Cannot find (package|module)/.test(message) && message.includes(`'${specifier}'`);
};

async function load<T>(driver: DatabaseDriver, specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    if (!missing(error, specifier)) throw error;
    throw new BlendxConfigError(
      driver === 'bun-sql'
        ? 'the bun-sql driver needs the Bun runtime'
        : `the ${driver} driver needs the "${specifier}" package; add it to your dependencies`,
    );
  }
}

/** Rows recorded by drizzle's migrator; 0 before the first migration creates its table. */
async function appliedCount(db: Db): Promise<number> {
  try {
    const result: unknown = await db.execute(
      sql.raw('select count(*)::int as n from drizzle.__drizzle_migrations'),
    );
    const rows = Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
    return Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0);
  } catch {
    return 0;
  }
}

const DATA_MIGRATION_LOCK = 20_260_925;
const DATA_MIGRATION_LEDGER = 'blendx.__blendx_data_migrations';

function rows(result: unknown): unknown[] {
  return Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
}

function orderedDataMigrations(dataMigrations: readonly DataMigration[]): readonly DataMigration[] {
  const ordered = [...dataMigrations].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (current && ordered[index - 1]?.id === current.id) {
      throw new Error(`duplicate data migration id "${current.id}"`);
    }
  }
  return ordered;
}

async function applyDataMigration(db: Db, migration: DataMigration): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`select pg_advisory_xact_lock(${DATA_MIGRATION_LOCK})`));
      await tx.execute(sql.raw('create schema if not exists blendx'));
      await tx.execute(
        sql.raw(
          `create table if not exists ${DATA_MIGRATION_LEDGER} (
            id text primary key,
            applied_at timestamp with time zone not null default current_timestamp
          )`,
        ),
      );
      const completed: unknown = await tx.execute(
        sql`select id from blendx.__blendx_data_migrations where id = ${migration.id}`,
      );
      if (rows(completed).length > 0) return false;

      await migration.up({ tx: tx as unknown as Db });
      await tx.execute(
        sql`insert into blendx.__blendx_data_migrations (id) values (${migration.id})`,
      );
      return true;
    });
  } catch (cause) {
    throw new DataMigrationError(migration.id, { cause });
  }
}

function opened(
  driver: DatabaseDriver,
  db: unknown,
  runMigrations: (folder: string) => Promise<void>,
  close: () => Promise<unknown>,
): Database {
  return {
    driver,
    db: db as Db,
    async migrate(folder, dataMigrations = []) {
      const ordered = orderedDataMigrations(dataMigrations);
      const before = await appliedCount(db as Db);
      await runMigrations(folder);
      const schema = (await appliedCount(db as Db)) - before;
      const data: string[] = [];
      for (const migration of ordered) {
        if (await applyDataMigration(db as Db, migration)) data.push(migration.id);
      }
      return { schema, data };
    },
    async close() {
      await close();
    },
  };
}

/**
 * Opens the database. Server drivers read `database.url`, then DATABASE_URL. PGlite reads
 * only `database.url`: none or 'memory://' is in memory, anything else is a data folder.
 */
export async function createDatabase(config: DatabaseConfig): Promise<Database> {
  const { driver } = config.database;
  if (driver === 'pglite') {
    const { PGlite } = await load<typeof import('@electric-sql/pglite')>(
      driver,
      '@electric-sql/pglite',
    );
    const { drizzle } = await import('drizzle-orm/pglite');
    const location = config.database.url;
    const client = location && location !== 'memory://' ? new PGlite(location) : new PGlite();
    const db = drizzle({ client });
    const migrate = async (folder: string) => {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(db, { migrationsFolder: folder });
    };
    return opened(driver, db, migrate, () => client.close());
  }

  const url = config.database.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new BlendxConfigError(`the ${driver} driver needs config.database.url or DATABASE_URL`);
  }

  switch (driver) {
    case 'pg': {
      const { Pool } = await load<typeof import('pg')>(driver, 'pg');
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const pool = new Pool({ connectionString: url });
      const db = drizzle({ client: pool });
      const migrate = async (folder: string) => {
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        await migrate(db, { migrationsFolder: folder });
      };
      return opened(driver, db, migrate, () => pool.end());
    }
    case 'postgres-js': {
      const postgres = (await load<PostgresJs>(driver, 'postgres')).default;
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const client = postgres(url);
      const db = drizzle({ client: client as never });
      const migrate = async (folder: string) => {
        const { migrate } = await import('drizzle-orm/postgres-js/migrator');
        await migrate(db, { migrationsFolder: folder });
      };
      return opened(driver, db, migrate, () => client.end());
    }
    case 'bun-sql': {
      const { SQL } = await load<typeof import('bun')>(driver, 'bun');
      const { drizzle } = await import('drizzle-orm/bun-sql');
      const client = new SQL(url);
      const db = drizzle({ client });
      const migrate = async (folder: string) => {
        const { migrate } = await import('drizzle-orm/bun-sql/migrator');
        await migrate(db, { migrationsFolder: folder });
      };
      return opened(driver, db, migrate, () => client.close());
    }
  }
  throw new BlendxConfigError(`unknown database driver "${String(driver)}"`);
}
