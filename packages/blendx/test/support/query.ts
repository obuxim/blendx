import { sql } from 'drizzle-orm';
import type { Database } from '../../src/database.ts';

/** Runs one statement and returns its rows: node-postgres and PGlite wrap them in { rows }. */
export async function query(database: Database, text: string): Promise<unknown[]> {
  const result: unknown = await database.db.execute(sql.raw(text));
  return Array.isArray(result) ? result : (result as { rows: unknown[] }).rows;
}
