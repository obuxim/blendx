# Configuration and deployment

## blendx.config.ts

The CLI reads `blendx.config.ts` in the app folder, and `server.ts` imports it to open the database. Every key is optional:

```ts
import { defineConfig } from 'blendx';

export default defineConfig({
  database: process.env.DATABASE_URL ? { driver: 'pg' } : { driver: 'pglite', url: './.data' },
  openapi: { title: 'Expenses API', version: '1.0.0' },
});
```

| Key | Default | |
|---|---|---|
| `schema` | `./schema.dbml` | the schema |
| `blends` | `./blends` | the folder of blends |
| `app` | `./src/app.ts` | the module that default-exports `defineApp(...)` |
| `generated` | `./src/generated` | where `blendx generate` writes |
| `review` | `./review` | where `blendx review` writes, and where the examples are |
| `migrations` | `./drizzle` | the migrations |
| `database.driver` | `'pg'` | `'pg'`, `'postgres-js'`, `'bun-sql'` or `'pglite'` |
| `database.url` | `DATABASE_URL` | where the database is |
| `openapi.title`, `openapi.version` | `'blendx API'`, `'0.1.0'` | the OpenAPI document's `info` |

Paths are relative to the config file. `defineConfig` checks the values and throws on a bad one, such as an unknown driver.

## Databases

blendx runs on PostgreSQL only. Pick a driver and install its package; blendx imports only the one you choose, and a missing one is an error that names the package.

| Driver | Package | Runs on | |
|---|---|---|---|
| `pg` | `pg` | Bun and Node | the default |
| `postgres-js` | `postgres` | Bun and Node | |
| `bun-sql` | none: it is Bun's own `SQL` | Bun | |
| `pglite` | `@electric-sql/pglite` | Bun and Node | PostgreSQL in-process: development and tests |

The server drivers take `database.url`, or `DATABASE_URL` when the config has none. PGlite takes only `database.url`: a folder to keep its data in, or none (or `memory://`) for an in-memory database. Only one process at a time can open a PGlite folder, so stop the server before a script or `blendx migrate up` opens it.

The same conformance suite passes on Bun with PGlite, Bun with pg, Bun with bun-sql, and Node 24 with pg.

In code, `createDatabase(config)` opens the configured database:

```ts
import { createDatabase } from 'blendx';
import config from './blendx.config.ts';

const database = await createDatabase(config);
database.db;            // the Drizzle database, for createServer and for scripts
await database.migrate('./drizzle'); // applies pending migrations; resolves to how many ran
await database.close();
```

## Migrations in production

Two ways to apply migrations when you deploy:

- At start-up, as the examples' `server.ts` does: `await database.migrate(join(import.meta.dir, 'drizzle'))` before serving. The production image then needs the `drizzle/` folder, and not the CLI.
- As a release step: `bunx blendx migrate up`, which needs `@blendx/cli` installed.

Either way, migrations are written during development (`blendx migrate generate`) and committed; production never generates them.

## Serving on Bun

The examples' `server.ts` default-exports what `Bun.serve` takes:

```ts
export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: createServer({ app, db: database.db, routes }).fetch,
};
```

`bun server.ts` serves it.

## Serving on Node

Node 24 runs blendx's TypeScript directly (type stripping), with the `pg`, `postgres-js` or `pglite` driver. Add `@hono/node-server` (blendx is tested with 2.1.1) and serve the same server:

```ts
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createDatabase, createServer } from 'blendx';
import config from './blendx.config.ts';
import app from './src/app.ts';
import { routes } from './src/generated/routes.gen.ts';

const database = await createDatabase(config);
await database.migrate(join(import.meta.dirname, 'drizzle'));

serve({
  fetch: createServer({ app, db: database.db, routes }).fetch,
  port: Number(process.env.PORT ?? 3000),
});
```

`node server.node.ts` serves it. Note `import.meta.dirname`, where Bun also has `import.meta.dir`. The `blendx` command itself still needs Bun, so development and CI run on Bun.

## createServer

`createServer(options)` returns a [Hono](https://hono.dev) app:

| Option | |
|---|---|
| `app` | the app (`src/app.ts`) |
| `db` | `database.db` |
| `routes` | the generated routes |
| `basePath` | where the routes are mounted, such as `'/api'`; `'/'` by default |
| `onError` | called with every unexpected error before the 500 is sent, and with what an `after` hook throws, whose reply stands ([Hooks](hooks.md#after)); `console.error` by default |

Since it is a Hono app, you can add routes of your own to it, such as the OpenAPI document ([The HTTP API](http.md#openapi)). An unexpected error never reaches the client: it gets a bare 500 problem, and `onError` gets the error, which is where to log it or send it to an error tracker.

## Checklist

- `DATABASE_URL` set, and the driver's package installed.
- Migrations applied, at start-up or as a release step.
- `.data/` (PGlite) and `.env` files kept out of git and out of the image.
- `onError` sends errors somewhere you will see them.
- CI runs `bunx blendx generate --check`, `bunx blendx review --check`, `bunx tsc --noEmit` and `bun test`.
