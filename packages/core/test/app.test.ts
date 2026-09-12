import { describe, expect, expectTypeOf, test } from 'bun:test';
import { BlendxConfigError, defineApp, type RegisteredAuth } from '@blendx/core';

describe('defineApp', () => {
  test('defaults to 25 rows per page and at most 100', () => {
    const app = defineApp({});
    expect(app.kind).toBe('blendx/app');
    expect(app.index).toEqual({ perPage: 25, maxPerPage: 100 });
  });

  test('custom index limits', () => {
    expect(defineApp({ index: { perPage: 50, maxPerPage: 200 } }).index).toEqual({
      perPage: 50,
      maxPerPage: 200,
    });
  });

  test('rejects index limits that make no sense', () => {
    expect(() => defineApp({ index: { perPage: 0 } })).toThrow(
      new BlendxConfigError('index.perPage and index.maxPerPage must be positive integers'),
    );
    expect(() => defineApp({ index: { perPage: 200 } })).toThrow(
      new BlendxConfigError('index.perPage (200) is larger than index.maxPerPage (100)'),
    );
  });

  test('keeps the spec as written, including auth', () => {
    const auth = async () => ({ id: 1 });
    expect(defineApp({ auth }).spec.auth).toBe(auth);
  });

  test('app hooks must keep the type they receive', () => {
    const typeOnly = () => {
      defineApp({
        hooks: {
          rules: ({ prev }) => prev,
          respond: ({ prev }) => ({ ...prev, headers: { 'x-api-version': '1' } }),
        },
      });
      defineApp({
        hooks: {
          // @ts-expect-error an app hook runs for every table, so it cannot change the reply type
          respond: () => ({ status: 200, body: {} }),
        },
      });
    };
    expect(typeOnly).toBeFunction();
  });

  test('without a registered app, auth is unknown', () => {
    expectTypeOf<RegisteredAuth>().toEqualTypeOf<unknown>();
  });
});
