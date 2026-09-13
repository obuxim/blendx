import { describe, expect, test } from 'bun:test';
import { DbmlError, parseDbml, type TableIR } from '@blendx/dbml';

const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

const tableNamed = (tables: TableIR[], name: string) => {
  const table = tables.find((t) => t.name === name);
  if (!table) throw new Error(`no table ${name}`);
  return table;
};

const columnNamed = (table: TableIR, name: string) => table.columns.find((c) => c.name === name);

describe('parseDbml', () => {
  test('addition fixture becomes the IR the rest of blendx reads', async () => {
    const timestamp = { kind: 'timestamp', withTimezone: false } as const;
    const nullableTimestamp = (name: string, line: number) => ({
      name,
      type: timestamp,
      nullable: true,
      increment: false,
      unique: false,
      loc: { line, column: 3 },
    });

    expect(await parseDbml(await fixture('addition.dbml'))).toEqual({
      enums: [],
      tables: [
        {
          name: 'addition_results',
          columns: [
            {
              name: 'id',
              type: { kind: 'integer' },
              nullable: false,
              increment: true,
              unique: false,
              loc: { line: 2, column: 3 },
            },
            {
              name: 'result',
              type: { kind: 'double' },
              nullable: true,
              increment: false,
              unique: false,
              loc: { line: 3, column: 3 },
            },
            nullableTimestamp('created_at', 4),
            nullableTimestamp('updated_at', 5),
            nullableTimestamp('deleted_at', 6),
          ],
          primaryKey: ['id'],
          indexes: [],
          foreignKeys: [],
          loc: { line: 1, column: 1 },
        },
      ],
    });
  });

  test('kitchen-sink fixture: types, defaults, keys, indexes, refs, enums', async () => {
    const { tables, enums } = await parseDbml(await fixture('kitchen-sink.dbml'));
    const users = tableNamed(tables, 'users');
    const orders = tableNamed(tables, 'orders');
    const orderItems = tableNamed(tables, 'order_items');

    expect(enums).toEqual([
      {
        name: 'order_status',
        values: ['pending', 'paid', 'refunded'],
        loc: { line: 3, column: 1 },
      },
    ]);

    expect(columnNamed(users, 'email')).toMatchObject({
      type: { kind: 'varchar', length: 255 },
      nullable: false,
      unique: true,
    });
    expect(columnNamed(users, 'is_active')?.default).toEqual({ kind: 'literal', value: true });
    expect(columnNamed(users, 'created_at')).toMatchObject({
      type: { kind: 'timestamp', withTimezone: true },
      default: { kind: 'expression', sql: 'now()' },
    });
    expect(columnNamed(users, 'password')?.note).toBe('hidden in blends, not in DBML');

    expect(columnNamed(orders, 'id')).toMatchObject({ type: { kind: 'bigint' }, increment: true });
    expect(columnNamed(orders, 'status')).toMatchObject({
      type: { kind: 'enum', name: 'order_status' },
      default: { kind: 'literal', value: 'pending' },
    });
    expect(columnNamed(orders, 'total')?.type).toEqual({
      kind: 'numeric',
      precision: 10,
      scale: 2,
    });
    expect(columnNamed(orders, 'quantity')?.default).toEqual({ kind: 'literal', value: 1 });
    expect(columnNamed(orders, 'tags')?.type).toEqual({ kind: 'array', of: { kind: 'text' } });
    expect(columnNamed(orders, 'public_id')).toMatchObject({
      type: { kind: 'uuid' },
      unique: true,
      default: { kind: 'expression', sql: 'gen_random_uuid()' },
    });
    expect(orders.note).toBe('Kitchen-sink table for parser coverage');
    expect(orders.foreignKeys).toEqual([
      { columns: ['user_id'], references: { table: 'users', columns: ['id'] } },
    ]);
    expect(orders.indexes).toEqual([
      { name: 'orders_user_status_idx', columns: ['user_id', 'status'], unique: false },
      { columns: ['created_at'], unique: false },
    ]);

    expect(orderItems.primaryKey).toEqual(['order_id', 'line']);
    expect(orderItems.indexes).toEqual([]);
    expect(orderItems.foreignKeys).toEqual([
      {
        columns: ['order_id'],
        references: { table: 'orders', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'no action',
      },
    ]);

    expect({ tables, enums }).toMatchSnapshot();
  });

  test('syntax errors become a DbmlError with line and column', async () => {
    const error = await parseDbml('Table broken {\n  id int [pk\n}').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbmlError);
    expect((error as DbmlError).diagnostics).toEqual([
      { message: 'expected "," or "]" but found "}"', line: 3, column: 1 },
    ]);
    expect((error as DbmlError).message).toBe('schema.dbml:3:1 expected "," or "]" but found "}"');
  });
});
