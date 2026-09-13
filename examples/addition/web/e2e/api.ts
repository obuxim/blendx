/**
 * The addition API for the browser tests: server.ts's app and routes, on PGlite in memory
 * rather than in ./.data, so every run starts from an empty table and leaves no data behind.
 */
import { join } from 'node:path';
import { createDatabase, createServer } from 'blendx';
import app from '../../src/app.ts';
import { routes } from '../../src/generated/routes.gen.ts';

const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
await database.migrate(join(import.meta.dir, '..', '..', 'drizzle'));

export default {
  port: Number(process.env.PORT ?? 3100),
  fetch: createServer({ app, db: database.db, routes }).fetch,
};
