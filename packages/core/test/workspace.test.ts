import { expect, test } from 'bun:test';
import { PACKAGE as cli } from '@blendx/cli';
import { PACKAGE as conformance } from '@blendx/conformance';
import { PACKAGE as core } from '@blendx/core';
import { PACKAGE as dbml } from '@blendx/dbml';
import { PACKAGE as hono } from '@blendx/hono';
import { PACKAGE as facade } from 'blendx';

test('every workspace package resolves by name', () => {
  expect([facade, core, dbml, hono, cli, conformance]).toEqual([
    'blendx',
    '@blendx/core',
    '@blendx/dbml',
    '@blendx/hono',
    '@blendx/cli',
    '@blendx/conformance',
  ]);
});
