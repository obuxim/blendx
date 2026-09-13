/**
 * D33: a composite primary key in the generated schema is the constraint Postgres names
 * `<table>_pkey`, over every key column, so the error mapping can trace a 23505 on it back
 * to its columns through constraintNames.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constraintNames } from '@blendx/dbml';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { models, order_items, orders, users } from './golden/kitchen-sink.schema.gen.ts';

const dbmlDir = join(import.meta.dir, '..');
const schemaPath = join(import.meta.dir, 'golden', 'kitchen-sink.schema.gen.ts');
const client = new PGlite();
const db = drizzle({ client });
let outDir = '';

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'blendx-d33-'));
  const kit = Bun.spawnSync(
    [
      process.execPath,
      'x',
      '--bun',
      'drizzle-kit',
      'generate',
      '--dialect=postgresql',
      `--schema=${schemaPath}`,
      `--out=${outDir}`,
      '--name=init',
    ],
    { cwd: dbmlDir, stdout: 'pipe', stderr: 'pipe' },
  );
  if (kit.exitCode !== 0) {
    throw new Error(`drizzle-kit generate failed:\n${kit.stdout}\n${kit.stderr}`);
  }
  await migrate(db, { migrationsFolder: outDir });
}, 60_000);

afterAll(async () => {
  await client.close();
  await rm(outDir, { recursive: true, force: true });
});

function errorField(error: unknown, field: 'code' | 'constraint'): string | undefined {
  for (let e: unknown = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    const value = (e as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

const failure = (query: PromiseLike<unknown>) =>
  Promise.resolve(query).then(
    () => undefined,
    (error: unknown) => error,
  );

describe('D33 composite primary key applied to PGlite', () => {
  test('Postgres holds order_items_pkey over both key columns', async () => {
    const { rows } = await client.query<{ name: string; columns: string[] }>(
      `select conname as name, array(
         select attname from pg_attribute
         where attrelid = conrelid and attnum = any(conkey)
         order by array_position(conkey, attnum)
       ) as columns
       from pg_constraint where conrelid = 'order_items'::regclass and contype = 'p'`,
    );
    expect(rows).toEqual([
      { name: constraintNames.primaryKey('order_items'), columns: ['order_id', 'line'] },
    ]);
    expect(models.order_items.meta.primaryKey).toEqual(['order_id', 'line']);
    expect(models.order_items.meta.generated).toEqual([]);
  });

  test('a second row with the same key fails with 23505 on order_items_pkey', async () => {
    const [user] = await db
      .insert(users)
      .values({ email: 'ada@example.com', password: 'secret' })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({ user_id: user?.id ?? 0, total: '1.00' })
      .returning();
    const line = { order_id: order?.id ?? 0, line: 1, sku: 'A-1' };
    await db.insert(order_items).values(line);
    await db.insert(order_items).values({ ...line, line: 2 });
    const error = await failure(db.insert(order_items).values(line));
    expect(errorField(error, 'code')).toBe('23505');
    expect(errorField(error, 'constraint')).toBe(constraintNames.primaryKey('order_items'));
  });
});
