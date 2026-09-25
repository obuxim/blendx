import { expect, test } from 'bun:test';
import { dataMigration } from '../src/data-migration.ts';

test('dataMigration accepts a versioned lower_snake_case ID and freezes its declaration', () => {
  const up = () => {};
  const migration = dataMigration({ id: '20260925_backfill_workspaces', up });
  expect(migration).toEqual({
    kind: 'blendx/data-migration',
    id: '20260925_backfill_workspaces',
    up,
  });
  expect(Object.isFrozen(migration)).toBe(true);
});

test('dataMigration rejects invalid IDs and missing up functions', () => {
  expect(() => dataMigration({ id: 'backfill_workspaces', up() {} })).toThrow(
    'data migration id must be a versioned lower_snake_case string',
  );
  expect(() =>
    dataMigration({ id: '20260925_backfill_workspaces', up: undefined as never }),
  ).toThrow('data migration 20260925_backfill_workspaces needs an up function');
});
