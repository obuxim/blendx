/**
 * Types of the default validation rules per action. P4.1 builds the matching schemas
 * at runtime; hooks receive them as `prev` (docs/decisions.md D3, D12).
 */
import type { BuildSchema } from 'drizzle-zod';
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

/** Actions without a body (index, show, destroy, restore) and custom actions start empty. */
export type EmptyRules = z.ZodObject<Record<never, never>, z.core.$strict>;

export type DefaultRules<M extends Model, Action extends string> = Action extends 'store'
  ? StoreRules<M>
  : Action extends 'update'
    ? UpdateRules<M>
    : EmptyRules;

/**
 * When `rules` is omitted, TS falls back to the type parameter's constraint instead of
 * a generic default (docs/decisions.md D12), so swap in the action's defaults here.
 */
export type ResolvedRules<S, Defaults> = z.ZodType extends S ? Defaults : S;
