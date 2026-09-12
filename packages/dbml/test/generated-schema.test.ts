/**
 * P2.6: the generated schema is a working Drizzle schema.
 *
 * drizzle-kit turns the golden shop schema into SQL and PGlite applies it. Postgres must
 * then hold exactly the constraint and index names blendx promises (constraintNames),
 * because the P5.7 error mapping traces violations back to columns through them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constraintNames } from '@blendx/dbml';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { models, order_notes, orders, users } from './golden/shop.schema.gen.ts';

const dbmlDir = join(import.meta.dir, '..');
const schemaPath = join(import.meta.dir, 'golden', 'shop.schema.gen.ts');
const client = new PGlite();
const db = drizzle({ client });
let outDir = '';

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'blendx-p2-6-'));
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

/** A field of a failed query's error, wherever drizzle or the driver put it. */
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

function only<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1)
    throw new Error(`expected one row, got ${rows.length}`);
  return row;
}

const names = async (query: string) =>
  (await client.query<{ name: string }>(query)).rows.map((r) => r.name).sort();

describe('P2.6 generated schema applied to PGlite', () => {
  test('Postgres holds the constraint and index names blendx promises', async () => {
    expect(
      await names(
        `select conname as name from pg_constraint where conrelid = 'orders'::regclass and contype in ('p', 'u', 'f')`,
      ),
    ).toEqual(
      [
        constraintNames.primaryKey('orders'),
        constraintNames.unique('orders', ['public_id']),
        constraintNames.foreignKey('orders', ['user_id']),
      ].sort(),
    );
    expect(
      await names(`select indexname as name from pg_indexes where tablename = 'orders'`),
    ).toEqual(
      [
        constraintNames.index('orders', ['created_at']),
        constraintNames.primaryKey('orders'),
        constraintNames.unique('orders', ['public_id']),
        'orders_user_status_idx',
      ].sort(),
    );
  });

  test('models meta lists exactly the constraints Postgres holds', async () => {
    for (const table of ['users', 'orders', 'order_notes'] as const) {
      expect(Object.keys(models[table].meta.constraints).sort()).toEqual(
        await names(
          `select conname as name from pg_constraint where conrelid = '${table}'::regclass and contype in ('p', 'u', 'f')`,
        ),
      );
    }
  });

  test('inserts fill identity keys, defaults and timestamps', async () => {
    const user = only(
      await db.insert(users).values({ email: 'ada@example.com', password: 'secret' }).returning(),
    );
    expect(user).toMatchObject({ id: 1, is_active: true, display_name: null });
    expect(typeof user.created_at).toBe('string');

    const order = only(
      await db.insert(orders).values({ user_id: user.id, total: '12.50' }).returning(),
    );
    expect(order).toMatchObject({
      status: 'pending',
      quantity: 1,
      total: '12.50',
      deleted_at: null,
    });
    expect(order.public_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a duplicate email fails with 23505 on users_email_key', async () => {
    const error = await failure(
      db.insert(users).values({ email: 'ada@example.com', password: 'x' }),
    );
    expect(errorField(error, 'code')).toBe('23505');
    expect(errorField(error, 'constraint')).toBe(constraintNames.unique('users', ['email']));
  });

  test('a missing parent fails with 23503 on orders_user_id_fkey', async () => {
    const error = await failure(db.insert(orders).values({ user_id: 999, total: '1.00' }));
    expect(errorField(error, 'code')).toBe('23503');
    expect(errorField(error, 'constraint')).toBe(constraintNames.foreignKey('orders', ['user_id']));
  });

  test('deleting an order cascades to its notes', async () => {
    const order = only(await db.select().from(orders));
    await db.insert(order_notes).values({ order_id: order.id, body: 'ring twice' });
    expect(await db.$count(order_notes)).toBe(1);
    await db.delete(orders).where(eq(orders.id, order.id));
    expect(await db.$count(order_notes)).toBe(0);
  });
});
