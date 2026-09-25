/**
 * Atomic replacement of a set of join rows. The caller owns the surrounding action
 * transaction; this helper only uses the supplied handle (D39).
 */
import { and, eq, getColumns, or } from 'drizzle-orm';
import { HttpProblem } from './engine.ts';
import type { Db } from './hooks.ts';
import type { Column, Model, Row } from './model.ts';
import { problem } from './problems.ts';

type PrimaryKeyColumn<M extends Model> = Extract<M['meta']['primaryKey'][number], Column<M>>;

/** A named model primary key, including every part of a composite key. */
export type RelationKey<M extends Model> = {
  readonly [K in PrimaryKeyColumn<M>]: Row<M>[K];
};

/** Maps destination-table columns to fields of a source model. */
export type RelationColumnMap<Destination extends Model, Source extends Model> = Readonly<
  Partial<Record<Column<Destination>, Column<Source>>>
>;

/** Maps destination-table columns to primary-key fields of a source model. */
export type RelationKeyColumnMap<Destination extends Model, Source extends Model> = Readonly<
  Partial<Record<Column<Destination>, PrimaryKeyColumn<Source>>>
>;

export interface ReplaceRelationOptions<
  Through extends Model,
  Owner extends Model,
  Target extends Model,
  Eligible extends Model,
> {
  readonly tx: Db;
  readonly through: Through;
  readonly owner: {
    readonly model: Owner;
    readonly key: RelationKey<Owner>;
    readonly columns: RelationKeyColumnMap<Through, Owner>;
  };
  readonly targets: {
    readonly model: Target;
    readonly keys: readonly RelationKey<Target>[];
    readonly columns: RelationKeyColumnMap<Through, Target>;
    /** JSON pointer to the requested target array. */
    readonly pointer: string;
  };
  readonly eligible: {
    readonly model: Eligible;
    /** Eligibility-table columns to fields read from the locked owner row. */
    readonly owner: RelationColumnMap<Eligible, Owner>;
    /** Eligibility-table columns to target primary-key fields. */
    readonly target: RelationKeyColumnMap<Eligible, Target>;
  };
}

/** A declaration is inconsistent with the generated models or required mappings. */
export class RelationWriteDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelationWriteDefinitionError';
  }
}

type UnknownRow = Record<string, unknown>;
type UnknownMap = Readonly<Record<string, string>>;

const columnsOf = (model: Model): Record<string, unknown> =>
  getColumns(model.table) as Record<string, unknown>;

const definition = (message: string): never => {
  throw new RelationWriteDefinitionError(message);
};

function requireColumns(model: Model, names: readonly string[], context: string) {
  const columns = columnsOf(model);
  for (const name of names) {
    if (!columns[name]) definition(`${context} "${name}" is not a column of ${model.name}`);
  }
  return columns;
}

function requireExactKey(model: Model, key: UnknownRow, context: string) {
  const expected = [...model.meta.primaryKey];
  if (expected.length === 0) definition(`${model.name} has no primary key`);
  const actual = Object.keys(key).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    definition(`${context} must contain exactly the primary-key columns of ${model.name}`);
  }
  requireColumns(model, expected, context);
}

function requireKeyMap(destination: Model, source: Model, mapping: UnknownMap, context: string) {
  const entries = Object.entries(mapping);
  requireColumns(
    destination,
    entries.map(([column]) => column),
    context,
  );
  const sourceKeys = [...source.meta.primaryKey];
  requireColumns(source, sourceKeys, context);
  const mapped = entries.map(([, key]) => key);
  for (const key of mapped) {
    if (!sourceKeys.includes(key)) {
      definition(`${context} "${key}" is not a primary-key column of ${source.name}`);
    }
  }
  if (mapped.length !== sourceKeys.length || new Set(mapped).size !== mapped.length) {
    definition(`${context} must map every primary-key column of ${source.name} exactly once`);
  }
  return entries;
}

function requireOwnerMap(destination: Model, owner: Model, mapping: UnknownMap, context: string) {
  if (Object.keys(mapping).length === 0) definition(`${context} must not be empty`);
  const entries = Object.entries(mapping);
  requireColumns(
    destination,
    entries.map(([column]) => column),
    context,
  );
  requireColumns(
    owner,
    entries.map(([, field]) => field),
    context,
  );
  return entries;
}

function keyToken(key: UnknownRow, columns: readonly string[]) {
  return JSON.stringify(columns.map((column) => key[column]));
}

function pointerFor(pointer: string, index: number, column: string) {
  return `${pointer.replace(/\/$/, '')}/${index}/${column}`;
}

function validationError(errors: { readonly pointer: string; readonly detail: string }[]): never {
  throw new HttpProblem(
    problem(422, {
      detail: 'The requested relation set did not pass validation.',
      errors,
    }),
  );
}

/**
 * Replaces all through rows for one owner after confirming every requested target belongs to
 * the declared eligibility root. It never starts, commits, or retries a transaction.
 */
export async function replaceRelation<
  Through extends Model,
  Owner extends Model,
  Target extends Model,
  Eligible extends Model,
>(options: ReplaceRelationOptions<Through, Owner, Target, Eligible>): Promise<void> {
  const { tx, through } = options;
  const owner = options.owner.model;
  const target = options.targets.model;
  const eligible = options.eligible.model;
  const ownerKey = options.owner.key as UnknownRow;
  const targetKeys = options.targets.keys as readonly UnknownRow[];
  const ownerPrimaryKey = [...owner.meta.primaryKey];
  const targetPrimaryKey = [...target.meta.primaryKey];

  requireExactKey(owner, ownerKey, 'owner.key');
  for (const [index, key] of targetKeys.entries()) {
    requireExactKey(target, key, `targets.keys[${index}]`);
  }
  const throughOwner = requireKeyMap(
    through,
    owner,
    options.owner.columns as UnknownMap,
    'owner.columns',
  );
  const throughTarget = requireKeyMap(
    through,
    target,
    options.targets.columns as UnknownMap,
    'targets.columns',
  );
  const ownerThroughColumns = new Set(throughOwner.map(([column]) => column));
  if (throughTarget.some(([column]) => ownerThroughColumns.has(column))) {
    definition('owner.columns and targets.columns must name different through-table columns');
  }
  const eligibleOwner = requireOwnerMap(
    eligible,
    owner,
    options.eligible.owner as UnknownMap,
    'eligible.owner',
  );
  const eligibleTarget = requireKeyMap(
    eligible,
    target,
    options.eligible.target as UnknownMap,
    'eligible.target',
  );

  const ownerColumns = columnsOf(owner);
  const ownerRows: unknown[] = await tx
    .select()
    .from(owner.table as never)
    .where(
      and(...ownerPrimaryKey.map((column) => eq(ownerColumns[column] as never, ownerKey[column]))),
    )
    .limit(1)
    .for('update');
  const ownerRow = ownerRows[0] as UnknownRow | undefined;
  if (!ownerRow) throw new HttpProblem(problem(404));

  const firstTargetKey = targetPrimaryKey[0] ?? definition(`${target.name} has no primary key`);
  const duplicateErrors: { pointer: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (const [index, key] of targetKeys.entries()) {
    const token = keyToken(key, targetPrimaryKey);
    if (seen.has(token)) {
      duplicateErrors.push({
        pointer: pointerFor(options.targets.pointer, index, firstTargetKey),
        detail: 'is a duplicate relation target',
      });
    }
    seen.add(token);
  }
  if (duplicateErrors.length > 0) validationError(duplicateErrors);

  if (targetKeys.length > 0) {
    const targetColumns = columnsOf(target);
    const foundRows: unknown[] = await tx
      .select()
      .from(target.table as never)
      .where(
        or(
          ...targetKeys.map((key) =>
            and(
              ...targetPrimaryKey.map((column) => eq(targetColumns[column] as never, key[column])),
            ),
          ),
        ),
      );
    const found = new Set(foundRows.map((row) => keyToken(row as UnknownRow, targetPrimaryKey)));

    const eligibleColumns = columnsOf(eligible);
    const eligibleRows: unknown[] = await tx
      .select()
      .from(eligible.table as never)
      .where(
        and(
          ...eligibleOwner.map(([column, field]) =>
            eq(eligibleColumns[column] as never, ownerRow[field]),
          ),
        ),
      );
    const eligibilityKeys = new Set(
      eligibleRows.map((row) => {
        const source = row as UnknownRow;
        const key = Object.fromEntries(
          eligibleTarget.map(([column, targetColumn]) => [targetColumn, source[column]]),
        );
        return keyToken(key, targetPrimaryKey);
      }),
    );
    const errors = targetKeys.flatMap((key, index) => {
      const token = keyToken(key, targetPrimaryKey);
      return found.has(token) && eligibilityKeys.has(token)
        ? []
        : [
            {
              pointer: pointerFor(options.targets.pointer, index, firstTargetKey),
              detail: 'is not an eligible relation target',
            },
          ];
    });
    if (errors.length > 0) validationError(errors);
  }

  const throughColumns = columnsOf(through);
  await tx
    .delete(through.table as never)
    .where(
      and(
        ...throughOwner.map(([column, key]) => eq(throughColumns[column] as never, ownerKey[key])),
      ),
    );
  if (targetKeys.length === 0) return;

  const rows = targetKeys.map((targetKey) =>
    Object.fromEntries([
      ...throughOwner.map(([column, key]) => [column, ownerKey[key]]),
      ...throughTarget.map(([column, key]) => [column, targetKey[key]]),
    ]),
  );
  await tx.insert(through.table as never).values(rows as never);
}
