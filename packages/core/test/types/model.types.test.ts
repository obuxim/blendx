/**
 * P3.1: model helper types, checked against the P2 golden schemas. expectTypeOf does
 * nothing at runtime; tsc enforces these assertions (`bun run typecheck`).
 */
import { describe, expect, expectTypeOf, test } from 'bun:test';
import type {
  Column,
  Insert,
  Model,
  PublicRow,
  Row,
  SoftDeletes,
  WritableColumn,
  Writes,
} from '@blendx/core';
import { models as addition } from '../../../dbml/test/golden/addition.schema.gen.ts';
import { models as shop } from '../../../dbml/test/golden/shop.schema.gen.ts';

type AdditionResults = typeof addition.addition_results;
type Users = typeof shop.users;
type Orders = typeof shop.orders;

describe('P3.1 model helper types', () => {
  test('generated models satisfy Model', () => {
    expectTypeOf(addition.addition_results).toExtend<Model>();
    expectTypeOf(shop.users).toExtend<Model>();
    expectTypeOf(shop.orders).toExtend<Model>();
    expect(shop.orders.meta.softDelete).toBe('deleted_at');
  });

  test('Row is the select shape with JSON-friendly values', () => {
    expectTypeOf<Row<AdditionResults>>().toEqualTypeOf<{
      id: number;
      result: number | null;
      created_at: string | null;
      updated_at: string | null;
      deleted_at: string | null;
    }>();
    expectTypeOf<Row<Orders>['total']>().toEqualTypeOf<string>();
    expectTypeOf<Row<Orders>['status']>().toEqualTypeOf<'pending' | 'paid' | 'refunded'>();
  });

  test('Column lists every column name', () => {
    expectTypeOf<Column<AdditionResults>>().toEqualTypeOf<
      'id' | 'result' | 'created_at' | 'updated_at' | 'deleted_at'
    >();
  });

  test('Insert leaves out identity columns', () => {
    expectTypeOf<keyof Insert<AdditionResults>>().toEqualTypeOf<
      'result' | 'created_at' | 'updated_at' | 'deleted_at'
    >();
  });

  test('WritableColumn excludes generated columns', () => {
    expectTypeOf<WritableColumn<AdditionResults>>().toEqualTypeOf<'result'>();
    expectTypeOf<WritableColumn<Orders>>().toEqualTypeOf<
      'user_id' | 'status' | 'total' | 'quantity' | 'tags' | 'meta' | 'public_id' | 'placed_on'
    >();
  });

  test('Writes is an optional subset of writable columns with insert types', () => {
    expectTypeOf<Writes<AdditionResults>>().toEqualTypeOf<{ result?: number | null }>();
    const writes: Writes<Orders> = { status: 'paid', quantity: 2 };
    expect(writes.status).toBe('paid');
    // @ts-expect-error id is generated, calculate may not write it
    const generated: Writes<AdditionResults> = { id: 1 };
    // @ts-expect-error unknown columns are rejected
    const unknown: Writes<AdditionResults> = { reslt: 7 };
    // @ts-expect-error values keep their column types
    const wrongType: Writes<AdditionResults> = { result: 'seven' };
    expect([generated, unknown, wrongType]).toHaveLength(3);
  });

  test('PublicRow removes hidden columns', () => {
    expectTypeOf<keyof PublicRow<Users, 'password'>>().toEqualTypeOf<
      'id' | 'email' | 'display_name' | 'is_active' | 'created_at' | 'updated_at'
    >();
    expectTypeOf<PublicRow<Users>>().toEqualTypeOf<Omit<Row<Users>, never>>();
  });

  test('SoftDeletes follows the deleted_at convention', () => {
    expectTypeOf<SoftDeletes<Orders>>().toEqualTypeOf<true>();
    expectTypeOf<SoftDeletes<AdditionResults>>().toEqualTypeOf<true>();
    expectTypeOf<SoftDeletes<Users>>().toEqualTypeOf<false>();
  });
});
