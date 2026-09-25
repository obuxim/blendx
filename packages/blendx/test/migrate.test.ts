/** P17.18: Schema migrations run before transactional, ledgered data migrations. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { dataMigration } from '@blendx/core';
import { sql } from 'drizzle-orm';
import { createDatabase, DataMigrationError } from '../src/database.ts';
import { query } from './support/query.ts';

const folder = join(import.meta.dir, 'fixtures', 'migrations');

test('pglite: schema migrations run before ordered data steps, which run once', async () => {
  const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  try {
    const calls: string[] = [];
    const second = dataMigration({
      id: '20260925_second',
      async up({ tx }) {
        calls.push('second');
        await tx.execute(sql.raw("insert into notes values (2, 'second')"));
      },
    });
    const first = dataMigration({
      id: '20260925_first',
      async up({ tx }) {
        calls.push('first');
        await tx.execute(sql.raw("insert into notes values (1, 'first')"));
      },
    });

    expect(await database.migrate(folder, [second, first])).toEqual({
      schema: 1,
      data: ['20260925_first', '20260925_second'],
    });
    expect(calls).toEqual(['first', 'second']);
    expect(await database.migrate(folder, [second, first])).toEqual({ schema: 0, data: [] });
    expect(calls).toEqual(['first', 'second']);
    expect(await query(database, "insert into notes values (10, 'hi') returning body")).toEqual([
      { body: 'hi' },
    ]);
    expect(
      await query(
        database,
        'select id, applied_at is not null as applied from blendx.__blendx_data_migrations order by id',
      ),
    ).toEqual([
      { id: '20260925_first', applied: true },
      { id: '20260925_second', applied: true },
    ]);
  } finally {
    await database.close();
  }
});

test('pglite: failed data migrations roll back, stay pending, and stop later steps', async () => {
  const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  try {
    let shouldFail = true;
    const cause = new Error('backfill failed');
    const failing = dataMigration({
      id: '20260925_failing',
      async up({ tx }) {
        await tx.execute(sql.raw("insert into notes values (3, 'rolled back')"));
        if (shouldFail) throw cause;
      },
    });
    const later = dataMigration({
      id: '20260925_later',
      async up({ tx }) {
        await tx.execute(sql.raw("insert into notes values (4, 'later')"));
      },
    });

    const error = await database
      .migrate(folder, [failing, later])
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DataMigrationError);
    expect(error).toMatchObject({ id: '20260925_failing', cause });
    expect(await query(database, 'select * from notes')).toEqual([]);
    expect(
      await query(database, "select to_regclass('blendx.__blendx_data_migrations') as ledger"),
    ).toEqual([{ ledger: null }]);

    shouldFail = false;
    expect(await database.migrate(folder, [failing, later])).toEqual({
      schema: 0,
      data: ['20260925_failing', '20260925_later'],
    });
    expect(await query(database, 'select id, body from notes order by id')).toEqual([
      { id: 3, body: 'rolled back' },
      { id: 4, body: 'later' },
    ]);
  } finally {
    await database.close();
  }
});

test('pglite: concurrent migration calls apply each data step once', async () => {
  const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  try {
    expect(await database.migrate(folder)).toEqual({ schema: 1, data: [] });
    expect(
      await query(database, "select to_regclass('blendx.__blendx_data_migrations') as ledger"),
    ).toEqual([{ ledger: null }]);
    let runs = 0;
    const once = dataMigration({
      id: '20260925_once',
      async up({ tx }) {
        runs += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        await tx.execute(sql.raw("insert into notes values (5, 'once')"));
      },
    });

    const results = await Promise.all([
      database.migrate(folder, [once]),
      database.migrate(folder, [once]),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { schema: 0, data: ['20260925_once'] },
        { schema: 0, data: [] },
      ]),
    );
    expect(runs).toBe(1);
    expect(await query(database, 'select id, body from notes')).toEqual([{ id: 5, body: 'once' }]);
  } finally {
    await database.close();
  }
});

test('duplicate data migration IDs fail before schema migrations run', async () => {
  const database = await createDatabase({ database: { driver: 'pglite', url: undefined } });
  try {
    const first = dataMigration({ id: '20260925_duplicate', up() {} });
    const second = dataMigration({ id: '20260925_duplicate', up() {} });
    await expect(database.migrate(folder, [first, second])).rejects.toThrow(
      'duplicate data migration id "20260925_duplicate"',
    );
    expect(await query(database, "select to_regclass('public.notes') as notes")).toEqual([
      { notes: null },
    ]);
  } finally {
    await database.close();
  }
});
