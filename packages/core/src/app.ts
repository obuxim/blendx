/**
 * defineApp(): app-wide settings and the first level of the hook cascade
 * (schema default, then app, then resource, then action). App hooks run for every
 * table, so they must keep the type they receive.
 *
 * The app's auth type reaches every hook and policy through the Register interface,
 * which the generated register.gen.ts augments:
 *   declare module '@blendx/core' { interface Register { app: typeof app } }
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

/** App-level hooks. They see every table, so each must return the type it receives. */
export interface AppHooks {
  rules?: <T extends z.ZodType>(context: { prev: T; model: Model; action: string }) => T;
  authorize?: (context: {
    prev: boolean;
    auth: RegisteredAuth | null;
    model: Model;
    action: string;
  }) => boolean | Promise<boolean>;
  respond?: <R extends Reply>(context: { prev: R; model: Model; action: string }) => R;
}

export interface AppSpec {
  /** Resolves the identity of a request, or null when there is none. Identity only. */
  auth?: (context: AuthContext) => unknown;
  hooks?: AppHooks;
  index?: { perPage?: number; maxPerPage?: number };
  problems?: { typeBase?: string };
}

export interface App<S extends AppSpec = AppSpec> {
  readonly kind: 'blendx/app';
  readonly spec: S;
  readonly index: { readonly perPage: number; readonly maxPerPage: number };
}

type AuthOfApp<A> =
  A extends App<infer S>
    ? S['auth'] extends (context: AuthContext) => infer R
      ? NonNullable<Awaited<R>>
      : never
    : unknown;

/** The identity type of the registered app: unknown until register.gen.ts registers one. */
export type RegisteredAuth = Register extends { app: infer A } ? AuthOfApp<A> : unknown;

/** Thrown when the app or config is invalid. */
export class BlendxConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlendxConfigError';
  }
}

const isPositiveInteger = (n: number) => Number.isInteger(n) && n > 0;

export function defineApp<const S extends AppSpec>(spec: S): App<S> {
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
