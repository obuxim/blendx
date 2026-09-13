/**
 * P16.7 (D28): relations and includes. A model's belongs-to relations come from its `_id`
 * foreign keys; a blend lists what `?include=` may nest, each through a blend of the table the
 * relation points to, and blend() refuses anything else.
 */
import { describe, expect, test } from 'bun:test';
import {
  allow,
  BlendxDefinitionError,
  blend,
  foreignKeysTo,
  relationsOf,
  resolveIncludes,
} from '@blendx/core';
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
        primaryKey: ['id'],
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

describe('has-many includes (P16.11, D31)', () => {
  const notes = blend(shop.order_notes, {
    policy: allow.public,
    hidden: ['body'],
    actions: (a) => [a.index(), a.show()],
  });
  /** An orders blend with the given includes, built only when called. */
  const refused = (includes: unknown) => () =>
    blend(shop.orders, {
      policy: allow.public,
      includes: includes as never,
      actions: (a) => [a.index()],
    });

  test('foreignKeysTo: the columns of a model that point at a table', () => {
    expect(foreignKeysTo(shop.order_notes, 'orders')).toEqual(['order_id']);
    expect(foreignKeysTo(shop.orders, 'users')).toEqual(['user_id']);
    expect(foreignKeysTo(shop.orders, 'order_notes')).toEqual([]);
  });

  test('a blend includes the rows that point at it, through their blend, bounded and ordered', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      includes: { user: users, notes: { blend: notes, limit: 10, sort: '-created_at' } },
      actions: (a) => [a.index(), a.show()],
    });
    expect(orders.includes.notes).toEqual({ blend: notes, limit: 10, sort: '-created_at' });
    expect(resolveIncludes(orders)).toEqual({
      user: { kind: 'belongsTo', column: 'user_id', target: users },
      notes: {
        kind: 'hasMany',
        column: 'order_id',
        key: 'id',
        target: notes,
        limit: 10,
        sort: { column: 'created_at', descending: true },
      },
    });
  });

  test("without a sort, the rows come in the order of the target's primary key", () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      includes: { notes: { blend: notes, limit: 3 } },
      actions: (a) => [a.show()],
    });
    expect(resolveIncludes(orders).notes).toMatchObject({
      column: 'order_id',
      sort: { column: 'id', descending: false },
    });
  });

  test('blend() refuses a has-many include whose blend does not point at the table', () => {
    expect(refused({ customers: { blend: users, limit: 5 } })).toThrow(BlendxDefinitionError);
    expect(refused({ customers: { blend: users, limit: 5 } })).toThrow(
      'include "customers": users has no foreign key to orders',
    );
  });

  test('blend() refuses a has-many include without a positive integer limit (D31)', () => {
    for (const limit of [undefined, 0, -1, 2.5, '10']) {
      expect(refused({ notes: { blend: notes, limit } })).toThrow(
        'include "notes": limit must be a positive integer (D31)',
      );
    }
  });

  test('blend() refuses a sort that is not a column of the target, or is hidden there', () => {
    expect(refused({ notes: { blend: notes, limit: 5, sort: 'total' } })).toThrow(
      'include "notes": sort "total" is not a column of order_notes',
    );
    expect(refused({ notes: { blend: notes, limit: 5, sort: '-body' } })).toThrow(
      'include "notes": sort "-body" is a hidden column of order_notes',
    );
  });

  test('by names the foreign key, and is required when the target points at the table twice', () => {
    const reviewsTable = pgTable('reviews', {
      id: integer('id').primaryKey(),
      author_id: integer('author_id').notNull(),
      reviewer_id: integer('reviewer_id'),
      body: text('body'),
    });
    const reviews = {
      name: 'reviews',
      table: reviewsTable,
      meta: {
        primaryKey: ['id'],
        timestamps: { createdAt: null, updatedAt: null },
        softDelete: null,
        generated: ['id'],
        constraints: {
          reviews_author_id_fkey: {
            kind: 'foreignKey',
            columns: ['author_id'],
            references: { table: 'users', columns: ['id'] },
          },
          reviews_reviewer_id_fkey: {
            kind: 'foreignKey',
            columns: ['reviewer_id'],
            references: { table: 'users', columns: ['id'] },
          },
        },
      },
    } as const;
    const reviewed = blend(reviews, { policy: allow.public, actions: (a) => [a.show()] });
    const define = (written: unknown) => () =>
      blend(shop.users, {
        policy: allow.public,
        includes: { written } as never,
        actions: (a) => [a.show()],
      });
    expect(foreignKeysTo(reviews, 'users')).toEqual(['author_id', 'reviewer_id']);
    expect(
      resolveIncludes(define({ blend: reviewed, by: 'author_id', limit: 5 })()).written,
    ).toMatchObject({ kind: 'hasMany', column: 'author_id' });
    expect(define({ blend: reviewed, limit: 5 })).toThrow(
      'include "written": reviews points to users by author_id and reviewer_id; say which with by',
    );
    expect(define({ blend: reviewed, by: 'body', limit: 5 })).toThrow(
      'include "written": "body" is not a foreign key of reviews to users (they are: author_id, reviewer_id)',
    );
  });

  test('a has-many target must expose show without a load hook, as a belongs-to must', () => {
    const listed = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.index()] });
    expect(refused({ notes: { blend: listed, limit: 5 } })).toThrow(
      'include "notes": order_notes does not expose show, which decides who sees its rows',
    );
    const loaded = blend(shop.order_notes, {
      policy: allow.public,
      actions: (a) => [a.show({ load: ({ runDefault }) => runDefault() })],
    });
    expect(refused({ notes: { blend: loaded, limit: 5 } })).toThrow(
      'include "notes": the show of order_notes has a load hook, which an include cannot run',
    );
    expect(refused({ notes: { blend: undefined, limit: 5 } })).toThrow(
      'include "notes" is not a blend; two blends cannot include each other (D28)',
    );
  });

  test('blend() refuses a has-many include named like a column or a belongs-to relation', () => {
    expect(refused({ total: { blend: notes, limit: 5 } })).toThrow(
      'include "total" has the name of a column of orders',
    );
    expect(refused({ user: { blend: notes, limit: 5 } })).toThrow(
      'include "user" is a belongs-to relation of orders; give it the blend of users',
    );
  });

  test('a bare blend under a name that is not a relation says how to declare a has-many', () => {
    expect(refused({ notes })).toThrow(
      'include "notes" is not a relation of orders (its relations: user); a has-many include is { blend, limit } (D31)',
    );
  });
});
