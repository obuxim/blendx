/**
 * P16.17a (D34): a.replace() and its types. Its rules are the store rules without the key
 * columns, its hooks are update's, its method is PUT and its reply the public record. Every
 * check lives in a function that tsc checks and bun never calls.
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import { type ActionReply, allow, blend, type PublicRow, type Reply, type Row } from '@blendx/core';
import type { models } from '../../../dbml/test/golden/kitchen-sink.schema.gen.ts';

type Items = typeof models.order_items;
type Orders = typeof models.orders;
declare const items: Items;
declare const orders: Orders;

describe('D34 replace types', () => {
  test('the default rules are the store rules without the key columns', () => {
    const typeOnly = () =>
      blend(items, {
        policy: allow.public,
        actions: (a) => [
          a.replace({
            rules: ({ prev }) => {
              expectTypeOf<keyof typeof prev.shape>().toEqualTypeOf<'sku'>();
              return prev;
            },
            authorize: ({ action, record }) => {
              expectTypeOf(action).toEqualTypeOf<'replace'>();
              expectTypeOf(record).toEqualTypeOf<Row<Items>>();
              return record.line > 0;
            },
            calculate: ({ prev, input, record }) => {
              expectTypeOf<keyof typeof prev>().toEqualTypeOf<'sku'>();
              expectTypeOf(input.sku).toEqualTypeOf<string>();
              expectTypeOf(record).toEqualTypeOf<Row<Items>>();
              return prev;
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });

  test('the action is PUT and replies 200 with the public record', () => {
    const resource = () =>
      blend(orders, {
        policy: allow.public,
        hidden: ['meta'],
        actions: (a) => [a.replace()],
      });
    type Action = ReturnType<typeof resource>['actions'][number];
    expectTypeOf<Action['name']>().toEqualTypeOf<'replace'>();
    expectTypeOf<Action['method']>().toEqualTypeOf<'put'>();
    expectTypeOf<ActionReply<Action>>().toEqualTypeOf<Reply<200, PublicRow<Orders, 'meta'>>>();
  });

  test('replace writes, so it has after and later', () => {
    const typeOnly = () =>
      blend(orders, {
        policy: allow.public,
        actions: (a) => [
          a.replace({
            after: ({ saved, record }) => {
              expectTypeOf(saved).toEqualTypeOf<Row<Orders>>();
              expectTypeOf(record).toEqualTypeOf<Row<Orders>>();
            },
            later: ({ id }) => {
              expectTypeOf(id).toEqualTypeOf<number>();
            },
          }),
        ],
      });
    expect(typeOnly).toBeFunction();
  });
});
