/**
 * The expenses example end to end, through the same app, generated routes and committed
 * migrations that server.ts serves. PGlite in memory by default; with BLENDX_TEST_DB=pg it
 * runs on DATABASE_URL, whose public and drizzle schemas it resets. The tests run in order
 * and share the database: Ada and Bob file claims, Cy approves them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createDatabase, createServer, type Database } from 'blendx';
import { sql } from 'blendx/drizzle';
import app from '../src/app.ts';
import { routes } from '../src/generated/routes.gen.ts';
import { models } from '../src/generated/schema.gen.ts';

const realPostgres = process.env.BLENDX_TEST_DB === 'pg';

let database: Database;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  database = await createDatabase({
    database: realPostgres
      ? { driver: 'pg', url: undefined }
      : { driver: 'pglite', url: undefined },
  });
  if (realPostgres) {
    await database.db.execute(sql.raw('drop schema if exists drizzle cascade'));
    await database.db.execute(sql.raw('drop schema if exists public cascade'));
    await database.db.execute(sql.raw('create schema public'));
  }
  await database.migrate(join(import.meta.dir, '..', 'drizzle'));
  server = createServer({ app, db: database.db, routes });
}, 30_000);
afterAll(() => database.close());

interface Sent {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: replies are checked with expect, not typed
  body: any;
}

async function send(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<Sent> {
  const res = await server.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? undefined : JSON.parse(text) };
}

const pointers = (sent: Sent) =>
  (sent.body.errors as { pointer: string }[]).map((error) => error.pointer).sort();

const users: Record<'ada' | 'bob' | 'cy', { id: number; token: string }> = {
  ada: { id: 0, token: '' },
  bob: { id: 0, token: '' },
  cy: { id: 0, token: '' },
};
const lunch = {
  description: 'Team lunch',
  category: 'meals',
  amount: '40.00',
  spent_on: '2026-09-01',
};

describe(`expenses example on ${realPostgres ? 'PostgreSQL' : 'PGlite'}`, () => {
  test('signing up answers 201 with the bearer token', async () => {
    for (const name of ['ada', 'bob', 'cy'] as const) {
      const signed = await send('POST', '/users', {
        body: { email: `${name}@example.com`, name },
      });
      expect(signed.status).toBe(201);
      expect(signed.body).toMatchObject({ email: `${name}@example.com`, is_approver: false });
      expect(signed.body.api_token).toMatch(/^[0-9a-f-]{36}$/);
      users[name] = { id: signed.body.id, token: signed.body.api_token };
    }
    // Approvers are made in the database, as scripts/make-approver.ts does.
    const table = models.users.table;
    await database.db
      .update(table)
      .set({ is_approver: true })
      .where(sql`${table.id} = ${users.cy.id}`);
  });

  test('signing up takes only an email and a name; an email is taken once', async () => {
    const approver = await send('POST', '/users', {
      body: { email: 'eve@example.com', name: 'Eve', is_approver: true },
    });
    expect(approver.status).toBe(422);
    expect(pointers(approver)).toEqual(['/is_approver']);

    const again = await send('POST', '/users', { body: { email: 'ada@example.com', name: 'A' } });
    expect(again.status).toBe(409);
    expect(pointers(again)).toEqual(['/email']);
  });

  test('a user sees only their own record', async () => {
    const own = await send('GET', `/users/${users.ada.id}`, { token: users.ada.token });
    expect(own.status).toBe(200);
    expect(own.body.api_token).toBe(users.ada.token);
    const other = await send('GET', `/users/${users.bob.id}`, { token: users.ada.token });
    expect(other.status).toBe(403);
  });

  test('filing a claim needs a token that belongs to someone', async () => {
    expect((await send('POST', '/expenses', { body: lunch })).status).toBe(401);
    const stranger = '00000000-0000-4000-8000-000000000000';
    expect((await send('POST', '/expenses', { token: stranger, body: lunch })).status).toBe(401);
  });

  test('a claim is priced, and filed for the signed-in user as a draft', async () => {
    const filed = await send('POST', '/expenses', { token: users.ada.token, body: lunch });
    expect(filed.status).toBe(201);
    expect(filed.body).toMatchObject({
      id: 1,
      user_id: users.ada.id,
      amount: '40.00',
      tax: '4.00',
      total: '44.00',
      status: 'draft',
      review_note: null,
    });
    const bobs = await send('POST', '/expenses', {
      token: users.bob.token,
      body: { description: 'Train', category: 'travel', amount: '12.50', spent_on: '2026-09-02' },
    });
    expect(bobs.body).toMatchObject({ id: 2, user_id: users.bob.id, tax: '0.00', total: '12.50' });
  });

  test('the claimant, the totals and the status are never sent; amounts are money', async () => {
    const smuggled = await send('POST', '/expenses', {
      token: users.ada.token,
      body: { ...lunch, user_id: users.bob.id, total: '1.00', status: 'approved' },
    });
    expect(smuggled.status).toBe(422);
    expect(pointers(smuggled)).toEqual(['/status', '/total', '/user_id']);

    for (const amount of [40, '4.005', '-1']) {
      const invalid = await send('POST', '/expenses', {
        token: users.ada.token,
        body: { ...lunch, amount },
      });
      expect(invalid.status).toBe(422);
      expect(pointers(invalid)).toEqual(['/amount']);
    }
  });

  test('show: the claimant and approvers, nobody else', async () => {
    expect((await send('GET', '/expenses/1', { token: users.ada.token })).status).toBe(200);
    expect((await send('GET', '/expenses/1', { token: users.cy.token })).status).toBe(200);
    expect((await send('GET', '/expenses/1', { token: users.bob.token })).status).toBe(403);
  });

  test('listing: approvers see every claim; others list their own', async () => {
    const ada = users.ada.token;
    expect((await send('GET', '/expenses', { token: ada })).status).toBe(403);
    expect((await send('GET', `/expenses?user_id=${users.bob.id}`, { token: ada })).status).toBe(
      403,
    );
    const own = await send('GET', `/expenses?user_id=${users.ada.id}`, { token: ada });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ data: [{ id: 1 }], meta: { total: 1 } });

    const all = await send('GET', '/expenses?status=draft&sort=-id', { token: users.cy.token });
    expect(all.body).toMatchObject({ data: [{ id: 2 }, { id: 1 }], meta: { total: 2 } });
  });

  test('quote prices a claim without filing it', async () => {
    const quoted = await send('GET', '/expenses/quote?amount=10&category=office', {
      token: users.ada.token,
    });
    expect(quoted).toEqual({ status: 200, body: { tax: '2.00', total: '12.00' } });
  });

  test('a draft can change, and is priced again', async () => {
    const updated = await send('PATCH', '/expenses/1', {
      token: users.ada.token,
      body: { amount: '50.00' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ category: 'meals', tax: '5.00', total: '55.00' });
    const bobs = await send('PATCH', '/expenses/1', {
      token: users.bob.token,
      body: { amount: '1.00' },
    });
    expect(bobs.status).toBe(403);
  });

  test('a submitted claim is locked for its claimant', async () => {
    const submitted = await send('POST', '/expenses/1/submit', { token: users.ada.token });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('submitted');
    const ada = users.ada.token;
    expect((await send('PATCH', '/expenses/1', { token: ada, body: { amount: '1' } })).status).toBe(
      403,
    );
    expect((await send('DELETE', '/expenses/1', { token: ada })).status).toBe(403);
    expect((await send('POST', '/expenses/1/submit', { token: ada })).status).toBe(403);
  });

  test('approvers review submitted claims, but never their own', async () => {
    const cy = users.cy.token;
    // Only approvers review, and only what was submitted.
    expect((await send('POST', '/expenses/1/approve', { token: users.bob.token })).status).toBe(
      403,
    );
    expect((await send('POST', '/expenses/2/approve', { token: cy })).status).toBe(403);

    const own = await send('POST', '/expenses', {
      token: cy,
      body: {
        description: 'Printer ink',
        category: 'office',
        amount: '30.00',
        spent_on: '2026-09-03',
      },
    });
    await send('POST', `/expenses/${own.body.id}/submit`, { token: cy });
    expect((await send('POST', `/expenses/${own.body.id}/approve`, { token: cy })).status).toBe(
      403,
    );

    const noNote = await send('POST', '/expenses/1/reject', { token: cy, body: {} });
    expect(noNote.status).toBe(422);
    expect(pointers(noNote)).toEqual(['/note']);
    const rejected = await send('POST', '/expenses/1/reject', {
      token: cy,
      body: { note: 'No receipt attached' },
    });
    expect(rejected.body).toMatchObject({ status: 'rejected', review_note: 'No receipt attached' });

    await send('POST', '/expenses/2/submit', { token: users.bob.token });
    const approved = await send('POST', '/expenses/2/approve', { token: cy });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(
      (await send('POST', '/expenses/2/reject', { token: cy, body: { note: 'no' } })).status,
    ).toBe(422);
  });

  test('a draft is soft-deleted, and restored', async () => {
    const ada = users.ada.token;
    const filed = await send('POST', '/expenses', { token: ada, body: lunch });
    const path = `/expenses/${filed.body.id}`;
    expect((await send('DELETE', path, { token: ada })).status).toBe(204);
    expect((await send('GET', path, { token: ada })).status).toBe(404);
    const restored = await send('POST', `${path}/restore`, { token: ada });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id: filed.body.id, deleted_at: null });
  });
});
