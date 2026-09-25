/**
 * blendx.config.ts: where an app's files live and how to reach its database.
 * defineConfig fills in the defaults and validates; the CLI's loadConfig resolves the
 * paths against the config file's folder.
 */
import { BlendxConfigError } from './app.ts';

export const DATABASE_DRIVERS = ['pg', 'postgres-js', 'bun-sql', 'pglite'] as const;
export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];

export const CONFIG_DEFAULTS = {
  schema: './schema.dbml',
  blends: './blends',
  app: './src/app.ts',
  generated: './src/generated',
  review: './review',
  migrations: './drizzle',
  dataMigrations: './data-migrations',
} as const;

type PathKey = keyof typeof CONFIG_DEFAULTS;

export interface ConfigInput {
  /** schema.dbml, relative to the config file. */
  schema?: string;
  /** Folder of blend files. */
  blends?: string;
  /** Module that default-exports the app (defineApp). */
  app?: string;
  /** Folder for generated files. Never edit them. */
  generated?: string;
  /** Folder for the review YAML. */
  review?: string;
  /** Folder for schema migrations. */
  migrations?: string;
  /** Folder of ordered data-migration modules. */
  dataMigrations?: string;
  database?: { driver?: DatabaseDriver; url?: string };
  openapi?: { title?: string; version?: string };
}

export type Config = { readonly [K in PathKey]: string } & {
  readonly database: { readonly driver: DatabaseDriver; readonly url: string | undefined };
  readonly openapi: { readonly title: string; readonly version: string };
};

/** Fills in the defaults and validates the config. Throws BlendxConfigError. */
export function defineConfig(input: ConfigInput = {}): Config {
  const paths = {} as Record<PathKey, string>;
  for (const key of Object.keys(CONFIG_DEFAULTS) as PathKey[]) {
    const value: unknown = input[key] ?? CONFIG_DEFAULTS[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BlendxConfigError(`config.${key} must be a non-empty path`);
    }
    paths[key] = value;
  }

  const driver: unknown = input.database?.driver ?? 'pg';
  if (!(DATABASE_DRIVERS as readonly unknown[]).includes(driver)) {
    throw new BlendxConfigError(
      `config.database.driver must be one of ${DATABASE_DRIVERS.join(', ')}; got "${String(driver)}"`,
    );
  }

  return Object.freeze({
    ...paths,
    database: Object.freeze({ driver: driver as DatabaseDriver, url: input.database?.url }),
    openapi: Object.freeze({
      title: input.openapi?.title ?? 'blendx API',
      version: input.openapi?.version ?? '0.1.0',
    }),
  });
}
