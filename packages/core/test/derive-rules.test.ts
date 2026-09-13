/**
 * P4.1: one test per derivation rule. Test names start with the rule id used in
 * packages/spec/derivation-rules.md.
 */
import { describe, expect, test } from 'bun:test';
import { defaultRules, recordSchema } from '@blendx/core';
import type { z } from 'zod';
import { models as addition } from '../../dbml/test/golden/addition.schema.gen.ts';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const builtin = (name: string) => ({ name, builtin: true });
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;
const issues = (schema: z.ZodType, value: unknown): { code: string; path: string }[] => {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }));
};
const unknownKeys = [{ code: 'unrecognized_keys', path: '' }];

const store = defaultRules(shop.orders, builtin('store'));
const validOrder = { user_id: 1, total: '12.50' };

describe('store rules', () => {
  test('DR-STORE-INSERT: accepts the insert columns as given', () => {
    expect(store.parse(validOrder)).toEqual(validOrder);
  });

  test('DR-STORE-GENERATED: identity keys, timestamps and deleted_at are never input', () => {
    expect(Object.keys(store.shape)).toEqual([
      'user_id',
      'status',
      'total',
      'quantity',
      'tags',
      'meta',
      'public_id',
      'placed_on',
    ]);
    expect(issues(store, { ...validOrder, id: 1, created_at: 'x', deleted_at: null })).toEqual(
      unknownKeys,
    );
  });

  test('DR-STORE-STRICT: unknown keys are rejected, so there is no mass assignment', () => {
    expect(issues(store, { ...validOrder, is_admin: true })).toEqual(unknownKeys);
  });

  test('DR-STORE-REQUIRED: NOT NULL without a default is required, the rest optional', () => {
    expect(issues(store, { total: '1' })).toEqual([{ code: 'invalid_type', path: 'user_id' }]);
    expect(ok(store, { ...validOrder, status: 'paid', quantity: 2 })).toBe(true);
  });

  test('DR-NULLABLE: nullable columns accept null, NOT NULL columns do not', () => {
    expect(ok(store, { ...validOrder, tags: null, placed_on: null })).toBe(true);
    expect(issues(store, { ...validOrder, user_id: null })).toEqual([
      { code: 'invalid_type', path: 'user_id' },
    ]);
  });

  test('DR-VARCHAR-MAX: varchar(n) is capped at n characters', () => {
    const users = defaultRules(shop.users, builtin('store'));
    expect(issues(users, { email: 'x'.repeat(256), password: 'p' })).toEqual([
      { code: 'too_big', path: 'email' },
    ]);
  });

  test('DR-INT32: integer columns take 32-bit integers', () => {
    expect(issues(store, { ...validOrder, quantity: 2 ** 31 })).toEqual([
      { code: 'too_big', path: 'quantity' },
    ]);
    expect(issues(store, { ...validOrder, quantity: 1.5 })).toEqual([
      { code: 'invalid_type', path: 'quantity' },
    ]);
  });

  test('DR-ENUM: enum columns take only their values', () => {
    expect(issues(store, { ...validOrder, status: 'shipped' })).toEqual([
      { code: 'invalid_value', path: 'status' },
    ]);
  });

  test('DR-NUMERIC-STRING: numeric columns take strings, so precision is never lost', () => {
    expect(issues(store, { ...validOrder, total: 12.5 })).toEqual([
      { code: 'invalid_type', path: 'total' },
    ]);
  });

  test('DR-DATE-STRING: dates and timestamps are strings', () => {
    expect(ok(store, { ...validOrder, placed_on: '2026-09-13' })).toBe(true);
    expect(issues(store, { ...validOrder, placed_on: 20260913 })).toEqual([
      { code: 'invalid_type', path: 'placed_on' },
    ]);
  });

  test('DR-DATE-FORMAT: a date names a real day, a timestamp is ISO 8601 or PostgreSQL text', () => {
    expect(ok(store, { ...validOrder, placed_on: '2024-02-29' })).toBe(true);
    for (const placed_on of [
      '2026-02-30',
      '0000-01-01',
      'yesterday',
      '13/09/2026',
      '2026-09-13T00:00',
    ]) {
      expect(issues(store, { ...validOrder, placed_on })).toEqual([
        { code: 'custom', path: 'placed_on' },
      ]);
    }
    const index = defaultRules(shop.orders, builtin('index'));
    expect(ok(index, { created_at: '2026-09-13 12:48:14.595' })).toBe(true);
    expect(ok(index, { created_at: '2026-09-13T12:48:14Z' })).toBe(true);
    expect(issues(index, { created_at: 'now' })).toEqual([{ code: 'custom', path: 'created_at' }]);
  });

  test('DR-DOUBLE-UNBOUNDED: double precision takes any number, keeping null and optional', () => {
    const additionStore = defaultRules(addition.addition_results, builtin('store'));
    expect(ok(additionStore, { result: 1e20 })).toBe(true);
    expect(ok(additionStore, { result: null })).toBe(true);
    expect(ok(additionStore, {})).toBe(true);
    expect(issues(additionStore, { result: 'x' })).toEqual([
      { code: 'invalid_type', path: 'result' },
    ]);
  });
});

describe('update rules', () => {
  test('DR-UPDATE-PARTIAL: every store rule becomes optional, and unknown keys stay rejected', () => {
    const update = defaultRules(shop.orders, builtin('update'));
    expect(ok(update, {})).toBe(true);
    expect(ok(update, { quantity: 2 })).toBe(true);
    expect(issues(update, { id: 1 })).toEqual(unknownKeys);
    expect(issues(update, { quantity: 'x' })).toEqual([{ code: 'invalid_type', path: 'quantity' }]);
  });
});

describe('index rules', () => {
  const index = defaultRules(shop.orders, builtin('index'));

  test('DR-INDEX-PAGE: page is a positive integer parsed from the query string', () => {
    expect(index.parse({ page: '2' })).toEqual({ page: 2 });
    expect(ok(index, { page: '0' })).toBe(false);
    expect(ok(index, { page: 'x' })).toBe(false);
  });

  test('DR-INDEX-PER-PAGE: per_page is capped by maxPerPage (100 unless the app sets it)', () => {
    expect(index.parse({ per_page: '100' })).toEqual({ per_page: 100 });
    expect(ok(index, { per_page: '101' })).toBe(false);
    expect(
      ok(defaultRules(shop.orders, builtin('index'), { maxPerPage: 20 }), { per_page: '21' }),
    ).toBe(false);
  });

  test('DR-INDEX-FILTER: key and indexed columns filter by exact value', () => {
    expect(Object.keys(index.shape)).toEqual([
      'page',
      'per_page',
      'sort',
      'id',
      'user_id',
      'status',
      'public_id',
      'created_at',
    ]);
    expect(index.parse({ user_id: '42', status: 'paid' })).toEqual({
      user_id: '42',
      status: 'paid',
    });
  });

  test('DR-INDEX-SORT: the same columns sort ascending, or descending with a minus', () => {
    expect(index.parse({ sort: '-created_at' })).toEqual({ sort: '-created_at' });
    expect(ok(index, { sort: 'total' })).toBe(false);
  });

  test('DR-INDEX-STRICT: other query parameters are rejected', () => {
    expect(issues(index, { total: '1' })).toEqual(unknownKeys);
  });

  test('DR-INDEX-HIDDEN: hidden columns are neither filterable nor sortable', () => {
    const users = defaultRules(shop.users, builtin('index'), { hidden: ['email'] });
    expect(issues(users, { email: 'a@b.c' })).toEqual(unknownKeys);
    expect(ok(users, { sort: 'email' })).toBe(false);
    expect(ok(defaultRules(shop.users, builtin('index')), { email: 'a@b.c' })).toBe(true);
  });

  test('DR-INDEX-TRASHED: ?trashed is opt-in, and only on soft-delete tables', () => {
    expect(ok(index, { trashed: 'with' })).toBe(false);
    const withTrashed = defaultRules(shop.orders, builtin('index'), { trashed: true });
    expect(withTrashed.parse({ trashed: 'only' })).toEqual({ trashed: 'only' });
    expect(
      ok(defaultRules(shop.users, builtin('index'), { trashed: true }), { trashed: 'with' }),
    ).toBe(false);
  });
});

describe('actions without a body', () => {
  test('DR-MEMBER-EMPTY: show, destroy and restore accept only an empty object', () => {
    for (const name of ['show', 'destroy', 'restore']) {
      const rules = defaultRules(shop.orders, builtin(name));
      expect(ok(rules, {})).toBe(true);
      expect(issues(rules, { note: 'x' })).toEqual(unknownKeys);
    }
  });

  test("DR-INCLUDE: index and show take ?include=, the comma-separated names of the blend's includes", () => {
    const options = { includes: ['user'] };
    const index = defaultRules(shop.orders, builtin('index'), options);
    expect(index.parse({ include: 'user,user' })).toEqual({ include: ['user'] });
    expect(issues(index, { include: 'customer' })).toEqual([{ code: 'custom', path: 'include' }]);
    const show = defaultRules(shop.orders, builtin('show'), options);
    expect(show.parse({ include: 'user' })).toEqual({ include: ['user'] });
    expect(show.parse({})).toEqual({});
    // Without includes, include is an unknown key, as any other is.
    const plain = defaultRules(shop.orders, builtin('show'));
    expect(issues(plain, { include: 'user' })).toEqual(unknownKeys);
  });

  test('DR-CUSTOM-EMPTY: custom actions start from an empty object', () => {
    const refund = defaultRules(shop.orders, { name: 'refund', builtin: false });
    expect(ok(refund, {})).toBe(true);
    expect(issues(refund, { reason: 'x' })).toEqual(unknownKeys);
  });
});

describe('replies', () => {
  test('DR-RECORD-PUBLIC: every column minus the hidden ones, with doubles unbounded', () => {
    const user = recordSchema(shop.users, ['password']);
    expect(Object.keys(user.shape).sort()).toEqual([
      'created_at',
      'display_name',
      'email',
      'id',
      'is_active',
      'updated_at',
    ]);
    const result = recordSchema(addition.addition_results);
    const row = { id: 1, created_at: null, updated_at: null, deleted_at: null };
    expect(ok(result, { ...row, result: 1e20 })).toBe(true);
    expect(ok(result, { ...row, result: null })).toBe(true);
  });
});
