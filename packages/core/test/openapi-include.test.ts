/**
 * P16.9 (D28): includes in OpenAPI. index and show list `include` as a query parameter, and give
 * each include in their reply as the target's record component, or null. P16.13 (D31): a
 * has-many include is an array of the target's record component. P16.15 (D32): an included
 * record with includes of its own is inlined, with them as optional properties.
 */
import { expect, test } from 'bun:test';
import { allow, blend, defineApp } from '@blendx/core';
import { models as shop } from '../../dbml/test/golden/shop.schema.gen.ts';
import { buildOpenApi, type JsonObject } from '../src/openapi.ts';

const at = (value: unknown, ...keys: string[]): JsonObject =>
  keys.reduce((node, key) => (node as JsonObject)[key], value) as JsonObject;
const json = (reply: JsonObject) => at(reply, 'responses', '200', 'content', 'application/json');

const users = blend(shop.users, {
  policy: allow.authenticated,
  hidden: ['password'],
  actions: (a) => [a.show()],
});
const notes = blend(shop.order_notes, { policy: allow.public, actions: (a) => [a.show()] });
const orders = blend(shop.orders, {
  policy: allow.public,
  includes: { user: users, notes: { blend: notes, limit: 5 } },
  actions: (a) => [a.index(), a.show(), a.update()],
});

test('index and show take include, and give each include as its record or null', () => {
  // users is included but not served here: its record still gets a component.
  const { document } = buildOpenApi({
    app: defineApp({}),
    resources: [orders],
    info: { title: 'Shop', version: '1.0.0' },
  });
  const user = { anyOf: [{ $ref: '#/components/schemas/users' }, { type: 'null' }] };
  // D31: a has-many include is an array of the target's record, never null.
  const notesOf = { type: 'array', items: { $ref: '#/components/schemas/order_notes' } };

  const show = at(document, 'paths', '/orders/{id}', 'get');
  const parameter = (show.parameters as JsonObject[]).find((p) => p.name === 'include');
  expect(parameter).toMatchObject({ in: 'query', required: false, schema: { type: 'string' } });
  expect(at(json(show), 'schema', 'properties', 'user')).toEqual(user);
  expect(at(json(show), 'schema', 'properties', 'notes')).toEqual(notesOf);

  const index = at(document, 'paths', '/orders', 'get');
  expect(at(json(index), 'schema', 'properties', 'data', 'items', 'properties', 'user')).toEqual(
    user,
  );
  expect(at(json(index), 'schema', 'properties', 'data', 'items', 'properties', 'notes')).toEqual(
    notesOf,
  );
  expect(at(document, 'components', 'schemas', 'order_notes', 'properties')).toHaveProperty('body');

  // Other replies keep the plain record component.
  const update = at(document, 'paths', '/orders/{id}', 'patch');
  expect(at(json(update), 'schema')).toEqual({ $ref: '#/components/schemas/orders' });
  const record = at(document, 'components', 'schemas', 'users', 'properties');
  expect(Object.keys(record)).not.toContain('password');
});

test('an included record with includes of its own is inlined with them, and every path has its component (D32)', () => {
  const notesWithOrder = blend(shop.order_notes, {
    policy: allow.public,
    includes: { order: orders },
    actions: (a) => [a.index(), a.show()],
  });
  const { document } = buildOpenApi({
    app: defineApp({}),
    resources: [notesWithOrder],
    info: { title: 'Shop', version: '1.0.0' },
  });
  const show = at(document, 'paths', '/order_notes/{id}', 'get');
  const parameter = (show.parameters as JsonObject[]).find((p) => p.name === 'include');
  expect(parameter).toMatchObject({
    schema: { type: 'string', description: 'comma-separated, of: order, order.user, order.notes' },
  });
  // The order is inlined, since it has includes of its own; its includes are optional properties.
  const order = at(json(show), 'schema', 'properties', 'order');
  expect(order.anyOf).toHaveLength(2);
  const [inlined = {}, nothing] = order.anyOf as JsonObject[];
  expect(nothing).toEqual({ type: 'null' });
  expect(at(inlined, 'properties', 'status')).toMatchObject({
    enum: ['pending', 'paid', 'refunded'],
  });
  expect(at(inlined, 'properties', 'user')).toEqual({
    anyOf: [{ $ref: '#/components/schemas/users' }, { type: 'null' }],
  });
  expect(at(inlined, 'properties', 'notes')).toEqual({
    type: 'array',
    items: { $ref: '#/components/schemas/order_notes' },
  });
  expect(inlined.required).not.toContain('user');
  expect(inlined.required).not.toContain('notes');
  // The leaves of every path have a component, though only order_notes is served here.
  expect(Object.keys(at(document, 'components', 'schemas'))).toEqual(
    expect.arrayContaining(['order_notes', 'orders', 'users']),
  );
  const index = at(document, 'paths', '/order_notes', 'get');
  expect(
    at(json(index), 'schema', 'properties', 'data', 'items', 'properties', 'order', 'anyOf'),
  ).toHaveLength(2);
});
