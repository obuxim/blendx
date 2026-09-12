/**
 * P9.1: the OpenAPI 3.1 builder on the shop fixture. The snapshot is the whole document as
 * openapi.json will hold it; the other tests pin the rules it follows.
 */
import { describe, expect, test } from 'bun:test';
import { defineApp } from '@blendx/core';
import { buildOpenApi, type JsonObject, stringifyOpenApi } from '../src/openapi.ts';
import { info, resources } from './support/shop-openapi.ts';

const { document, warnings } = buildOpenApi({ app: defineApp({}), resources, info });

const at = (value: unknown, ...keys: string[]): JsonObject =>
  keys.reduce((node, key) => (node as JsonObject)[key], value) as JsonObject;
const statuses = (path: string, method: string) =>
  Object.keys(at(document, 'paths', path, method, 'responses')).sort();

describe('buildOpenApi', () => {
  test('the whole document', () => {
    expect(stringifyOpenApi(document)).toMatchSnapshot();
  });

  test('OpenAPI 3.1 with info, and paths in route form with {id}', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual(info);
    expect(Object.keys(at(document, 'paths')).sort()).toEqual([
      '/order_notes',
      '/orders',
      '/orders/quote',
      '/orders/{id}',
      '/orders/{id}/refund',
      '/orders/{id}/restore',
      '/users',
      '/users/{id}',
    ]);
  });

  test('each table has a public record component without its hidden columns', () => {
    const record = at(document, 'components', 'schemas', 'users', 'properties');
    expect(Object.keys(record)).toContain('email');
    expect(Object.keys(record)).not.toContain('password');
    expect(at(document, 'components', 'schemas', 'Problem', 'required') as unknown).toEqual([
      'type',
      'title',
      'status',
    ]);
  });

  test('date columns get format date; timestamps stay plain strings', () => {
    const properties = at(document, 'components', 'schemas', 'orders', 'properties');
    expect(JSON.stringify(properties.placed_on)).toContain('"format":"date"');
    expect(JSON.stringify(properties.created_at)).not.toContain('format');
  });

  test('bodies come from the rules; GET rules become query parameters', () => {
    const store = at(document, 'paths', '/orders', 'post', 'requestBody', 'content');
    const body = at(store, 'application/json', 'schema', 'properties');
    expect(Object.keys(body)).toContain('total');
    expect(Object.keys(body)).not.toContain('id');

    const quote = at(document, 'paths', '/orders/quote', 'get').parameters as JsonObject[];
    expect(quote).toEqual([
      { name: 'quantity', in: 'query', required: true, schema: { type: 'string' } },
    ]);
    const index = at(document, 'paths', '/orders', 'get').parameters as JsonObject[];
    expect(index.map((p) => p.name)).toEqual(
      expect.arrayContaining(['page', 'per_page', 'sort', 'trashed']),
    );
    const show = at(document, 'paths', '/orders/{id}', 'get').parameters as JsonObject[];
    expect(show).toEqual([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: expect.objectContaining({ type: 'integer' }),
      },
    ]);
  });

  test('replies by action: 201 store, 204 destroy with no body, the page envelope on index', () => {
    expect(statuses('/orders', 'post')).toContain('201');
    const destroyed = at(document, 'paths', '/orders/{id}', 'delete', 'responses', '204');
    expect(destroyed).toEqual({ description: 'No content' });
    const page = at(document, 'paths', '/orders', 'get', 'responses', '200', 'content');
    expect(Object.keys(at(page, 'application/json', 'schema', 'properties'))).toEqual([
      'data',
      'meta',
    ]);
  });

  test('problem replies follow the endpoint: body, identity, policy, record, writes', () => {
    // store on orders: a body, an authenticated policy, a write.
    expect(statuses('/orders', 'post')).toEqual(['201', '400', '401', '409', '422']);
    // show on users: public, one record, no body.
    expect(statuses('/users/{id}', 'get')).toEqual(['200', '404', '422']);
    // refund: a when policy can refuse it.
    expect(statuses('/orders/{id}/refund', 'post')).toContain('403');
  });

  test('replies it cannot describe are warnings', () => {
    expect(warnings).toEqual([
      'orders.quote: the reply is what calculate returns, which has no schema',
    ]);
  });

  test('the output does not depend on the order of the resources', () => {
    const reversed = buildOpenApi({
      app: defineApp({}),
      resources: [...resources].reverse(),
      info,
    });
    expect(stringifyOpenApi(reversed.document)).toBe(stringifyOpenApi(document));
  });
});
