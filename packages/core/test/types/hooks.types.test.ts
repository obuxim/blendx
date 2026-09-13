/**
 * P3.4: stage hook signatures. Every check lives in a function that tsc checks and bun
 * never calls (the models are declared, not loaded).
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import {
  type ActionReply,
  allow,
  blend,
  type Db,
  type PublicRow,
  type Reply,
  type Row,
  type Writes,
} from '@blendx/core';
import { z } from 'zod';
import type { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

type Orders = typeof models.orders;
type Users = typeof models.users;
declare const orders: Orders;
declare const users: Users;

type ReplyOf<R extends { actions: readonly unknown[] }, N extends string> = ActionReply<
  Extract<R['actions'][number], { name: N }>
>;

describe('P3.4 hook signatures', () => {
  test('calculate gets only prev, input and record: no database, no request', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.store({
            calculate: (context) => {
              expectTypeOf<keyof typeof context>().toEqualTypeOf<'prev' | 'input' | 'record'>();
              expectTypeOf(context.prev).toEqualTypeOf<Writes<Orders>>();
              expectTypeOf(context.record).toEqualTypeOf<undefined>();
              // @ts-expect-error calculate has no database handle
              context.db;
              // @ts-expect-error calculate has no request
              context.request;
              return context.prev;
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test("calculate's prev holds only the writable columns the rules accept (P15.4)", () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.update({
            rules: ({ prev }) => prev.pick({ quantity: true }).extend({ coupon: z.string() }),
            calculate: ({ prev }) => {
              expectTypeOf<keyof typeof prev>().toEqualTypeOf<'quantity'>();
              return { ...prev, total: '1.00' };
            },
          }),
          a.member('refund', {
            rules: () => z.object({ reason: z.string() }),
            calculate: ({ prev }) => {
              expectTypeOf<keyof typeof prev>().toEqualTypeOf<never>();
              return { status: 'refunded' as const };
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('index scope: column values, typed by the model (D22)', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.authenticated,
        actions: (a) => [a.index({ scope: () => ({ user_id: 1, status: 'paid' as const }) })],
      });
    const wrongKey = () =>
      blend(orders, {
        policy: allow.authenticated,
        // @ts-expect-error a scope names only columns
        actions: (a) => [a.index({ scope: () => ({ owner: 1 }) })],
      });
    const wrongType = () =>
      blend(orders, {
        policy: allow.authenticated,
        // @ts-expect-error a column's value has the column's type
        actions: (a) => [a.index({ scope: () => ({ user_id: 'one' }) })],
      });
    expect([typeOnly, wrongKey, wrongType].every((check) => typeof check === 'function')).toBe(
      true,
    );
  });

  test('reveal: an action replies with the hidden columns it reveals, and only it (D24)', () => {
    const typeOnly = () =>
      blend(users, {
        policy: allow.public,
        hidden: ['password'],
        actions: (a) => [
          a.store({ reveal: ['password'] }),
          a.show(),
          a.member('rotate', {
            reveal: ['password'],
            calculate: () => ({ password: 'new' }),
            respond: ({ prev, record }) => {
              expectTypeOf(record.password).toEqualTypeOf<string>();
              return prev;
            },
          }),
        ],
      });
    type Revealing = ReturnType<typeof typeOnly>;
    expectTypeOf<
      'password' extends keyof ReplyOf<Revealing, 'store'>['body'] ? true : false
    >().toEqualTypeOf<true>();
    expectTypeOf<
      'password' extends keyof ReplyOf<Revealing, 'show'>['body'] ? true : false
    >().toEqualTypeOf<false>();
    const notHidden = () =>
      blend(users, {
        policy: allow.public,
        hidden: ['password'],
        // @ts-expect-error only hidden columns are revealed
        actions: (a) => [a.store({ reveal: ['email'] })],
      });
    const onIndex = () =>
      blend(users, {
        policy: allow.public,
        hidden: ['password'],
        // @ts-expect-error index reveals nothing: a page would reveal the column for many rows
        actions: (a) => [a.index({ reveal: ['password'] })],
      });
    expect([typeOnly, notHidden, onIndex].every((check) => typeof check === 'function')).toBe(true);
  });

  test('authorize sees the policy decision, identity, record and validated input', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.update({
            rules: ({ prev }) => prev.extend({ reason: z.string() }),
            authorize: ({ prev, auth, record, input, action }) => {
              expectTypeOf(prev).toEqualTypeOf<boolean>();
              expectTypeOf(auth).toEqualTypeOf<unknown>();
              expectTypeOf(record).toEqualTypeOf<Row<Orders>>();
              expectTypeOf(input.reason).toEqualTypeOf<string>();
              expectTypeOf(action).toEqualTypeOf<'update'>();
              return prev && record.status !== 'refunded';
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('load and save extend or replace the default through runDefault', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.update({
            load: async ({ runDefault, db }) => {
              expectTypeOf(db).toEqualTypeOf<Db>();
              const row = await runDefault();
              expectTypeOf(row).toEqualTypeOf<Row<Orders>>();
              return row;
            },
            save: async ({ runDefault, writes, tx }) => {
              expectTypeOf(writes).toEqualTypeOf<Writes<Orders>>();
              expectTypeOf(tx).toEqualTypeOf<Db>();
              return runDefault({ ...writes, quantity: 1 });
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('store loads nothing and show saves nothing', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.store({
            // @ts-expect-error store has no record to load
            load: async ({ runDefault }) => runDefault(),
          }),
          a.show({
            // @ts-expect-error show saves nothing
            save: async ({ runDefault }) => runDefault(),
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('default replies: 201 store, 204 destroy, 200 show without hidden columns, index page', () => {
    const make = () =>
      blend(users, {
        policy: allow.authenticated,
        hidden: ['password'],
        actions: (a) => [a.index(), a.show(), a.store(), a.destroy()],
      });
    type Resource = ReturnType<typeof make>;
    type PublicUser = PublicRow<Users, 'password'>;

    expectTypeOf<ReplyOf<Resource, 'store'>>().toEqualTypeOf<Reply<201, PublicUser>>();
    expectTypeOf<ReplyOf<Resource, 'show'>>().toEqualTypeOf<Reply<200, PublicUser>>();
    expectTypeOf<ReplyOf<Resource, 'destroy'>>().toEqualTypeOf<Reply<204, null>>();
    expectTypeOf<
      'password' extends keyof ReplyOf<Resource, 'show'>['body'] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<ReplyOf<Resource, 'index'>['body']>().toEqualTypeOf<{
      data: PublicUser[];
      meta: { page: number; per_page: number; total: number };
    }>();
    expect(make).toBeFunction();
  });

  test('respond keeps its status literal and body type', () => {
    const make = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.store({
            respond: ({ record }) => ({ status: 202, body: { queued: true, id: record.id } }),
          }),
        ],
      });
    type StoreReply = ReplyOf<ReturnType<typeof make>, 'store'>;
    expectTypeOf<StoreReply['status']>().toEqualTypeOf<202>();
    expectTypeOf<StoreReply['body']['id']>().toEqualTypeOf<number>();
    expect(make).toBeFunction();
  });

  test('a collection action replies with what calculate returns', () => {
    const make = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.collection('quote', {
            rules: () => z.object({ quantity: z.number() }),
            calculate: ({ input, record }) => {
              expectTypeOf(record).toEqualTypeOf<undefined>();
              return { total: input.quantity * 2 };
            },
          }),
        ],
      });
    expectTypeOf<ReplyOf<ReturnType<typeof make>, 'quote'>>().toEqualTypeOf<
      Reply<200, { total: number }>
    >();
    expect(make).toBeFunction();
  });
});
