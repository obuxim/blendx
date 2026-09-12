/**
 * createDatabase(config): opens the app's database with the configured driver (D7). Each
 * driver package is an optional peer, imported only when chosen, so an app installs just
 * its own. It lives in the facade because drivers are runtime-specific; core stays portable.
 */
import { BlendxConfigError, type Config, type DatabaseDriver, type Db } from '@blendx/core';

export interface Database {
  readonly driver: DatabaseDriver;
  readonly db: Db;
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

const opened = (driver: DatabaseDriver, db: unknown, close: () => Promise<unknown>): Database => ({
  driver,
  db: db as Db,
  async close() {
    await close();
  },
});

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
    return opened(driver, drizzle({ client }), () => client.close());
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
      return opened(driver, drizzle({ client: pool }), () => pool.end());
    }
    case 'postgres-js': {
      const postgres = (await load<PostgresJs>(driver, 'postgres')).default;
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const client = postgres(url);
      return opened(driver, drizzle({ client: client as never }), () => client.end());
    }
    case 'bun-sql': {
      const { SQL } = await load<typeof import('bun')>(driver, 'bun');
      const { drizzle } = await import('drizzle-orm/bun-sql');
      const client = new SQL(url);
      return opened(driver, drizzle({ client }), () => client.close());
    }
  }
  throw new BlendxConfigError(`unknown database driver "${String(driver)}"`);
}
