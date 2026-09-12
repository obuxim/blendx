import type { ColumnType } from './ir.ts';

export interface MappedType {
  type: ColumnType;
  /** Serial types imply an auto-increment identity. */
  increment: boolean;
}

const SIMPLE: Record<string, ColumnType> = {
  smallint: { kind: 'smallint' },
  int2: { kind: 'smallint' },
  int: { kind: 'integer' },
  integer: { kind: 'integer' },
  int4: { kind: 'integer' },
  bigint: { kind: 'bigint' },
  int8: { kind: 'bigint' },
  real: { kind: 'real' },
  float4: { kind: 'real' },
  double: { kind: 'double' },
  'double precision': { kind: 'double' },
  float8: { kind: 'double' },
  float: { kind: 'double' },
  text: { kind: 'text' },
  boolean: { kind: 'boolean' },
  bool: { kind: 'boolean' },
  uuid: { kind: 'uuid' },
  json: { kind: 'json' },
  jsonb: { kind: 'jsonb' },
  date: { kind: 'date' },
  time: { kind: 'time' },
  'time without time zone': { kind: 'time' },
};

const SERIAL: Record<string, ColumnType> = {
  smallserial: { kind: 'smallint' },
  serial2: { kind: 'smallint' },
  serial: { kind: 'integer' },
  serial4: { kind: 'integer' },
  bigserial: { kind: 'bigint' },
  serial8: { kind: 'bigint' },
};

const TIMESTAMP: Record<string, boolean> = {
  timestamp: false,
  'timestamp without time zone': false,
  timestamptz: true,
  'timestamp with time zone': true,
};

const TYPE_PATTERN = /^([A-Za-z_][A-Za-z0-9_ ]*?)\s*(?:\(([^)]*)\))?$/;

/** Parses `(a, b)` arguments; undefined when any argument is not a non-negative integer. */
function integerArgs(raw: string | undefined): number[] | undefined {
  if (raw === undefined) return [];
  const args = raw.split(',').map((part) => Number(part.trim()));
  return args.every((n) => Number.isInteger(n) && n >= 0) ? args : undefined;
}

/**
 * Maps a DBML column type name (verbatim from @dbml/core, arguments included) to the IR.
 * Returns undefined when blendx does not support the type; the caller reports it.
 */
export function mapColumnType(
  typeName: string,
  enums: ReadonlySet<string> = new Set(),
): MappedType | undefined {
  const name = typeName.trim();
  if (name.endsWith('[]')) {
    const element = mapColumnType(name.slice(0, -2), enums);
    if (!element || element.increment) return undefined;
    return { type: { kind: 'array', of: element.type }, increment: false };
  }

  const match = TYPE_PATTERN.exec(name);
  const rawBase = match?.[1];
  if (!rawBase) return undefined;
  if (enums.has(rawBase) && match[2] === undefined) {
    return { type: { kind: 'enum', name: rawBase }, increment: false };
  }

  const base = rawBase.toLowerCase().replace(/\s+/g, ' ');
  const args = integerArgs(match[2]);
  if (!args) return undefined;

  switch (base) {
    case 'varchar':
    case 'character varying':
    case 'char':
    case 'character': {
      if (args.length > 1) return undefined;
      const kind = base === 'varchar' || base === 'character varying' ? 'varchar' : 'char';
      const [length] = args;
      return { type: length === undefined ? { kind } : { kind, length }, increment: false };
    }
    case 'numeric':
    case 'decimal': {
      if (args.length > 2) return undefined;
      const [precision, scale] = args;
      return {
        type: {
          kind: 'numeric',
          ...(precision === undefined ? {} : { precision }),
          ...(scale === undefined ? {} : { scale }),
        },
        increment: false,
      };
    }
  }

  const withTimezone = TIMESTAMP[base];
  if (withTimezone !== undefined) {
    // timestamp(p): fractional-second precision is accepted and not modeled in v1.
    return args.length <= 1
      ? { type: { kind: 'timestamp', withTimezone }, increment: false }
      : undefined;
  }
  if (args.length > 0) return undefined;

  const simple = SIMPLE[base];
  if (simple) return { type: simple, increment: false };
  const serial = SERIAL[base];
  if (serial) return { type: serial, increment: true };
  return undefined;
}
