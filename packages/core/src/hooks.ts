/**
 * Stage hooks and their contexts (docs/decisions.md D3). Value stages (rules,
 * authorize, calculate, respond) receive `prev` and return its replacement. Effect
 * stages (load, save) receive `runDefault()`: call it to extend, skip it to replace. after
 * (D26) runs once a write has committed, at every level, and its return value is ignored;
 * later (D27) is the same, run from the outbox instead of the request.
 */
import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type { RegisteredAuth } from './app.ts';
import type { Model, PublicRow, Row, Writes } from './model.ts';
import type { DefaultRules, ResolvedRules } from './rules.ts';

/** A Drizzle Postgres database or transaction handle. */
export type Db = PgAsyncDatabase<PgQueryResultHKT>;

export interface Reply<Status extends number = number, Body = unknown> {
  readonly status: Status;
  readonly body: Body;
  readonly headers?: Readonly<Record<string, string>>;
}

/** When respond is omitted, R falls back to its constraint; use the default reply then. */
export type ResolvedReply<R, Default> = Reply extends R ? Default : R;

/**
 * `reply` on an action describes, for OpenAPI, a reply blendx cannot derive: a collection
 * action's calculate result, or what a respond hook builds (docs/decisions.md D14). The
 * body schema alone keeps the action's default status; `{ status, body }` sets another.
 */
export type ReplySchema = z.ZodType | { readonly status: number; readonly body: z.ZodType };

/** What blend() keeps of a declared reply: the body schema, and a status other than the default. */
export interface ReplyDeclaration {
  readonly status?: number;
  readonly schema: z.ZodType;
}

/** The schema describes the body exactly: every body fits it, and the keys are the same. */
type Describes<Schema, Body> = Schema extends z.ZodType
  ? [Body] extends [z.output<Schema>]
    ? [
        Exclude<keyof z.output<Schema>, keyof Body> | Exclude<keyof Body, keyof z.output<Schema>>,
      ] extends [never]
      ? true
      : false
    : false
  : false;

/** A property no schema has, so a failed check names its reason in the type error. */
interface ReplyError<Reason extends string> {
  readonly 'blendx reply error': Reason;
}

type NotDescribed = ReplyError<'the schema does not describe the reply body'>;

/**
 * `unknown` when X describes the actual reply (the default, or what respond returns), else
 * the reason it doesn't. Without `reply`, X falls back to its constraint (the ReplySchema
 * union), and there is nothing to check.
 */
export type ReplyCheck<X, Actual, Default> = ReplySchema extends X
  ? unknown
  : Actual extends Reply<infer Status, infer Body>
    ? [X] extends [{ readonly status: infer Declared; readonly body: infer Schema }]
      ? [Declared] extends [Status]
        ? Describes<Schema, Body> extends true
          ? unknown
          : NotDescribed
        : ReplyError<'status is not the status respond returns'>
      : Describes<X, Body> extends true
        ? Default extends Reply<Status>
          ? unknown
          : ReplyError<'respond returns another status; declare { status, body }'>
        : NotDescribed
    : unknown;

/**
 * Adds `reply` to an action spec; X is inferred from it alone. ReplyCheck runs on the
 * builder's return type, after inference: anywhere in the spec's type it would fix R and
 * Result (while TS works out the contextual types of respond and calculate) before they
 * are inferred.
 */
export type ReplyOption<X> = { reply?: X };

/** The validated input of an action, from its resolved rules. */
export type Input<M extends Model, Action extends string, S> = z.output<
  ResolvedRules<S, DefaultRules<M, Action>>
>;

export interface LoadContext<Rec> {
  /** Runs the default load (findOrFail for member actions, a page for index). */
  runDefault: () => Promise<Rec>;
  db: Db;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  /** The validated input (for index: the parsed query). */
  input: unknown;
  auth: RegisteredAuth | null;
  /** True when the action will write, inside a transaction: load the row FOR UPDATE. */
  lock: boolean;
}

export interface AuthorizeContext<Action extends string, In, Rec> {
  /** What the resource policy decided. */
  prev: boolean;
  auth: RegisteredAuth | null;
  record: Rec;
  input: In;
  action: Action;
}

/**
 * The default writes, typed from the input: the writable columns the rules accept. Typed as
 * all of Writes<M>, a calculate spreading it would claim, in the review, every column.
 */
export type InputWrites<M extends Model, In> = Pick<Writes<M>, Extract<keyof In, keyof Writes<M>>>;

/** Pure and synchronous: no database, no request. */
export interface CalculateContext<M extends Model, In, Rec> {
  /** The default writes: the validated input's writable columns. */
  prev: InputWrites<M, In>;
  input: In;
  record: Rec;
}

export interface SaveContext<M extends Model, Rec> {
  /** Runs the default save (insert, update, delete, restore or purge), optionally with other writes. */
  runDefault: (writes?: Writes<M>) => Promise<Row<M>>;
  /** The transaction the action runs in. */
  tx: Db;
  writes: Writes<M>;
  record: Rec;
  auth: RegisteredAuth | null;
}

export interface RespondContext<Default, Out, Result> {
  prev: Default;
  /** The saved or loaded record, hidden columns removed. */
  record: Out;
  /** What calculate returned. */
  result: Result;
}

/**
 * after runs once the write has committed, before respond (D26): an email, a webhook, a
 * message to another system. What it throws is reported, and the reply stands.
 */
export interface AfterContext<M extends Model, Rec, In> {
  /** The row as saved, hidden columns included: none of it goes back to the client. */
  saved: Row<M>;
  /** The row as loaded before the write; undefined for store. */
  record: Rec;
  input: In;
  auth: RegisteredAuth | null;
  /** The database, outside the committed transaction. Writes that must be atomic go in save. */
  db: Db;
}

/**
 * later runs from the outbox, outside the request, at least once (D27): an effect that must
 * not be lost. Its context was stored as JSON with the write; db is the worker's.
 */
export interface LaterContext<M extends Model, Rec, In> extends AfterContext<M, Rec, In> {
  /** The outbox entry's id: the same on every attempt, so an idempotency key. */
  id: number;
  /** 1 on the first run, 2 on the first retry, and so on. */
  attempt: number;
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

/** Only actions that write have them. Their results are ignored; a promise is awaited. */
interface CommitHooks<M extends Model, Rec, In> {
  after?: (context: AfterContext<M, Rec, In>) => unknown;
  later?: (context: LaterContext<M, Rec, In>) => unknown;
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
  SaveHook<M, undefined> &
  CommitHooks<M, undefined, Input<M, 'store', S>>;

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
  SaveHook<M, Row<M>> &
  CommitHooks<M, Row<M>, Input<M, 'update', S>>;

/** replace (D34): update's hooks, over the store rules without the key columns. */
export type ReplaceSpec<
  M extends Model,
  S extends z.ZodType,
  R,
  Hidden extends string,
> = ValueHooks<
  M,
  'replace',
  S,
  Row<M>,
  Writes<M>,
  RecordReply<M, Hidden, 200>,
  PublicRow<M, Extract<Hidden, keyof Row<M>>>,
  R
> &
  LoadHook<Row<M>> &
  SaveHook<M, Row<M>> &
  CommitHooks<M, Row<M>, Input<M, 'replace', S>>;

/** show, destroy, restore and purge take no input, so they have no rules or calculate. */
export type RecordSpec<
  M extends Model,
  Action extends string,
  R,
  Default,
  Hidden extends string = never,
  /** What the public record carries besides its columns: show's includes (D28). */
  Extra = unknown,
> = Pick<
  ValueHooks<
    M,
    Action,
    z.ZodType,
    Row<M>,
    Writes<M>,
    Default,
    PublicRow<M, Extract<Hidden, keyof Row<M>>> & Extra,
    R
  >,
  'authorize' | 'respond'
> &
  LoadHook<Row<M>> &
  (Action extends 'show'
    ? unknown
    : SaveHook<M, Row<M>> & CommitHooks<M, Row<M>, Input<M, Action, z.ZodType>>);

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
  CommitHooks<M, Row<M>, Input<M, Name, S>> &
  RouteOptions;

/** Collection actions load nothing and save nothing: calculate's result is the reply body. */
export type CollectionSpec<
  M extends Model,
  Name extends string,
  S extends z.ZodType,
  Result,
  R,
> = ValueHooks<M, Name, S, undefined, Result, Reply<200, Result>, undefined, R> & RouteOptions;

export interface IndexPage<Row> {
  data: Row[];
  meta: { page: number; per_page: number; total: number };
}

/**
 * The column values an index is scoped to (D22): each an equality the default load adds to
 * its filters. An undefined or null value matches no row, so a scope that cannot be worked
 * out fails closed; `{}` scopes nothing.
 */
export type Scope<M extends Model> = {
  readonly [K in keyof Row<M>]?: Row<M>[K] | null | undefined;
};

/** index: opt in to ?trashed, scope the listing, and override load or respond. */
export type IndexSpec<M extends Model, R, Hidden extends string, Extra = unknown> = {
  /** Accept ?trashed=with|only. Soft-delete tables only. */
  trashed?: boolean;
  /** The rows the listing is limited to, worked out from the identity (D22). */
  scope?: (context: { auth: RegisteredAuth | null }) => Scope<M>;
} & Pick<
  ValueHooks<
    M,
    'index',
    z.ZodType,
    undefined,
    undefined,
    Reply<200, IndexPage<PublicRow<M, Extract<Hidden, keyof Row<M>>> & Extra>>,
    IndexPage<PublicRow<M, Extract<Hidden, keyof Row<M>>> & Extra>,
    R
  >,
  'authorize' | 'respond'
> &
  LoadHook<IndexPage<Row<M>>>;
