/**
 * P3.3 / P3.4 inference spike: how can `calculate`'s input be inferred from `rules`?
 *
 * Findings (TS 7.0.2):
 * - An object literal keyed by action name, typed as a reverse mapped type, is fragile.
 *   It infers while every action has rules, but `index: true` (a union) or an `index: {}`
 *   next to a spec with rules makes every `input` fall back, and an action-specific
 *   `prev` cannot be typed because the key is not a literal during inference.
 * - One generic call per action (`a.store({ rules, calculate })`) infers reliably. The
 *   actions callback returns an array, which is also the explicit exposure list.
 *
 * The declared function has no implementation, so every check lives in a function that
 * tsc checks and bun never calls.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import type { Model, Row, SoftDeletes, Writes } from '@blendx/core';
import { z } from 'zod';
import type { models as addition } from '../../../dbml/test/golden/addition.schema.gen.ts';
import type { models as shop } from '../../../dbml/test/golden/shop.schema.gen.ts';

type AdditionResults = typeof addition.addition_results;
type Users = typeof shop.users;
declare const additionResults: AdditionResults;
declare const users: Users;

/** Stand-in for the real per-action default rules (P4.1). */
type DefaultRules<K> = K extends 'store' | 'update'
  ? z.ZodObject<{ result: z.ZodOptional<z.ZodNullable<z.ZodNumber>> }>
  : z.ZodObject<Record<never, never>>;

/**
 * When `rules` is omitted, S has no inference candidate and TS falls back to its
 * constraint (a generic default is not applied). Swap in the action's defaults then.
 */
type Resolved<S, D> = z.ZodType extends S ? D : S;

interface ActionDef<Name extends string, Rules> {
  readonly name: Name;
  readonly rules: Rules | undefined;
}

interface HookSpec<M extends Model, K extends string, S extends z.ZodType, Rec> {
  rules?: (context: { prev: DefaultRules<K> }) => S;
  calculate?: (context: {
    input: z.output<Resolved<S, DefaultRules<K>>>;
    record: Rec;
  }) => Writes<M>;
}

type Builder<M extends Model> = {
  index(): ActionDef<'index', DefaultRules<'index'>>;
  show(): ActionDef<'show', DefaultRules<'show'>>;
  store<S extends z.ZodType>(
    spec?: HookSpec<M, 'store', S, undefined>,
  ): ActionDef<'store', Resolved<S, DefaultRules<'store'>>>;
  update<S extends z.ZodType>(
    spec?: HookSpec<M, 'update', S, Row<M>>,
  ): ActionDef<'update', Resolved<S, DefaultRules<'update'>>>;
  member<const N extends string, S extends z.ZodType>(
    name: N,
    spec: HookSpec<M, N, S, Row<M>>,
  ): ActionDef<N, Resolved<S, DefaultRules<N>>>;
} & (SoftDeletes<M> extends true
  ? { restore(): ActionDef<'restore', DefaultRules<'restore'>> }
  : Record<never, never>);

declare function blend<M extends Model, A extends readonly ActionDef<string, unknown>[]>(
  model: M,
  spec: { actions: (a: Builder<M>) => A },
): { model: M; actions: A };

describe('P3 inference spike: one generic call per action', () => {
  test('rules replacing the defaults: input is exactly the new schema', () => {
    const typeOnly = () =>
      blend(additionResults, {
        actions: (a) => [
          a.store({
            rules: () => z.object({ a: z.number(), b: z.number() }),
            calculate: ({ input }) => {
              expectTypeOf(input).toEqualTypeOf<{ a: number; b: number }>();
              return { result: input.a + input.b };
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('rules extending the action-specific defaults through prev', () => {
    const typeOnly = () =>
      blend(additionResults, {
        actions: (a) => [
          a.store({
            rules: ({ prev }) => prev.extend({ note: z.string() }),
            calculate: ({ input }) => {
              expectTypeOf(input).toEqualTypeOf<{ result?: number | null; note: string }>();
              return { result: input.result ?? 0 };
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('without rules, calculate sees the defaults and the loaded record', () => {
    const typeOnly = () =>
      blend(additionResults, {
        actions: (a) => [
          a.update({
            calculate: ({ input, record }) => {
              expectTypeOf(input).toEqualTypeOf<{ result?: number | null }>();
              expectTypeOf(record).toEqualTypeOf<Row<AdditionResults>>();
              return { result: (input.result ?? record.result ?? 0) * 2 };
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('all-default actions next to a spec keep the inference', () => {
    const typeOnly = () => {
      const resource = blend(additionResults, {
        actions: (a) => [
          a.index(),
          a.show(),
          a.store({
            rules: () => z.object({ a: z.number(), b: z.number() }),
            calculate: ({ input }) => {
              expectTypeOf(input).toEqualTypeOf<{ a: number; b: number }>();
              return { result: input.a + input.b };
            },
          }),
        ],
      });
      expectTypeOf<(typeof resource)['actions'][number]['name']>().toEqualTypeOf<
        'index' | 'show' | 'store'
      >();
    };
    expect(typeOnly).toBeFunction();
  });

  test('restore exists only for soft-delete models', () => {
    const typeOnly = () => {
      blend(additionResults, { actions: (a) => [a.restore()] });
      // @ts-expect-error users has no deleted_at, so there is no restore action
      blend(users, { actions: (a) => [a.restore()] });
    };
    expect(typeOnly).toBeFunction();
  });

  test('a custom member action infers its rules and gets the record', () => {
    const typeOnly = () =>
      blend(additionResults, {
        actions: (a) => [
          a.member('scale', {
            rules: () => z.object({ factor: z.number() }),
            calculate: ({ input, record }) => ({ result: (record.result ?? 0) * input.factor }),
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('calculate must return writable columns of the model', () => {
    const typeOnly = () =>
      blend(additionResults, {
        actions: (a) => [
          a.store({
            rules: () => z.object({ a: z.number() }),
            // @ts-expect-error `reslt` is not a column
            calculate: ({ input }) => ({ reslt: input.a }),
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });
});
