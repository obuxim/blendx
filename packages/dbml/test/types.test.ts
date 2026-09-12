import { describe, expect, test } from 'bun:test';
import { type ColumnType, DbmlError, mapColumnType, parseDbml } from '@blendx/dbml';

const smallint = { kind: 'smallint' } as const;
const integer = { kind: 'integer' } as const;
const bigint = { kind: 'bigint' } as const;
const real = { kind: 'real' } as const;
const double = { kind: 'double' } as const;
const timestamp = { kind: 'timestamp', withTimezone: false } as const;
const timestamptz = { kind: 'timestamp', withTimezone: true } as const;

const supported: { name: string; type: ColumnType; increment?: boolean }[] = [
  { name: 'smallint', type: smallint },
  { name: 'int2', type: smallint },
  { name: 'int', type: integer },
  { name: 'integer', type: integer },
  { name: 'int4', type: integer },
  { name: 'bigint', type: bigint },
  { name: 'int8', type: bigint },
  { name: 'smallserial', type: smallint, increment: true },
  { name: 'serial2', type: smallint, increment: true },
  { name: 'serial', type: integer, increment: true },
  { name: 'serial4', type: integer, increment: true },
  { name: 'bigserial', type: bigint, increment: true },
  { name: 'serial8', type: bigint, increment: true },
  { name: 'real', type: real },
  { name: 'float4', type: real },
  { name: 'double', type: double },
  { name: 'double precision', type: double },
  { name: 'float8', type: double },
  { name: 'float', type: double },
  { name: 'numeric', type: { kind: 'numeric' } },
  { name: 'numeric(10)', type: { kind: 'numeric', precision: 10 } },
  { name: 'numeric(10,2)', type: { kind: 'numeric', precision: 10, scale: 2 } },
  { name: 'decimal(12, 4)', type: { kind: 'numeric', precision: 12, scale: 4 } },
  { name: 'varchar', type: { kind: 'varchar' } },
  { name: 'varchar(255)', type: { kind: 'varchar', length: 255 } },
  { name: 'VARCHAR(10)', type: { kind: 'varchar', length: 10 } },
  { name: 'character varying(80)', type: { kind: 'varchar', length: 80 } },
  { name: 'char(2)', type: { kind: 'char', length: 2 } },
  { name: 'character', type: { kind: 'char' } },
  { name: 'text', type: { kind: 'text' } },
  { name: 'boolean', type: { kind: 'boolean' } },
  { name: 'bool', type: { kind: 'boolean' } },
  { name: 'uuid', type: { kind: 'uuid' } },
  { name: 'json', type: { kind: 'json' } },
  { name: 'jsonb', type: { kind: 'jsonb' } },
  { name: 'date', type: { kind: 'date' } },
  { name: 'time', type: { kind: 'time' } },
  { name: 'time without time zone', type: { kind: 'time' } },
  { name: 'timestamp', type: timestamp },
  { name: 'timestamp(3)', type: timestamp },
  { name: 'timestamp without time zone', type: timestamp },
  { name: 'timestamptz', type: timestamptz },
  { name: 'timestamp with time zone', type: timestamptz },
  { name: 'text[]', type: { kind: 'array', of: { kind: 'text' } } },
  { name: 'int[][]', type: { kind: 'array', of: { kind: 'array', of: integer } } },
];

const unsupported = [
  '',
  'geometry',
  'money',
  'bytea',
  'interval',
  'timetz',
  'int(11)',
  'varchar(10,2)',
  'varchar(-1)',
  'numeric(1,2,3)',
  'timestamp(3,4)',
  'serial[]',
];

describe('mapColumnType', () => {
  for (const { name, type, increment = false } of supported) {
    test(`maps ${JSON.stringify(name)}`, () => {
      expect(mapColumnType(name)).toEqual({ type, increment });
    });
  }

  for (const name of unsupported) {
    test(`rejects ${JSON.stringify(name)}`, () => {
      expect(mapColumnType(name)).toBeUndefined();
    });
  }

  test('enum names are matched exactly, including arrays of an enum', () => {
    const enums = new Set(['order_status']);
    expect(mapColumnType('order_status', enums)).toEqual({
      type: { kind: 'enum', name: 'order_status' },
      increment: false,
    });
    expect(mapColumnType('order_status[]', enums)).toEqual({
      type: { kind: 'array', of: { kind: 'enum', name: 'order_status' } },
      increment: false,
    });
    expect(mapColumnType('Order_Status', enums)).toBeUndefined();
  });
});

describe('parseDbml with unsupported types', () => {
  test('reports every unsupported column at once, each with its location', async () => {
    const source = 'Table shapes {\n  id int [pk]\n  outline geometry\n  price money\n}\n';
    const error = await parseDbml(source).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbmlError);
    expect((error as DbmlError).diagnostics).toEqual([
      { message: 'unsupported column type "geometry" for shapes.outline', line: 3, column: 3 },
      { message: 'unsupported column type "money" for shapes.price', line: 4, column: 3 },
    ]);
  });

  test('serial columns become auto-increment identities', async () => {
    const { tables } = await parseDbml('Table t {\n  id serial [pk]\n}\n');
    expect(tables[0]?.columns[0]).toMatchObject({
      type: integer,
      increment: true,
      nullable: false,
    });
  });
});
