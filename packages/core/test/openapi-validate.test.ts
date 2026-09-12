/**
 * P9.2: the generated document is valid OpenAPI 3.1, as @readme/openapi-parser checks it
 * (the OpenAPI schema plus its semantic rules, such as path parameters being declared).
 */
import { describe, expect, test } from 'bun:test';
import { defineApp } from '@blendx/core';
import { compileErrors, validate } from '@readme/openapi-parser';
import { buildOpenApi, type JsonObject } from '../src/openapi.ts';
import { info, resources } from './support/shop-openapi.ts';

const { document } = buildOpenApi({ app: defineApp({}), resources, info });

/** The parser may resolve references in place, so it gets its own copy. */
const check = (candidate: JsonObject) => validate(structuredClone(candidate) as never);

describe('generated OpenAPI', () => {
  test('the shop document is valid OpenAPI 3.1, with no warnings', async () => {
    const result = await check(document);
    expect(result.valid ? '' : compileErrors(result)).toBe('');
    expect(result.warnings).toEqual([]);
  });

  test('the validator does catch a broken document', async () => {
    const broken = structuredClone(document);
    const responses = (broken.paths as Record<string, Record<string, JsonObject>>)['/users/{id}']
      ?.get?.responses as Record<string, JsonObject>;
    delete responses['200']?.description;
    expect((await check(broken)).valid).toBe(false);
  });
});
