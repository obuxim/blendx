/**
 * Stage hooks and their contexts (docs/decisions.md D3). Value stages (rules,
 * authorize, calculate, respond) receive `prev` and return its replacement. Effect
 * stages (load, save) receive `runDefault()`: call it to extend, skip it to replace.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { Model, PublicRow, Row, Writes } from './model.ts';
import type { DefaultRules, ResolvedRules } from './rules.ts';

/** A Drizzle Postgres database or transaction handle. */
export type Db = PgDatabase<PgQueryResultHKT>;

export interface Reply<Status extends number = number, Body = unknown> {
  readonly status: Status;
  readonly body: Body;
  readonly headers?: Readonly<Record<string, string>>;
  /** Describes `body` for OpenAPI when respond replaces the default reply. */
  readonly schema?: z.ZodType;
}

/** When respond is omitted, R falls back to its constraint; use the default reply then. */
export type ResolvedReply<R, Default> = Reply extends R ? Default : R;

/** The validated input of an action, from its resolved rules. */
export type Input<M extends Model, Action extends string, S> = z.output<
  ResolvedRules<S, DefaultRules<M, Action>>
>;

export interface LoadContext<Rec> {
  /** Runs the default load (findOrFail for member actions). */
  runDefault: () => Promise<Rec>;
  db: Db;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  auth: unknown;
}

export interface AuthorizeContext<Action extends string, In, Rec> {
  /** What the resource policy decided. */
  prev: boolean;
  auth: unknown;
  record: Rec;
  input: In;
  action: Action;
}

/** Pure and synchronous: no database, no request. */
export interface CalculateContext<M extends Model, In, Rec> {
  /** The default writes: the validated input's writable columns. */
  prev: Writes<M>;
  input: In;
  record: Rec;
}

export interface SaveContext<M extends Model, Rec> {
  /** Runs the default save (insert, update, delete or restore), optionally with other writes. */
  runDefault: (writes?: Writes<M>) => Promise<Row<M>>;
  /** The transaction the action runs in. */
  tx: Db;
  writes: Writes<M>;
  record: Rec;
  auth: unknown;
}

export interface RespondContext<Default, Out, Result> {
  prev: Default;
  /** The saved or loaded record, hidden columns removed. */
  record: Out;
  /** What calculate returned. */
  result: Result;
}

interface ValueHooks<
  M extends Model,
  Action extends string,
  S extends z.ZodType,
  Rec,
  Result,
  Default,
  Out,
  R,
> {
  /** Receives the action's default rules and returns the rules to validate with. */
  rules?: (context: { prev: DefaultRules<M, Action> }) => S;
  authorize?: (
    context: AuthorizeContext<Action, Input<M, Action, S>, Rec>,
  ) => boolean | Promise<boolean>;
  calculate?: (context: CalculateContext<M, Input<M, Action, S>, Rec>) => Result;
  respond?: (context: RespondContext<Default, Out, Result>) => R;
}

interface LoadHook<Rec> {
  load?: (context: LoadContext<Rec>) => Promise<Rec>;
}

interface SaveHook<M extends Model, Rec> {
  save?: (context: SaveContext<M, Rec>) => Promise<Row<M>>;
}

export interface RouteOptions {
  /** Defaults to 'post'. */
  method?: 'get' | 'post' | 'patch' | 'delete';
  /** Path segment; defaults to the action name. */
  path?: string;
}

type RecordReply<M extends Model, Hidden extends string, Status extends number> = Reply<
  Status,
  PublicRow<M, Extract<Hidden, keyof Row<M>>>
>;

export type StoreSpec<M extends Model, S extends z.ZodType, R, Hidden extends string> = ValueHooks<
  M,
  'store',
  S,
  undefined,
  Writes<M>,
  RecordReply<M, Hidden, 201>,
  PublicRow<M, Extract<Hidden, keyof Row<M>>>,
  R
> &
  SaveHook<M, undefined>;

export type UpdateSpec<M extends Model, S extends z.ZodType, R, Hidden extends string> = ValueHooks<
  M,
  'update',
  S,
  Row<M>,
  Writes<M>,
  RecordReply<M, Hidden, 200>,
  PublicRow<M, Extract<Hidden, keyof Row<M>>>,
  R
> &
  LoadHook<Row<M>> &
  SaveHook<M, Row<M>>;

/** show, destroy and restore take no input, so they have no rules or calculate. */
export type RecordSpec<
  M extends Model,
  Action extends string,
  R,
  Default,
  Hidden extends string = never,
> = Pick<
  ValueHooks<
    M,
    Action,
    z.ZodType,
    Row<M>,
    Writes<M>,
    Default,
    PublicRow<M, Extract<Hidden, keyof Row<M>>>,
    R
  >,
  'authorize' | 'respond'
> &
  LoadHook<Row<M>> &
  (Action extends 'show' ? unknown : SaveHook<M, Row<M>>);

export type MemberSpec<
  M extends Model,
  Name extends string,
  S extends z.ZodType,
  R,
  Hidden extends string,
> = ValueHooks<
  M,
  Name,
  S,
  Row<M>,
  Writes<M>,
  RecordReply<M, Hidden, 200>,
  PublicRow<M, Extract<Hidden, keyof Row<M>>>,
  R
> &
  LoadHook<Row<M>> &
  SaveHook<M, Row<M>> &
  RouteOptions;

/** Collection actions load nothing and save nothing: calculate's result is the reply body. */
export type CollectionSpec<
  M extends Model,
  Name extends string,
  S extends z.ZodType,
  Result,
  R,
> = ValueHooks<M, Name, S, undefined, Result, Reply<200, Result>, undefined, R> & RouteOptions;
