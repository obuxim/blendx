/**
 * Serves the shop fixture in-process for the conformance suite (P11.4): the fixture's app and
 * generated routes over a database migrated with its committed migration. reset() truncates
 * every table, restarting identities, and runs seed.sql. The fixture's modules load by
 * computed path, so they stay out of the root tsc program: their auth type comes from the
 * fixture's own register.gen.ts, which only its own project includes.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type App, createDatabase, createServer, type DatabaseConfig } from 'blendx';
import { sql } from 'blendx/drizzle';
import type { CaseFile, ConformanceCase } from '../src/case.ts';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'fixtures', 'shop');
const TABLES = ['order_notes', 'orders', 'users'];

export interface Shop {
  fetch(request: Request): Response | Promise<Response>;
  /** Back to the fixture's starting state: empty tables, then seed.sql. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function startShop(
  database: DatabaseConfig['database'] = { driver: 'pglite', url: undefined },
): Promise<Shop> {
  const opened = await createDatabase({ database });
  await opened.migrate(join(fixture, 'drizzle'));

  const app = (await import(join(fixture, 'src', 'app.ts'))).default as App;
  const { routes } = (await import(join(fixture, 'src', 'generated', 'routes.gen.ts'))) as {
    routes: never;
  };
  const server = createServer({ app, db: opened.db, routes });

  const seed = (await readFile(join(fixture, 'seed.sql'), 'utf8'))
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  return {
    fetch: (request) => server.fetch(request),
    async reset() {
      await opened.db.execute(sql.raw(`truncate ${TABLES.join(', ')} restart identity cascade`));
      for (const statement of seed) await opened.db.execute(sql.raw(statement));
    },
    close: () => opened.close(),
  };
}

/** Every case in packages/conformance/cases, file by file in name order. */
export async function loadCases(): Promise<ConformanceCase[]> {
  const folder = join(root, 'cases');
  const names = (await readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  const files = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(folder, name), 'utf8')) as CaseFile),
  );
  return files.flatMap((file) => file.cases);
}
