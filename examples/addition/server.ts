/**
 * Serves the addition API: `bun server.ts`, then POST /addition_results {"a": 4, "b": 3}.
 * It applies pending migrations on start, so a fresh PGlite folder just works.
 */
import { join } from 'node:path';
import { createDatabase, createServer } from 'blendx';
import config from './blendx.config.ts';
import app from './src/app.ts';
import { routes } from './src/generated/routes.gen.ts';

export type { AppType } from './src/generated/routes.gen.ts';

const database = await createDatabase(config);
await database.migrate(join(import.meta.dir, 'drizzle'));

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: createServer({ app, db: database.db, routes }).fetch,
};
