/**
 * defineApp(): app-wide settings and the first level of the hook cascade
 * (schema default, then app, then resource, then action). App hooks run for every
 * table, so they must keep the type they receive.
 *
 * The identity's type is inferred from the app's `auth` function. App hooks take it from
 * there; every policy and every resource or action hook takes it through the Register
 * interface, which the generated register.gen.ts augments:
 *   declare module 'blendx' { interface Register { app: typeof app } }
 */
import type { z } from 'zod';
import type { Db, Reply } from './hooks.ts';
import type { Model } from './model.ts';

// biome-ignore lint/suspicious/noEmptyInterface: apps augment it in register.gen.ts
export interface Register {}

export interface AuthContext {
  request: Request;
  db: Db;
}

/**
 * App-level hooks. They see every table, so each must return the type it receives. `Auth` is
 * the identity as the app's own `auth` types it: through Register, the app's type would
 * depend on itself (TS2502). Declared as methods, so an App<User> still fits App.
 */
export interface AppHooks<Auth = unknown> {
  rules?<T extends z.ZodType>(context: { prev: T; model: Model; action: string }): T;
  authorize?(context: {
    prev: boolean;
    auth: Auth | null;
    model: Model;
    action: string;
  }): boolean | Promise<boolean>;
  respond?<R extends Reply>(context: { prev: R; model: Model; action: string }): R;
  /**
   * After every write commits, for every table, before the resource's and the action's after
   * (D26). What it throws is reported, and the reply stands.
   */
  after?(context: {
    saved: unknown;
    record: unknown;
    input: unknown;
    auth: Auth | null;
    db: Db;
    model: Model;
    action: string;
  }): unknown;
  /**
   * From the outbox, for every write of every table (D27): at least once, outside the
   * request, with the context stored as JSON.
   */
  later?(context: {
    saved: unknown;
    record: unknown;
    input: unknown;
    auth: Auth | null;
    db: Db;
    model: Model;
    action: string;
    /** The outbox entry's id: the same on every attempt. */
    id: number;
    attempt: number;
  }): unknown;
}

/** `Auth` is what `auth` resolves to, null included. */
export interface AppSpec<Auth = unknown> {
  /** Resolves the identity of a request, or null when there is none. Identity only. */
  auth?: (context: AuthContext) => Auth | Promise<Auth>;
  /**
   * Hooks for every table. Write them after `auth`, whose return type types them. Exclude,
   * not NonNullable, so that the generic App's identity stays `unknown` rather than `{}`.
   */
  hooks?: AppHooks<Exclude<Auth, null | undefined>>;
  index?: { perPage?: number; maxPerPage?: number };
  problems?: { typeBase?: string };
}

export interface App<Auth = unknown> {
  readonly kind: 'blendx/app';
  readonly spec: AppSpec<Auth>;
  readonly index: { readonly perPage: number; readonly maxPerPage: number };
}

/** The identity type of the registered app: unknown until register.gen.ts registers one. */
export type RegisteredAuth = Register extends { app: App<infer Auth> }
  ? NonNullable<Auth>
  : unknown;

/** Thrown when the app or config is invalid. */
export class BlendxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlendxConfigError';
  }
}

const isPositiveInteger = (n: number) => Number.isInteger(n) && n > 0;

/** `Auth` is inferred from `auth`; an app without one has no identity (null). */
export function defineApp<Auth = null>(spec: AppSpec<Auth>): App<Auth> {
  const perPage = spec.index?.perPage ?? 25;
  const maxPerPage = spec.index?.maxPerPage ?? 100;
  if (!isPositiveInteger(perPage) || !isPositiveInteger(maxPerPage)) {
    throw new BlendxConfigError('index.perPage and index.maxPerPage must be positive integers');
  }
  if (perPage > maxPerPage) {
    throw new BlendxConfigError(
      `index.perPage (${perPage}) is larger than index.maxPerPage (${maxPerPage})`,
    );
  }
  return Object.freeze({
    kind: 'blendx/app',
    spec,
    index: Object.freeze({ perPage, maxPerPage }),
  });
}
