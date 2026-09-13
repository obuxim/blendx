/**
 * P15.2: the date and time forms blendx accepts as input (docs/decisions.md D23). The engine
 * uses them to find the field of a date or time error, which PostgreSQL does not name.
 */
import { describe, expect, test } from 'bun:test';
import { isDateText, isTimestampText } from '../src/datetime.ts';

describe('dates', () => {
  test('YYYY-MM-DD naming a real day', () => {
    for (const value of ['2026-09-01', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
      expect(isDateText(value)).toBe(true);
    }
  });

  test('refuses days that do not exist, and every other form', () => {
    for (const value of [
      '2026-02-29',
      '1900-02-29',
      '2026-02-30',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '0000-01-01',
      '2026-9-1',
      '20260901',
      '01/09/2026',
      'yesterday',
      '2026-09-01T00:00:00',
      ' 2026-09-01',
      '',
    ]) {
      expect(isDateText(value)).toBe(false);
    }
  });
});

describe('timestamps', () => {
  test('ISO 8601', () => {
    for (const value of [
      '2026-09-13T12:48:14.595Z',
      '2026-09-13T12:48:14Z',
      '2026-09-13T12:48Z',
      '2026-09-13T12:48:14+05:30',
      '2026-09-13T12:48:14-0800',
      '2026-09-13T12:48:14.1234567',
    ]) {
      expect(isTimestampText(value)).toBe(true);
    }
  });

  test('the text form PostgreSQL replies with', () => {
    for (const value of [
      '2026-09-13 12:48:14.595',
      '2026-09-13 12:48:14',
      '2026-09-13 12:48',
      '2026-09-13 18:48:14.595+06',
      '2026-09-13 12:48:14+05:30',
    ]) {
      expect(isTimestampText(value)).toBe(true);
    }
  });

  test('refuses impossible days and times, offsets PostgreSQL refuses, and other forms', () => {
    for (const value of [
      '2026-02-30 12:00',
      '2026-09-13 24:00',
      '2026-09-13 25:00',
      '2026-09-13 12:60',
      '2026-09-13 12:48:60',
      '2026-09-13 12:00+16',
      '2026-09-13 12:00+05:60',
      '2026-09-13',
      '2026-09-13T',
      '2026-09-13t12:48',
      '2026-09-13 12:48:14 +06',
      'now',
      '',
    ]) {
      expect(isTimestampText(value)).toBe(false);
    }
  });
});
