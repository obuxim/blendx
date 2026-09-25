/**
 * P10.3: review/<resource>.yaml. The golden is the addition example's own review file; the
 * other tests pin the comments, the layout and determinism. The TypeScript 6 program that
 * reads calculate is built once: it loads the app's full types and takes a few seconds.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  type App,
  allow,
  blend,
  defineApp,
  type Resource,
  type ResourceReview,
  reviewAppActions,
  reviewResource,
} from '@blendx/core';
import { z } from 'blendx';
import { parse } from 'yaml';
import { models as membership } from '../../core/test/fixtures/membership.schema.ts';
import { models as kitchen } from '../../dbml/test/golden/kitchen-sink.schema.gen.ts';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { type CalculateSource, extractCalculates } from '../src/calculates.ts';
import { emitAppReview, emitReview } from '../src/emit-review.ts';
import { expectGolden } from './support/golden.ts';

const example = join(import.meta.dir, '..', '..', '..', 'examples', 'addition');
const blendFile = join(example, 'blends', 'addition_results.ts');

let review: ResourceReview;
let calculates: ReadonlyMap<string, CalculateSource> | undefined;
beforeAll(async () => {
  // Computed paths keep the example out of this package's tsc program.
  const resource = (await import(blendFile)).default as Resource;
  const app = (await import(join(example, 'src', 'app.ts'))).default as App;
  review = reviewResource(resource, app);
  calculates = extractCalculates([blendFile]).get(blendFile);
}, 60_000);

const additionReview = () =>
  emitReview({ review, calculates, source: 'blends/addition_results.ts' });

describe('emitReview', () => {
  test('the addition example', async () => {
    await expectGolden(join(example, 'review', 'addition_results.yaml'), additionReview());
  });

  test('the same review twice is the same text', () => {
    expect(additionReview()).toBe(additionReview());
  });

  test('normalizes tab-indented source blocks to spaces', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [
        a.index({ scope: ({ auth }) => ({ user_id: (auth as { id: number }).id }) }),
        a.store({
          authorize: ({ prev }) => prev,
          save: async ({ runDefault }) => runDefault(),
        }),
      ],
    });
    const review = reviewResource(orders, defineApp({}));
    const sources = {
      scope:
        '({ auth }) => {\n\tconst id = (auth as { id: number }).id;\n\treturn { user_id: id };\n}',
      calculate: '({ input }) => {\n \treturn { ...input };\n}',
      authorize: '({ prev }) => {\n\treturn prev;\n}',
      save: 'async ({ runDefault }) => {\n\treturn runDefault();\n}',
    };
    const input = {
      review,
      source: 'blends/orders.ts',
      scopes: new Map([['index', { source: sources.scope, keys: ['user_id'] }]]),
      calculates: new Map([['store', { source: sources.calculate, keys: ['status'] }]]),
      stageHooks: {
        action: new Map([
          [
            'store',
            new Map([
              ['authorize', { source: sources.authorize }],
              ['save', { source: sources.save }],
            ]),
          ],
        ]),
      },
    };

    const text = emitReview(input);
    expect(text).not.toContain('\t');
    expect(text).toContain(
      '      source: |-\n        ({ auth }) => {\n          const id = (auth as { id: number }).id;',
    );
    expect(text).toContain(
      'source: |-\n              ({ prev }) => {\n                return prev;',
    );
    expect(emitReview(input)).toBe(text);

    const actions = parse(text).actions;
    expect(actions.index.scope.source).toBe(sources.scope.replaceAll('\t', '  '));
    expect(actions.store.calculate.source).toBe('({ input }) => {\n  return { ...input };\n}');
    expect(actions.store.stages.authorize.hooks.action.source).toBe(
      sources.authorize.replaceAll('\t', '  '),
    );
    expect(actions.store.stages.save.hooks.action.source).toBe(sources.save.replaceAll('\t', '  '));
  });

  test('stages shaped by a hook say so; calculate shows its source and writes', () => {
    const text = additionReview();
    expect(text).toContain("    calculate: the input's writable columns # from: schema, action\n");
    const store = parse(text).actions.store;
    expect(store.calculate).toEqual({
      source: '({ input }) => ({ result: input.a + input.b })',
      writes: ['result'],
    });
    expect(store.reply).toEqual({ status: 201, body: 'the record' });
  });

  test('a scoped index shows its scope, and its load says the action shaped it (D22)', () => {
    const orders = blend(shop.orders, {
      policy: allow.authenticated,
      actions: (a) => [
        a.index({ scope: ({ auth }) => ({ user_id: (auth as { id: number } | null)?.id }) }),
      ],
    });
    const scoped = reviewResource(orders, defineApp({}));
    const source = '({ auth }) => ({ user_id: auth?.id })';
    const text = emitReview({
      review: scoped,
      scopes: new Map([['index', { source, keys: ['user_id'] }]]),
      source: 'blends/orders.ts',
    });
    expect(text).toContain(
      'load: a filtered, sorted page of rows that are not soft-deleted # from: schema, action',
    );
    expect(parse(text).actions.index.scope).toEqual({ source, columns: ['user_id'] });
    const unread = emitReview({ review: scoped, source: 'blends/orders.ts' });
    expect(parse(unread).actions.index.scope).toBe(
      'not read: write scope inline in the blend file',
    );
  });

  test('a composite key: the route shows one segment per column, and a member action still writes (D33)', () => {
    const items = blend(kitchen.order_items, {
      policy: allow.public,
      actions: (a) => [a.show(), a.member('relabel'), a.collection('count')],
    });
    const { actions } = parse(
      emitReview({ review: reviewResource(items, defineApp({})), source: 'blends/order_items.ts' }),
    );
    expect(actions.show.route).toBe('GET /order_items/:order_id/:line');
    expect(actions.relabel.route).toBe('POST /order_items/:order_id/:line/relabel');
    expect(actions.relabel.calculate).toEqual({ writes: [] });
    expect(actions.count.calculate).toEqual({ returns: [] });
  });

  test('replace lists the columns it resets, one line per kind (D34)', () => {
    const orders = blend(shop.orders, { policy: allow.public, actions: (a) => [a.replace()] });
    const text = emitReview({
      review: reviewResource(orders, defineApp({})),
      source: 'blends/orders.ts',
    });
    expect(text).toContain(
      '    resets:\n      to_default: [status, quantity, public_id]\n      to_null: [tags, meta, placed_on]\n',
    );
    expect(parse(text).actions.replace.route).toBe('PUT /orders/:id');
  });

  test('an action that reveals hidden columns lists them, and its reply says so (D24)', () => {
    const users = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [a.store({ reveal: ['password'] }), a.show()],
    });
    const text = emitReview({
      review: reviewResource(users, defineApp({})),
      source: 'blends/users.ts',
    });
    expect(text).toContain('reveals: [password]');
    const { actions } = parse(text);
    expect(actions.store.reveals).toEqual(['password']);
    expect(actions.store.reply).toEqual({ status: 201, body: 'the record, with password' });
    expect(actions.show.reveals).toBeUndefined();
  });

  test('hidden columns, resource hooks, and a default calculate', () => {
    const users = blend(shop.users, {
      policy: allow.when(({ auth }) => auth !== null, { description: 'signed-in users' }),
      hidden: ['password'],
      hooks: { authorize: ({ prev }) => prev },
      actions: (a) => [a.store(), a.show()],
    });
    const text = emitReview({
      review: reviewResource(users, defineApp({})),
      source: 'blends/users.ts',
    });
    expect(text).toStartWith('# Generated by `blendx review`.');
    expect(text).toContain('\nhidden: [password]\n');
    const parsed = parse(text);
    expect(parsed.format).toBe(1);
    expect(parsed.record.password).toBeUndefined();
    expect(parsed.actions.store.stages.authorize).toEqual({
      default: 'signed-in users',
      limitation: 'Custom hooks can change this policy decision.',
      hooks: {
        resource: {
          file: 'blends/users.ts',
          source: 'not read: write the authorize hook inline in this file',
        },
      },
    });
    expect(parsed.actions.store.calculate).toEqual({
      writes: ['display_name', 'email', 'is_active', 'password'],
    });
    expect(parsed.actions.show.calculate).toBeUndefined();
  });

  test('custom authorize and save stages name their source files and limit the default', () => {
    const users = blend(shop.users, {
      policy: allow.public,
      hooks: { authorize: ({ prev }) => prev },
      actions: (a) => [
        a.store({
          authorize: ({ prev }) => prev,
          save: async ({ runDefault }) => runDefault(),
          writes: [shop.orders],
        }),
      ],
    });
    const app = defineApp({ hooks: { authorize: ({ prev }) => prev } });
    const text = emitReview({
      review: reviewResource(users, app),
      source: 'blends/users.ts',
      appSource: 'src/app.ts',
      stageHooks: {
        app: new Map([['authorize', { source: '({ prev }) => prev' }]]),
        resource: new Map([['authorize', { source: '({ prev }) => prev' }]]),
        action: new Map([
          [
            'store',
            new Map([
              ['authorize', { source: '({ prev }) => prev' }],
              ['save', { source: 'async ({ runDefault }) => runDefault()' }],
            ]),
          ],
        ]),
      },
    });
    expect(text).toContain('            source: |-\n              ({ prev }) => prev\n');
    const stages = parse(text).actions.store.stages;
    expect(stages.authorize).toEqual({
      default: 'public',
      limitation: 'Custom hooks can change this policy decision.',
      hooks: {
        app: { file: 'src/app.ts', source: '({ prev }) => prev' },
        resource: { file: 'blends/users.ts', source: '({ prev }) => prev' },
        action: { file: 'blends/users.ts', source: '({ prev }) => prev' },
      },
    });
    expect(stages.save).toEqual({
      default: 'insert, setting created_at and updated_at',
      limitation: 'A custom save hook controls persistence and may not call this default.',
      hooks: {
        action: { file: 'blends/users.ts', source: 'async ({ runDefault }) => runDefault()' },
      },
      writes: ['orders'],
    });
  });

  test('declared related writes make save explicit without a local save hook', () => {
    const users = blend(shop.users, {
      policy: allow.public,
      actions: (a) => [a.store({ writes: [shop.orders] }), a.show()],
    });
    const stages = parse(
      emitReview({ review: reviewResource(users, defineApp({})), source: 'blends/users.ts' }),
    ).actions.store.stages;
    expect(stages.save).toEqual({
      default: 'insert, setting created_at and updated_at',
      limitation: 'Declared related-table writes occur outside this default.',
      writes: ['orders'],
    });
    expect(
      parse(emitReview({ review: reviewResource(users, defineApp({})), source: 'blends/users.ts' }))
        .actions.show.stages.save,
    ).toBe('nothing');
  });

  test('member authorization emits its complete membership contract', () => {
    const tasks = blend(membership.tasks, {
      policy: allow.member({
        via: ['project'],
        through: { model: membership.project_members, member: 'user_id' },
        related: {
          section_id: { via: ['project'] },
          assignee_id: { member: true },
        },
      }),
      actions: (a) => [a.index(), a.store(), a.show(), a.update({ authorize: ({ prev }) => prev })],
    });
    const text = emitReview({
      review: reviewResource(tasks, defineApp({})),
      source: 'blends/tasks.ts',
      stageHooks: {
        action: new Map([['update', new Map([['authorize', { source: '({ prev }) => prev' }]])]]),
      },
    });

    expect(text).toContain('        via: [project]');
    const stages = parse(text).actions;
    expect(stages.index.stages.authorize).toEqual({
      default: 'member',
      membership: {
        root: 'member_projects',
        via: ['project'],
        through: { model: 'member_project_members', member: 'user_id' },
        auth_key: 'id',
        related: { section_id: { via: ['project'] }, assignee_id: { member: true } },
      },
    });
    expect(stages.update.stages.authorize).toEqual({
      ...stages.index.stages.authorize,
      limitation: 'Custom hooks can change this policy decision.',
      hooks: {
        action: { file: 'blends/tasks.ts', source: '({ prev }) => prev' },
      },
    });
  });
  test('after is listed where a hook sets it, between save and respond (D26)', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.show(), a.update({ after: () => {} })],
    });
    const text = emitReview({
      review: reviewResource(orders, defineApp({})),
      source: 'blends/orders.ts',
    });
    expect(text).toContain('    after: nothing # from: schema, action\n');
    const { actions } = parse(text);
    expect(Object.keys(actions.update.stages)).toEqual([
      ...['rules', 'load', 'authorize', 'calculate', 'save', 'after', 'respond'],
    ]);
    expect(actions.show.stages).not.toHaveProperty('after');
  });

  test("a resource's includes follow its record (D28)", () => {
    const users = blend(shop.users, {
      policy: allow.public,
      hidden: ['password'],
      actions: (a) => [a.show()],
    });
    const notes = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.show()] });
    const orders = blend(shop.orders, {
      policy: allow.public,
      includes: { user: users, notes: { blend: notes, limit: 3, sort: '-id' } },
      actions: (a) => [a.show()],
    });
    const parsed = parse(
      emitReview({ review: reviewResource(orders, defineApp({})), source: 'blends/orders.ts' }),
    );
    expect(Object.keys(parsed)).toEqual([
      ...['format', 'resource', 'source', 'record', 'includes', 'actions'],
    ]);
    expect(parsed.includes).toEqual({
      user: `users, through its show: ${users.policies.show?.description}`,
      notes: 'order_notes, at most 3, by id descending, through its show: public',
    });
  });

  test('later is listed where a hook sets it, between save and after (D27)', () => {
    const orders = blend(shop.orders, {
      policy: allow.public,
      actions: (a) => [a.update({ later: () => {}, after: () => {} })],
    });
    const text = emitReview({
      review: reviewResource(orders, defineApp({})),
      source: 'blends/orders.ts',
    });
    expect(text).toContain('    later: nothing # from: schema, action\n');
    expect(Object.keys(parse(text).actions.update.stages)).toEqual([
      ...['rules', 'load', 'authorize', 'calculate', 'save', 'later', 'after', 'respond'],
    ]);
  });
});

describe('emitAppReview', () => {
  test('renders typed app metadata in a separate generated artifact (D37)', () => {
    const app = defineApp({
      actions: (a) => [
        a.action('health', {
          method: 'get',
          path: '/health',
          policy: allow.public,
          input: z.object({}),
          reply: { status: 200, body: z.object({ ok: z.literal(true) }) },
          handler: () => ({ status: 200, body: { ok: true as const } }),
        }),
      ],
    });
    const text = emitAppReview({ review: reviewAppActions(app), source: 'src/app.ts' });
    expect(parse(text)).toEqual({
      format: 1,
      app_actions: true,
      source: 'src/app.ts',
      actions: {
        health: {
          route: 'GET /health',
          policy: 'public',
          writes: [],
          reply: { status: 200, body: { ok: 'exactly true' } },
          errors: [422],
        },
      },
    });
    expect(text).toContain('writes: []');
    expect(text).toContain('errors: [422]');
  });
});
