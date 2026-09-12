/**
 * Types over the generated `models` const in schema.gen.ts. A Model pairs a Drizzle
 * table with the conventions blendx derived from schema.dbml (packages/dbml).
 */
import type { InferInsertModel, InferSelectModel, Table } from 'drizzle-orm';

export type ConstraintKind = 'primaryKey' | 'unique' | 'foreignKey';

export interface ConstraintMeta {
  readonly kind: ConstraintKind;
  readonly columns: readonly string[];
  readonly references?: { readonly table: string; readonly columns: readonly string[] };
}

export interface ModelMeta {
  readonly primaryKey: string | null;
  readonly timestamps: { readonly createdAt: string | null; readonly updatedAt: string | null };
  readonly softDelete: string | null;
  /** Columns never accepted as input: identity keys and framework-filled timestamps. */
  readonly generated: readonly string[];
  /** Constraint name as Postgres reports it, to its kind and columns. */
  readonly constraints: { readonly [name: string]: ConstraintMeta };
}

export interface Model<T extends Table = Table> {
  readonly name: string;
  readonly table: T;
  readonly meta: ModelMeta;
}

/** A row as the database returns it (string-mode dates and numerics stay JSON-friendly). */
export type Row<M extends Model> = InferSelectModel<M['table']>;

/** Column names of a model. */
export type Column<M extends Model> = Extract<keyof Row<M>, string>;

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
