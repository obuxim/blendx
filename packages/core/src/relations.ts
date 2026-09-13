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

/** The belongs-to relations of a model, by name, in the order of its constraints. */
export function relationsOf(model: Model): ReadonlyMap<string, BelongsTo> {
  const relations = new Map<string, BelongsTo>();
  for (const constraint of Object.values(model.meta.constraints)) {
    const [column, ...more] = constraint.columns;
    const table = constraint.references?.table;
    const [key, ...others] = constraint.references?.columns ?? [];
    if (constraint.kind !== 'foreignKey' || !column || !table || !key) continue;
    if (more.length > 0 || others.length > 0 || !column.endsWith('_id') || column === '_id') {
      continue;
    }
    relations.set(column.slice(0, -'_id'.length), { column, table, key });
  }
  return relations;
}
