/**
 * A model's belongs-to relations (D28): each single-column foreign key whose column ends in
 * `_id`, named by the column without it. `?include=<name>` nests the row it points to.
 */
import type { Model } from './model.ts';

export interface BelongsTo {
  /** The foreign key column: `user_id`. */
  readonly column: string;
  /** The table it points to: `users`. */
  readonly table: string;
  /** The column it points to there, its primary key: `id`. */
  readonly key: string;
}

/** A model's single-column foreign keys, in the order of its constraints. */
export function foreignKeysOf(model: Model): BelongsTo[] {
  const keys: BelongsTo[] = [];
  for (const constraint of Object.values(model.meta.constraints)) {
    const [column, ...more] = constraint.columns;
    const table = constraint.references?.table;
    const [key, ...others] = constraint.references?.columns ?? [];
    if (constraint.kind !== 'foreignKey' || !column || !table || !key) continue;
    if (more.length > 0 || others.length > 0) continue;
    keys.push({ column, table, key });
  }
  return keys;
}

/** The belongs-to relations of a model, by name, in the order of its constraints. */
export function relationsOf(model: Model): ReadonlyMap<string, BelongsTo> {
  const relations = new Map<string, BelongsTo>();
  for (const relation of foreignKeysOf(model)) {
    const { column } = relation;
    if (!column.endsWith('_id') || column === '_id') continue;
    relations.set(column.slice(0, -'_id'.length), relation);
  }
  return relations;
}

/**
 * The columns of a model that are single-column foreign keys to `table` (D31): the ways its
 * rows point at that table's rows, which a has-many include follows.
 */
export function foreignKeysTo(model: Model, table: string): string[] {
  return foreignKeysOf(model)
    .filter((key) => key.table === table)
    .map((key) => key.column);
}
