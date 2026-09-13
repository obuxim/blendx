/** P11.1: matching a response against a case (packages/spec/conformance.md). */
import { describe, expect, test } from 'bun:test';
import { matchBody, matchHeaders } from '../src/match.ts';

describe('matchBody', () => {
  test('objects match on the keys the case names; other keys may be present', () => {
    expect(matchBody({ id: 1 }, { id: 1, result: 7 })).toEqual([]);
    expect(matchBody({ id: 1, result: 8 }, { id: 1, result: 7 })).toEqual([
      '/result: expected 8, got 7',
    ]);
  });

  test('arrays match element by element, in order, at the same length', () => {
    expect(matchBody([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }])).toEqual([]);
    expect(matchBody([{ id: 1 }], [{ id: 1 }, { id: 2 }])).toEqual([
      '(body): expected 1 items, got 2',
    ]);
    expect(matchBody({ data: [{ id: 2 }] }, { data: [{ id: 1 }] })).toEqual([
      '/data/0/id: expected 2, got 1',
    ]);
  });

  test('$any, $int, $timestamp and $absent', () => {
    const row = { id: 3, note: null, created_at: '2026-09-13 04:35:38.784' };
    expect(
      matchBody({ id: '$int', note: '$any', created_at: '$timestamp', password: '$absent' }, row),
    ).toEqual([]);
    expect(
      matchBody(
        { id: '$int', missing: '$any', created_at: '$timestamp', note: '$absent' },
        { id: 1.5, created_at: 'yesterday', note: null },
      ),
    ).toEqual([
      '/id: expected an integer, got 1.5',
      '/missing: expected a value, got nothing',
      '/created_at: expected a timestamp, got "yesterday"',
      '/note: expected nothing, got null',
    ]);
  });

  test('$timestamp takes the PostgreSQL text form, or T with an offset', () => {
    for (const value of [
      '2026-09-13 04:35:38',
      '2026-09-13 04:35:38.784+00',
      '2026-09-13T04:35:38Z',
      '2026-09-13T04:35:38.1+05:30',
    ]) {
      expect(matchBody('$timestamp', value)).toEqual([]);
    }
    expect(matchBody('$timestamp', '2026-09-13')).toHaveLength(1);
  });

  test('$$ writes a literal dollar string; an unknown matcher is reported', () => {
    expect(matchBody({ price: '$$5' }, { price: '$5' })).toEqual([]);
    expect(matchBody({ price: '$$5' }, { price: '5' })).toEqual(['/price: expected "$5", got "5"']);
    expect(matchBody({ id: '$number' }, { id: 1 })).toEqual([
      '/id: unknown matcher $number; use $any, $int, $timestamp or $absent',
    ]);
  });

  test('a body of $absent means no body at all', () => {
    expect(matchBody('$absent', undefined)).toEqual([]);
    expect(matchBody('$absent', { id: 1 })).toEqual(['(body): expected nothing, got {"id":1}']);
  });

  test('pointers escape ~ and / in keys (RFC 6901)', () => {
    expect(matchBody({ 'a/b': { '~c': 1 } }, { 'a/b': { '~c': 2 } })).toEqual([
      '/a~1b/~0c: expected 1, got 2',
    ]);
  });
});

describe('matchHeaders', () => {
  test('names ignore case; content-type parameters are ignored', () => {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=UTF-8' });
    expect(matchHeaders({ 'content-type': 'application/json' }, headers)).toEqual([]);
    expect(matchHeaders({ 'content-type': 'application/problem+json' }, headers)).toEqual([
      'content-type: expected "application/problem+json", got "application/json; charset=UTF-8"',
    ]);
    expect(matchHeaders({ location: '/orders/1' }, headers)).toEqual([
      'location: expected "/orders/1", got nothing',
    ]);
  });
});
