# Getting started

This page sets up a project, exposes one table and serves it. The [tutorial](tutorial.md) then builds a complete app.

## What you need

- [Bun](https://bun.sh) 1.4.2. The `blendx` command runs on Bun, and so does the app while you develop it. In production the app can also run on Node 24 ([Deployment](deployment.md#serving-on-node)).
- A PostgreSQL database, or none to begin with: PGlite runs PostgreSQL inside your process and keeps its data in a folder.

## Install blendx

blendx is not on npm yet. Until it is, there are two ways to use it.

### In a folder of your own, linked to a clone

Clone blendx, and register its two packages with Bun once:

```sh
git clone https://github.com/obuxim/blendx.git
cd blendx
bun install
(cd packages/blendx && bun link)
(cd packages/cli && bun link)
```

In your app's `package.json`, depend on the linked packages:

```json
{
  "name": "notes",
  "private": true,
  "type": "module",
  "dependencies": {
    "@electric-sql/pglite": "0.5.8",
    "blendx": "link:blendx"
  },
  "devDependencies": {
    "@blendx/cli": "link:@blendx/cli",
    "@types/bun": "1.4.2",
    "typescript": "7.0.2"
  }
}
```

Then run `bun install`. The app uses blendx straight from the clone, so `git pull` and `bun install` in the clone update it. `blendx` is what the app imports and serves with; `@blendx/cli` is the `blendx` command, needed only while developing. Once blendx is published, these become `bun add blendx` and `bun add -d @blendx/cli`.

### Inside the blendx repository

Every folder under `examples/` is a workspace of the repository. An app there depends on `"blendx": "workspace:*"` and `"@blendx/cli": "workspace:*"`, `bun install` at the root links them, and its `tsconfig.json` can extend the repository's `tsconfig.base.json`. The examples are built this way; see [`examples/addition`](../../examples/addition).

## The files of an app

```
notes/
  package.json
  tsconfig.json
  blendx.config.ts     where the files are, and which database
  schema.dbml          the tables
  src/app.ts           the app: the identity, and hooks for every table
  blends/notes.ts      one blend per table you expose
  server.ts            serves the API
  src/generated/       written by blendx generate; never edit
  drizzle/             migrations, written by blendx migrate generate
  review/              written by blendx review, for people to read
```

## 1. tsconfig.json

The settings blendx itself uses:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["."]
}
```

Imports name their `.ts` files, so that Node can run the app too. `tsc` checks more than style here: the hook types catch most mistakes in a blend before anything runs.

## 2. blendx.config.ts

```ts
import { defineConfig } from 'blendx';

export default defineConfig({ database: { driver: 'pglite', url: './.data' } });
```

This keeps the data in `./.data`, so add that folder to `.gitignore`. For PostgreSQL, use `{ driver: 'pg' }`, add the `pg` package, and set `DATABASE_URL`. Every other setting has a default ([Configuration](deployment.md#blendxconfigts)).

## 3. schema.dbml

```dbml
Table notes {
  id int [pk, increment]
  body text [not null]
  created_at timestamp
  updated_at timestamp
}
```

blendx recognises `id [pk, increment]`, `created_at` and `updated_at`: it fills them in, and never accepts them as input ([The schema](schema.md)).

## 4. src/app.ts

```ts
import { defineApp } from 'blendx';

export default defineApp({});
```

The app is where a request's identity comes from (`auth`), and where hooks for every table go. This one has neither, so every request is anonymous ([The app and identity](app.md)).

## 5. blends/notes.ts

```ts
import { allow, blend } from 'blendx';
import { models } from '../src/generated/schema.gen.ts';

export default blend(models.notes, {
  policy: allow.public,
  actions: (a) => [a.index(), a.store(), a.show()],
});
```

This exposes three actions to anyone. Every action needs a policy, and only the listed actions get routes: this API cannot update or delete a note ([Blends](blends.md)). `schema.gen.ts` does not exist yet; the next step writes it.

## 6. Generate

```
$ bunx blendx generate
wrote src/generated/schema.gen.ts
wrote src/generated/routes.gen.ts
wrote src/generated/register.gen.ts
wrote src/generated/drizzle.config.gen.ts
wrote src/generated/openapi.json
```

Run it again after every change to `schema.dbml`, a blend or `src/app.ts`. Never edit what it writes ([The CLI](cli.md#blendx-generate)).

## 7. Migrate

```
$ bunx blendx migrate generate --name init
[✓] Your SQL migration ➜ drizzle/20260913064207_init/migration.sql 🚀
$ bunx blendx migrate up
applied 1 migration from drizzle
```

The first command writes the SQL that brings the database to the schema, and the second applies it. After each schema change: generate, then the next migration, named after what changed.

## 8. Serve

`server.ts`:

```ts
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
```

It opens the database, applies pending migrations, and serves the generated routes. `bun server.ts` starts it:

```
$ curl -s -X POST localhost:3000/notes -H 'content-type: application/json' -d '{"body":"hello"}'
{"id":1,"body":"hello","created_at":"2026-09-13 12:53:08.562","updated_at":"2026-09-13 12:53:08.562"}

$ curl -s localhost:3000/notes
{"data":[{"id":1,"body":"hello","created_at":"2026-09-13 12:53:08.562","updated_at":"2026-09-13 12:53:08.562"}],"meta":{"page":1,"per_page":25,"total":1}}

$ curl -s -X POST localhost:3000/notes -H 'content-type: application/json' -d '{"body":1,"title":"x"}'
{"type":"about:blank","title":"Unprocessable Content","status":422,"detail":"The request did not pass validation.","errors":[{"pointer":"/body","detail":"Invalid input: expected string, received number"},{"pointer":"/title","detail":"is not an accepted field"}]}
```

Nothing in the app said any of this. The schema says `body` is text and required, so a number is refused. `title` is not a column, and input is strict, so it is refused too. blendx set both timestamps, and the index came back paginated ([The HTTP API](http.md)).

## 9. Check it

- `bunx tsc --noEmit` typechecks the app.
- `bunx blendx review` writes `review/notes.yaml`, which says what each action does ([Review](review.md)).
- In CI: `bunx blendx generate --check`, `bunx blendx review --check`, `bunx tsc --noEmit` and `bun test`.

## Next

- The [tutorial](tutorial.md) builds an app with an identity, roles, business rules and calculations.
- If an AI agent will work on the app, copy [`examples/addition/CLAUDE.md`](../../examples/addition/CLAUDE.md) into it and adjust its first lines.
