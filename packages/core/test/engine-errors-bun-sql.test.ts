/**
 * P11.7: bun-sql's PostgresError keeps the SQLSTATE in `errno` and uses `code` for its own
 * name (D16). The engine maps it like any other driver's error. No database: a store's save
 * hook throws the error the way drizzle wraps it, inside a stand-in transaction.
 */
import { expect, test } from 'bun:test';
import {
  allow,
  blend,
  type Db,
  defaultEffects,
  defineApp,
  execute,
  resolveEndpoint,
  toEndpoints,
} from '@blendx/core';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

/** What drizzle throws on bun-sql: a query error whose cause is Bun's PostgresError. */
function bunSqlError(errno: string, fields: Record<string, string> = {}): Error {
  const cause = Object.assign(new Error('the database refused the query'), {
    code: 'ERR_POSTGRES_SERVER_ERROR',
    errno,
    ...fields,
  });
  return Object.assign(new Error('Failed query'), { cause });
}

const database = { transaction: (run: (tx: unknown) => unknown) => run(database) };

function storeThatThrows(error: Error) {
  const users = blend(shop.users, {
    policy: allow.public,
    hidden: ['password'],
    actions: (a) => [
      a.store({
        save: async () => {
          throw error;
        },
      }),
    ],
  });
  const [definition] = toEndpoints(users);
  if (!definition) throw new Error('no store');
  const endpoint = resolveEndpoint(definition, {
    app: defineApp({}),
    defaults: defaultEffects(definition),
  });
  const body = { email: 'ada@example.com', password: 'secret' };
  return () =>
    execute(endpoint, { params: {}, query: {}, body, auth: null }, { db: database as never as Db });
}

test('a unique violation from bun-sql answers 409, pointing at the column', async () => {
  const run = storeThatThrows(bunSqlError('23505', { constraint: 'users_email_key' }));
  const result = await run();
  expect(result.status).toBe(409);
  expect(result.body).toMatchObject({ status: 409, errors: [{ pointer: '/email' }] });
});

test('an invalid value from bun-sql answers 422', async () => {
  expect((await storeThatThrows(bunSqlError('22P02'))()).status).toBe(422);
});

test('an error with no SQLSTATE anywhere is not hidden', async () => {
  await expect(storeThatThrows(new Error('the disk is full'))()).rejects.toThrow(
    'the disk is full',
  );
});
