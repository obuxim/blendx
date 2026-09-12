import { describe, expect, test } from 'bun:test';
import { type ColumnIR, type ColumnType, deriveConventions, type TableIR } from '@blendx/dbml';

const col = (name: string, type: ColumnType, extra: Partial<ColumnIR> = {}): ColumnIR => ({
  name,
  type,
  nullable: true,
  increment: false,
  unique: false,
  ...extra,
});

const table = (name: string, columns: ColumnIR[], primaryKey: string[]): TableIR => ({
  name,
  columns,
  primaryKey,
  indexes: [],
  foreignKeys: [],
});

const ts = { kind: 'timestamp', withTimezone: false } as const;
const int = { kind: 'integer' } as const;

describe('deriveConventions', () => {
  test('addition_results: timestamps, soft delete, and the identity pk are generated', () => {
    const additionResults = table(
      'addition_results',
      [
        col('id', int, { nullable: false, increment: true }),
        col('result', { kind: 'double' }),
        col('created_at', ts),
        col('updated_at', ts),
        col('deleted_at', ts),
      ],
      ['id'],
    );
    expect(deriveConventions(additionResults)).toEqual({
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
      softDelete: { column: 'deleted_at' },
      generated: ['id', 'created_at', 'updated_at', 'deleted_at'],
    });
  });

  test('a natural primary key without a default is accepted as input', () => {
    const countries = table(
      'countries',
      [
        col('code', { kind: 'char', length: 2 }, { nullable: false }),
        col('name', { kind: 'text' }),
      ],
      ['code'],
    );
    expect(deriveConventions(countries)).toEqual({ timestamps: {}, generated: [] });
  });

  test('a primary key filled by an expression default is generated', () => {
    const tokens = table(
      'tokens',
      [
        col(
          'id',
          { kind: 'uuid' },
          {
            nullable: false,
            default: { kind: 'expression', sql: 'gen_random_uuid()' },
          },
        ),
      ],
      ['id'],
    );
    expect(deriveConventions(tokens).generated).toEqual(['id']);
  });

  test('deleted_at that is NOT NULL is an ordinary column, not soft delete', () => {
    const events = table(
      'events',
      [col('id', int, { increment: true }), col('deleted_at', ts, { nullable: false })],
      ['id'],
    );
    const conventions = deriveConventions(events);
    expect(conventions.softDelete).toBeUndefined();
    expect(conventions.generated).toEqual(['id']);
  });

  test('created_at that is not a timestamp is an ordinary column', () => {
    const notes = table(
      'notes',
      [col('id', int, { increment: true }), col('created_at', { kind: 'text' })],
      ['id'],
    );
    expect(deriveConventions(notes)).toEqual({ timestamps: {}, generated: ['id'] });
  });

  test('a composite primary key is never generated', () => {
    const orderItems = table(
      'order_items',
      [col('order_id', { kind: 'bigint' }), col('line', int, { increment: true })],
      ['order_id', 'line'],
    );
    expect(deriveConventions(orderItems).generated).toEqual([]);
  });
});
