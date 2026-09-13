/**
 * Types of the default validation rules per action. P4.1 builds the matching schemas
 * at runtime; hooks receive them as `prev` (docs/decisions.md D3, D12).
 */
import type { BuildSchema } from 'drizzle-orm/zod';
import type { z } from 'zod';
import type { Model } from './model.ts';

type Generated<M extends Model> = M['meta']['generated'][number];

type InsertShape<M extends Model> = BuildSchema<
  'insert',
  M['table']['_']['columns'],
  undefined,
  undefined
>['shape'];

type StoreShape<M extends Model> = Omit<InsertShape<M>, Generated<M>>;

/** store: the insert schema without generated columns, rejecting unknown keys. */
export type StoreRules<M extends Model> = z.ZodObject<StoreShape<M>, z.core.$strict>;

/** update: every store rule, made optional. */
export type UpdateRules<M extends Model> = z.ZodObject<
  {
    [K in keyof StoreShape<M>]: StoreShape<M>[K] extends z.ZodType
      ? z.ZodOptional<StoreShape<M>[K]>
      : never;
  },
  z.core.$strict
>;

/** show, destroy, restore and custom actions start from an empty object. */
export type EmptyRules = z.ZodObject<Record<never, never>, z.core.$strict>;

/** The parsed index query: pagination, sorting, opt-in trashed, includes, and column filters. */
export interface IndexQuery {
  page?: number;
  per_page?: number;
  /** A sortable column, or `-column` for descending. */
  sort?: string;
  trashed?: 'with' | 'only';
  /** The relations `?include=` names (D28). */
  include?: string[];
  [filter: string]: string | number | string[] | undefined;
}

/** show with includes (D28): only `?include=`, parsed into the names it lists. */
export type IncludeRules = z.ZodObject<
  { include: z.ZodOptional<z.ZodType<string[], string>> },
  z.core.$strict
>;

/** index: parses query-string values (strings) into an IndexQuery. */
export type IndexRules = z.ZodType<IndexQuery, Record<string, string | undefined>>;

export type DefaultRules<M extends Model, Action extends string> = Action extends 'store'
  ? StoreRules<M>
  : Action extends 'update'
    ? UpdateRules<M>
    : Action extends 'index'
      ? IndexRules
      : EmptyRules;

/**
 * When `rules` is omitted, TS falls back to the type parameter's constraint instead of
 * a generic default (docs/decisions.md D12), so swap in the action's defaults here.
 */
export type ResolvedRules<S, Defaults> = z.ZodType extends S ? Defaults : S;
