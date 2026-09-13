/**
 * P10.1: the review model. Each action shows its route, its input one line per field,
 * every stage with the levels that shaped it and what the schema level does, and its reply.
 */
import { describe, expect, test } from 'bun:test';
import { allow, blend, defineApp } from '@blendx/core';
import { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { reviewResource } from '../src/review.ts';

const additions = blend(addition.addition_results, {
  policy: allow.public,
  actions: (a) => [
    a.index(),
    a.store({
      rules: () => z.object({ a: z.number(), b: z.number() }),
      calculate: ({ input }) => ({ result: input.a + input.b }),
    }),
    a.show(),
    a.destroy(),
    a.restore(),
  ],
});

const review = reviewResource(additions, defineApp({}));
const action = (name: string) => review.actions.find((candidate) => candidate.name === name);

describe('reviewResource', () => {
  test('the resource, its hidden columns, and the fields of its record', () => {
    expect(review.format).toBe(1);
    expect(review.resource).toBe('addition_results');
    expect(review.hidden).toEqual([]);
    expect(review.record).toEqual({
      id: 'integer',
      result: 'number, or null',
      created_at: 'string, or null',
      updated_at: 'string, or null',
      deleted_at: 'string, or null',
    });
  });

  test('actions come in route order', () => {
    expect(review.actions.map((a) => a.route)).toEqual([
      'GET /addition_results',
      'POST /addition_results',
      'GET /addition_results/:id',
      'DELETE /addition_results/:id',
      'POST /addition_results/:id/restore',
    ]);
  });

  test('store: its input, what each stage does, and which levels changed it', () => {
    expect(action('store')).toEqual({
      name: 'store',
      route: 'POST /addition_results',
      input: { a: 'number', b: 'number' },
      stages: {
        rules: {
          from: ['schema', 'action'],
          default: 'the insert columns, without generated ones',
        },
        load: { from: ['schema'], default: 'nothing' },
        authorize: { from: ['schema'], default: 'public' },
        calculate: { from: ['schema', 'action'], default: "the input's writable columns" },
        save: { from: ['schema'], default: 'insert, setting created_at and updated_at' },
        respond: { from: ['schema'], default: '201 with the saved record' },
      },
      reply: { status: 201, body: 'the record' },
    });
  });

  test('destroy and restore on a soft-delete table', () => {
    expect(action('destroy')?.stages.load.default).toBe(
      'the row by id, not soft-deleted, locked for update',
    );
    expect(action('destroy')?.stages.save.default).toBe(
      'soft delete: set deleted_at, touching updated_at',
    );
    expect(action('destroy')?.reply).toEqual({ status: 204, body: 'none' });
    expect(action('restore')?.stages.load.default).toBe(
      'the soft-deleted row by id, locked for update',
    );
    expect(action('restore')?.stages.save.default).toBe('clear deleted_at, touching updated_at');
  });

  test('index: its query as input, one line per parameter', () => {
    expect(action('index')?.input).toEqual({
      page: 'string, matching ^[1-9][0-9]*$, optional',
      per_page: 'string, matching ^[1-9][0-9]*$, optional',
      sort: 'one of id, -id, optional',
      id: 'string, optional',
    });
    expect(action('index')?.reply).toEqual({ status: 200, body: 'a page of records' });
  });
});

describe('reviewResource with hooks, hidden columns and custom actions', () => {
  const users = blend(shop.users, {
    policy: allow.when(({ auth }) => auth !== null, { description: 'signed-in users' }),
    hidden: ['password'],
    hooks: { authorize: ({ prev }) => prev },
    actions: (a) => [a.show()],
  });
  const orders = blend(shop.orders, {
    policy: allow.public,
    actions: (a) => [
      a.collection('quote', {
        method: 'get',
        rules: () => z.object({ quantity: z.string() }),
        calculate: ({ input }) => ({ total: Number(input.quantity) * 10 }),
        reply: z.object({ total: z.number() }),
      }),
      a.collection('estimate', { calculate: () => ({ total: 1 }) }),
      a.member('touch', {
        respond: ({ record }) => ({ status: 200, body: { id: record.id } }),
      }),
      a.member('peek', { method: 'get' }),
    ],
  });
  const app = defineApp({ hooks: { respond: ({ prev }) => prev } });

  test('hidden columns leave the record; resource and app hooks show in from', () => {
    const review = reviewResource(users, app);
    expect(review.hidden).toEqual(['password']);
    expect(Object.keys(review.record)).not.toContain('password');
    expect(review.actions[0]?.stages.authorize).toEqual({
      from: ['schema', 'resource'],
      default: 'signed-in users',
    });
    expect(review.actions[0]?.stages.respond.from).toEqual(['schema', 'app']);
  });

  test('custom actions: a declared reply, and replies that are not described', () => {
    const review = reviewResource(orders, defineApp({}));
    const byName = (name: string) => review.actions.find((a) => a.name === name);
    expect(byName('quote')?.input).toEqual({ quantity: 'string' });
    expect(byName('quote')?.stages.load.default).toBe('nothing');
    expect(byName('quote')?.reply).toEqual({ status: 200, body: { total: 'number' } });
    expect(byName('estimate')?.reply).toBe(
      'not described: it is what calculate returns; declare reply',
    );
    expect(byName('touch')?.reply).toBe(
      'not described: its respond hook builds the reply; declare reply',
    );
    expect(byName('touch')?.stages.save.default).toBe(
      'update the row, touching updated_at, when there is something to write',
    );
  });

  test('a custom member action saves, so it locks its row even on GET, as the engine does', () => {
    const review = reviewResource(orders, defineApp({}));
    const peek = review.actions.find((a) => a.name === 'peek');
    expect(peek?.route).toBe('GET /orders/:id/peek');
    expect(peek?.stages.load.default).toBe('the row by id, not soft-deleted, locked for update');
  });
});
