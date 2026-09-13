/**
 * P16.4 (D27) on real PostgreSQL: workers claim entries with FOR UPDATE SKIP LOCKED, so two
 * draining one table at once never run the same entry. Runs only with BLENDX_TEST_DB=pg and
 * DATABASE_URL (a scratch database); PGlite has a single connection, so nothing races there.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { allow, blend, defineApp, drainOutbox, outbox } from '@blendx/core';
import type { Pool } from 'pg';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { postgresDatabase, realPostgres, type TestDatabase } from './support/database.ts';

let database: (TestDatabase & { pool: Pool }) | undefined;

beforeAll(async () => {
  if (!realPostgres) return;
  database = await postgresDatabase(join(import.meta.dir, 'support', 'outbox-shop.schema.ts'));
}, 60_000);
afterAll(() => database?.close());

describe.skipIf(!realPostgres)('the outbox on real PostgreSQL', () => {
  test('two workers draining at once never run one entry twice', async () => {
    if (!database) throw new Error('no database');
    const seen: number[] = [];
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.update({
          later: async ({ id }) => {
            seen.push(id);
            await Bun.sleep(5);
          },
        }),
      ],
    });
    const payload = { saved: {}, input: {}, auth: null };
    await database.db.insert(outbox).values(
      Array.from({ length: 30 }, () => ({
        resource: 'orders',
        action: 'update',
        level: 'action',
        payload,
      })),
    );
    const options = { app: defineApp({}), db: database.db, resources: [orders], batch: 3 };
    const [one, two] = await Promise.all([drainOutbox(options), drainOutbox(options)]);
    expect(one.ran + two.ran).toBe(30);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });
});
