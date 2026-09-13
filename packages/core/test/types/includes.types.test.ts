/**
 * P16.7 (D28): relations come from the foreign keys, and includes are checked: a relation of
 * the table, through a blend of the table it points to. The refused blends are built only
 * inside `refused`, which is never called: blend() would throw.
 */
import { describe, expectTypeOf, test } from 'bun:test';
import {
  type ActionReply,
  type ActionRules,
  allow,
  blend,
  type ForeignKeysTo,
  type PublicRow,
  type Relation,
  type RelationTable,
} from '@blendx/core';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { models } from '../../../dbml/test/golden/shop.schema.gen.ts';

const users = blend(models.users, { policy: allow.public, actions: (a) => [a.show()] });
const notes = blend(models.order_notes, { policy: allow.public, actions: (a) => [a.show()] });

/** A table that points at users twice, as schema.gen.ts would record it. */
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
    primaryKey: 'id',
    timestamps: { createdAt: null, updatedAt: null },
    softDelete: null,
    generated: ['id'],
    constraints: {
      reviews_pkey: { kind: 'primaryKey', columns: ['id'] },
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

describe('relations (D28)', () => {
  test('named after their _id foreign key, pointing to its table', () => {
    expectTypeOf<Relation<typeof models.orders>>().toEqualTypeOf<'user'>();
    expectTypeOf<Relation<typeof models.order_notes>>().toEqualTypeOf<'order'>();
    expectTypeOf<Relation<typeof models.users>>().toEqualTypeOf<never>();
    expectTypeOf<RelationTable<typeof models.orders, 'user'>>().toEqualTypeOf<'users'>();
  });

  test('includes take a relation of the table, through a blend of the table it points to', () => {
    const orders = blend(models.orders, {
      policy: allow.public,
      includes: { user: users },
      actions: (a) => [a.index()],
    });
    expectTypeOf(orders.includes.user).toEqualTypeOf<typeof users>();

    const refused = () => [
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error customer is not a relation of orders
        includes: { customer: users },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        includes: {
          // @ts-expect-error user points to users, not to order_notes
          user: notes,
        },
        actions: (a) => [a.index()],
      }),
    ];
    expectTypeOf(refused).toBeFunction();
  });
});

describe('?include= in the types (P16.8, D28)', () => {
  const guarded = blend(models.users, {
    policy: allow.public,
    hidden: ['password'],
    actions: (a) => [a.show()],
  });
  const orders = blend(models.orders, {
    policy: allow.public,
    includes: { user: guarded },
    actions: (a) => [a.index(), a.show(), a.update()],
  });
  type Action<N> = Extract<(typeof orders)['actions'][number], { name: N }>;
  type User = PublicRow<typeof models.users, 'password'>;

  test('index and show replies carry each include as an optional, nullable record, without its hidden columns', () => {
    expectTypeOf<ActionReply<Action<'show'>>['body']['user']>().toEqualTypeOf<
      User | null | undefined
    >();
    expectTypeOf<ActionReply<Action<'index'>>['body']['data'][number]['user']>().toEqualTypeOf<
      User | null | undefined
    >();
    expectTypeOf<ActionReply<Action<'update'>>['body']>().not.toHaveProperty('user');
  });

  test("show's query takes include when the blend declares includes", () => {
    expectTypeOf<z.input<ActionRules<Action<'show'>>>>().toEqualTypeOf<{
      include?: string | undefined;
    }>();
  });
});

describe('has-many includes (P16.11, D31)', () => {
  test('the columns of a model that point at a table', () => {
    expectTypeOf<ForeignKeysTo<typeof models.order_notes, 'orders'>>().toEqualTypeOf<'order_id'>();
    expectTypeOf<ForeignKeysTo<typeof models.orders, 'order_notes'>>().toEqualTypeOf<never>();
    expectTypeOf<ForeignKeysTo<typeof reviews, 'users'>>().toEqualTypeOf<
      'author_id' | 'reviewer_id'
    >();
  });

  test('a has-many include names the blend of the rows that point at the table, with its limit', () => {
    const orders = blend(models.orders, {
      policy: allow.public,
      includes: { user: users, notes: { blend: notes, limit: 10, sort: '-created_at' } },
      actions: (a) => [a.index(), a.show(), a.update()],
    });
    expectTypeOf(orders.includes.notes.blend).toEqualTypeOf<typeof notes>();
    type Action<N> = Extract<(typeof orders)['actions'][number], { name: N }>;
    type Note = PublicRow<typeof models.order_notes>;
    // The reply carries the has-many as an array, never null, and the belongs-to as before.
    expectTypeOf<ActionReply<Action<'show'>>['body']['notes']>().toEqualTypeOf<
      Note[] | undefined
    >();
    expectTypeOf<ActionReply<Action<'index'>>['body']['data'][number]['notes']>().toEqualTypeOf<
      Note[] | undefined
    >();
    expectTypeOf<ActionReply<Action<'show'>>['body']['user']>().toEqualTypeOf<
      PublicRow<typeof models.users> | null | undefined
    >();
    expectTypeOf<ActionReply<Action<'update'>>['body']>().not.toHaveProperty('notes');
  });

  test('by names the foreign key, and is required when the target points at the table twice', () => {
    const byAuthor = blend(models.users, {
      policy: allow.public,
      includes: { written: { blend: reviewed, by: 'author_id', limit: 5 } },
      actions: (a) => [a.show()],
    });
    expectTypeOf(byAuthor.includes.written.by).toEqualTypeOf<'author_id'>();
    const refused = () => [
      blend(models.users, {
        policy: allow.public,
        // @ts-expect-error by is required: reviews points at users by author_id and reviewer_id
        includes: { written: { blend: reviewed, limit: 5 } },
        actions: (a) => [a.show()],
      }),
      blend(models.users, {
        policy: allow.public,
        // @ts-expect-error body is not a foreign key of reviews to users
        includes: { written: { blend: reviewed, by: 'body', limit: 5 } },
        actions: (a) => [a.show()],
      }),
    ];
    expectTypeOf(refused).toBeFunction();
  });

  test('refused: no limit, a blend that does not point at the table, a sort that is not its column, a column name, a bare blend', () => {
    const refused = () => [
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error limit is required on a has-many include (D31)
        includes: { notes: { blend: notes } },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error users has no foreign key to orders
        includes: { customers: { blend: users, limit: 5 } },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error total is not a column of order_notes
        includes: { notes: { blend: notes, limit: 5, sort: 'total' } },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error total is a column of orders
        includes: { total: { blend: notes, limit: 5 } },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error a has-many include is { blend, limit }, not a bare blend
        includes: { notes: notes },
        actions: (a) => [a.index()],
      }),
      blend(models.orders, {
        policy: allow.public,
        // @ts-expect-error a has-many include takes blend, by, limit and sort only
        includes: { notes: { blend: notes, limit: 5, where: 'x' } },
        actions: (a) => [a.index()],
      }),
    ];
    expectTypeOf(refused).toBeFunction();
  });
});

describe('nested includes in the types (P16.14, D32)', () => {
  const guarded = blend(models.users, {
    policy: allow.public,
    hidden: ['password'],
    actions: (a) => [a.show()],
  });
  const orders = blend(models.orders, {
    policy: allow.public,
    includes: { user: guarded },
    actions: (a) => [a.show()],
  });
  const notesWithOrder = blend(models.order_notes, {
    policy: allow.public,
    includes: { order: orders },
    actions: (a) => [a.index(), a.show()],
  });
  const withNotes = blend(models.orders, {
    policy: allow.public,
    includes: { notes: { blend: notesWithOrder, limit: 5 } },
    actions: (a) => [a.show(), a.update()],
  });
  type NoteAction<N> = Extract<(typeof notesWithOrder)['actions'][number], { name: N }>;
  type OrderAction<N> = Extract<(typeof withNotes)['actions'][number], { name: N }>;
  type User = PublicRow<typeof models.users, 'password'>;

  test('an included record carries its own includes as optional fields, recursively', () => {
    type Order = NonNullable<ActionReply<NoteAction<'show'>>['body']['order']>;
    expectTypeOf<Order['id']>().toEqualTypeOf<number>();
    expectTypeOf<Order['user']>().toEqualTypeOf<User | null | undefined>();
    type Listed = NonNullable<ActionReply<NoteAction<'index'>>['body']['data'][number]['order']>;
    expectTypeOf<Listed['user']>().toEqualTypeOf<User | null | undefined>();
    // Under a has-many: each note's order, and the order's user.
    type Note = NonNullable<ActionReply<OrderAction<'show'>>['body']['notes']>[number];
    expectTypeOf<Note['body']>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Note['order']>['user']>().toEqualTypeOf<User | null | undefined>();
    expectTypeOf<ActionReply<OrderAction<'update'>>['body']>().not.toHaveProperty('notes');
  });

  test("show's query still takes include as one string", () => {
    expectTypeOf<z.input<ActionRules<NoteAction<'show'>>>>().toEqualTypeOf<{
      include?: string | undefined;
    }>();
  });
});
