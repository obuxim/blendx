/**
 * P16.7 (D28): relations and includes. A model's belongs-to relations come from its `_id`
 * foreign keys; a blend lists what `?include=` may nest, each through a blend of the table the
 * relation points to, and blend() refuses anything else.
 */
import { describe, expect, test } from 'bun:test';
import { allow, BlendxDefinitionError, blend, relationsOf } from '@blendx/core';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';

const users = blend(shop.users, {
  policy: allow.authenticated,
  hidden: ['password'],
  actions: (a) => [a.index(), a.show()],
});

describe('relationsOf (D28)', () => {
  test("a model's belongs-to relations: its _id foreign keys, named without _id", () => {
    expect([...relationsOf(shop.orders)]).toEqual([
      ['user', { column: 'user_id', table: 'users', key: 'id' }],
    ]);
    expect([...relationsOf(shop.order_notes)]).toEqual([
      ['order', { column: 'order_id', table: 'orders', key: 'id' }],
    ]);
    expect(relationsOf(shop.users).size).toBe(0);
  });
});

describe('includes (D28)', () => {
  /** An orders blend with the given includes, built only when called. */
  const refused = (includes: unknown) => () =>
    blend(shop.orders, {
      policy: allow.public,
      includes: includes as never,
      actions: (a) => [a.index()],
    });

  test('a blend includes a relation through a blend of the table it points to', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      includes: { user: users },
      actions: (a) => [a.index(), a.show()],
    });
    expect(orders.includes).toEqual({ user: users });
    const plain = blend(shop.orders, { policy: allow.public, actions: (a) => [a.index()] });
    expect(plain.includes).toEqual({});
  });

  test('blend() refuses an include that is not a relation of the table', () => {
    expect(refused({ customer: users })).toThrow(BlendxDefinitionError);
    expect(refused({ customer: users })).toThrow(
      'include "customer" is not a relation of orders (its relations: user)',
    );
  });

  test('blend() refuses a blend of another table', () => {
    const notes = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.show()] });
    expect(refused({ user: notes })).toThrow('include "user" points to users, not to order_notes');
  });

  test('blend() refuses a target that does not expose show, or loads it with a hook', () => {
    const listed = blend(shop.users, { policy: allow.public, actions: (a) => [a.index()] });
    expect(refused({ user: listed })).toThrow(
      'include "user": users does not expose show, which decides who sees its rows',
    );
    const loaded = blend(shop.users, {
      policy: allow.public,
      actions: (a) => [a.show({ load: ({ runDefault }) => runDefault() })],
    });
    expect(refused({ user: loaded })).toThrow(
      'include "user": the show of users has a load hook, which an include cannot run',
    );
  });

  test('blend() refuses an include that is not a blend, as when two blends import each other', () => {
    expect(refused({ user: undefined })).toThrow(
      'include "user" is not a blend; two blends cannot include each other (D28)',
    );
  });

  test('blend() refuses an include named like a column', () => {
    const things = pgTable('things', {
      id: integer('id').primaryKey(),
      user: text('user'),
      user_id: integer('user_id'),
    });
    const model = {
      name: 'things',
      table: things,
      meta: {
        primaryKey: 'id',
        timestamps: { createdAt: null, updatedAt: null },
        softDelete: null,
        generated: [],
        constraints: {
          things_user_id_fkey: {
            kind: 'foreignKey',
            columns: ['user_id'],
            references: { table: 'users', columns: ['id'] },
          },
        },
      },
    } as const;
    const define = () =>
      blend(model, {
        policy: allow.public,
        includes: { user: users } as never,
        actions: (a) => [a.index()],
      });
    expect(define).toThrow('include "user" has the name of a column of things');
  });
});
