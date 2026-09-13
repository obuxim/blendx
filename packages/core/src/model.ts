/**
 * Types over the generated `models` const in schema.gen.ts. A Model pairs a Drizzle
 * table with the conventions blendx derived from schema.dbml (packages/dbml).
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

export type ConstraintKind = 'primaryKey' | 'unique' | 'foreignKey';

export interface ConstraintMeta {
  readonly kind: ConstraintKind;
  readonly columns: readonly string[];
  readonly references?: { readonly table: string; readonly columns: readonly string[] };
}

export interface ModelMeta {
  /** The key's columns in its declared order: one, or several for a composite key (D33). */
  readonly primaryKey: readonly string[];
  readonly timestamps: { readonly createdAt: string | null; readonly updatedAt: string | null };
  readonly softDelete: string | null;
  /** Columns never accepted as input: identity keys and framework-filled timestamps. */
  readonly generated: readonly string[];
  /** Constraint name as Postgres reports it, to its kind and columns. */
  readonly constraints: { readonly [name: string]: ConstraintMeta };
}

export interface Model<T extends PgTable = PgTable> {
  readonly name: string;
  readonly table: T;
  readonly meta: ModelMeta;
}

/** A row as the database returns it (string-mode dates and numerics stay JSON-friendly). */
export type Row<M extends Model> = InferSelectModel<M['table']>;

/** Column names of a model. */
export type Column<M extends Model> = Extract<keyof Row<M>, string>;

/** A model's foreign keys, as schema.gen.ts records them. */
type ForeignKeyOf<M extends Model> = Extract<
  M['meta']['constraints'][keyof M['meta']['constraints']],
  { readonly kind: 'foreignKey' }
>;

type RelationNameOf<F> = F extends { readonly columns: readonly [`${infer Name}_id`] }
  ? Name
  : never;

/**
 * A model's belongs-to relations (D28): its single-column foreign keys whose column ends in
 * `_id`, named without it. A name that a column already has is not a relation.
 */
export type Relation<M extends Model> = Exclude<RelationNameOf<ForeignKeyOf<M>>, Column<M> | ''>;

type ColumnOfKey<F> = F extends { readonly columns: readonly [infer C extends string] } ? C : never;

/**
 * The columns of a model that are single-column foreign keys to the table named T (D31):
 * `ForeignKeysTo<order_notes, 'orders'>` is `'order_id'`. A has-many include follows one.
 */
export type ForeignKeysTo<M extends Model, T extends string> = ColumnOfKey<
  Extract<ForeignKeyOf<M>, { readonly references: { readonly table: T } }>
>;

/** The table a relation points to. */
export type RelationTable<M extends Model, R extends string> =
  Extract<ForeignKeyOf<M>, { readonly columns: readonly [`${R}_id`] }> extends {
    readonly references: { readonly table: infer T };
  }
    ? T
    : never;

/** A row as Drizzle accepts it on insert. */
export type Insert<M extends Model> = InferInsertModel<M['table']>;

/** Columns a request or `calculate` may set: every column except the generated ones. */
export type WritableColumn<M extends Model> = Exclude<Column<M>, M['meta']['generated'][number]>;

/** What `calculate` may return: any subset of the writable columns, with their insert types. */
export type Writes<M extends Model> = {
  [K in WritableColumn<M> & keyof Insert<M>]?: Insert<M>[K];
};

/** A row as responses expose it, with hidden columns removed. */
export type PublicRow<M extends Model, Hidden extends Column<M> = never> = Omit<Row<M>, Hidden>;

/** `true` when the model soft-deletes (it has a nullable deleted_at timestamp). */
export type SoftDeletes<M extends Model> = M['meta']['softDelete'] extends string ? true : false;
