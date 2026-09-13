/**
 * P16.9 (D28): includes in OpenAPI. index and show list `include` as a query parameter, and give
 * each include in their reply as the target's record component, or null.
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
const orders = blend(shop.orders, {
  policy: allow.public,
  includes: { user: users },
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

  const show = at(document, 'paths', '/orders/{id}', 'get');
  const parameter = (show.parameters as JsonObject[]).find((p) => p.name === 'include');
  expect(parameter).toMatchObject({ in: 'query', required: false, schema: { type: 'string' } });
  expect(at(json(show), 'schema', 'properties', 'user')).toEqual(user);

  const index = at(document, 'paths', '/orders', 'get');
  expect(at(json(index), 'schema', 'properties', 'data', 'items', 'properties', 'user')).toEqual(
    user,
  );

  // Other replies keep the plain record component.
  const update = at(document, 'paths', '/orders/{id}', 'patch');
  expect(at(json(update), 'schema')).toEqual({ $ref: '#/components/schemas/orders' });
  const record = at(document, 'components', 'schemas', 'users', 'properties');
  expect(Object.keys(record)).not.toContain('password');
});
