/**
 * P7.1: routes.gen.ts. The golden is typechecked by tsc (test/types/routes.types.test.ts
 * reads its AppType) and loaded here, so its route order is checked at runtime too.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { allow, blend, type Resource } from '@blendx/core';
import { models } from '../../dbml/test/golden/shop.schema.gen.ts';
import { type BlendModule, emitRoutes } from '../src/emit-routes.ts';
import orderNotes from './fixtures/shop/blends/order_notes.ts';
import orders from './fixtures/shop/blends/orders.ts';
import users from './fixtures/shop/blends/users.ts';
import { expectGolden } from './support/golden.ts';

const fixture = (name: string) => `../fixtures/shop/blends/${name}.ts`;

// Not in table order, to show the emitter sorts.
const shop: BlendModule[] = [
  { specifier: fixture('users'), resource: users },
  { specifier: fixture('orders'), resource: orders },
  { specifier: fixture('order_notes'), resource: orderNotes },
];

describe('emitRoutes', () => {
  test('shop fixture', async () => {
    await expectGolden(join(import.meta.dir, 'golden', 'routes.gen.ts'), emitRoutes(shop));
  });

  test('tables sort by name; collection routes come before /:id', async () => {
    const { routes } = await import('./golden/routes.gen.ts');
    // Each route registers two handlers (validator and controller); keep one line per route.
    const lines = routes.routes.map((route) => `${route.method} ${route.path}`);
    expect(lines.filter((line, i) => line !== lines[i - 1])).toEqual([
      'GET /order_notes',
      'POST /order_notes',
      'GET /order_notes/:id',
      'GET /orders',
      'POST /orders',
      'GET /orders/quote',
      'GET /orders/:id',
      'PATCH /orders/:id',
      'DELETE /orders/:id',
      'POST /orders/:id/restore',
      'POST /orders/:id/refund',
      'POST /users',
      'GET /users/:id',
      'PATCH /users/:id',
    ]);
  });

  test('routes.gen.ts exports every blend as resources, for the outbox worker (D27)', async () => {
    const { resources } = await import('./golden/routes.gen.ts');
    expect(resources.map((resource) => resource.model.name)).toEqual([
      'order_notes',
      'orders',
      'users',
    ]);
  });

  test('no blends: an empty router that still exports AppType', () => {
    const output = emitRoutes([]);
    expect(output).toContain('export const routes = router();');
    expect(output).toContain('export type AppType = typeof routes;');
  });

  test('a table named like a reserved word or an import gets a suffixed binding', () => {
    const renamed = { ...orders, model: { ...orders.model, name: 'run' } } as unknown as Resource;
    const output = emitRoutes([{ specifier: './run.ts', resource: renamed }]);
    expect(output).toContain('import run_ from "./run.ts";');
    expect(output).toContain('.get("/run", ...run(run_, "index"))');
  });

  test('two blends of one table are refused', () => {
    expect(() =>
      emitRoutes([
        { specifier: './a.ts', resource: orders },
        { specifier: './b.ts', resource: orders },
      ]),
    ).toThrow('./a.ts and ./b.ts both blend orders');
  });

  test('two actions on one method and path are refused', () => {
    const clashing = blend(models.orders, {
      policy: allow.public,
      actions: (a) => [
        a.collection('quote', { method: 'get' }),
        a.collection('estimate', { method: 'get', path: 'quote' }),
      ],
    });
    expect(() => emitRoutes([{ specifier: './orders.ts', resource: clashing }])).toThrow(
      'orders.estimate and orders.quote both route GET /orders/quote',
    );
  });
});
