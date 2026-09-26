/**
 * P18.1: the pure parts of the upgrade check. The runner (`bun run upgrade:check`) is exercised
 * by CI's `upgrade` job, as the packing test is by `pack`.
 */
import { describe, expect, test } from 'bun:test';
import { changedFiles, previousTag, upgradeManifest } from './upgrade.ts';

describe('previousTag', () => {
  test('the highest release tag below the current version, whatever the tag order', () => {
    expect(previousTag(['v0.1.0', 'v0.2.0', 'v0.1.1'], '0.2.0')).toBe('v0.1.1');
    expect(previousTag(['v0.2.0', 'v0.1.0'], '0.3.0')).toBe('v0.2.0');
    expect(previousTag(['v0.9.0', 'v0.10.0'], '0.11.0')).toBe('v0.10.0');
  });

  test('the current version itself and anything above it do not count', () => {
    expect(previousTag(['v0.1.0', 'v0.2.0', 'v0.3.0'], '0.2.0')).toBe('v0.1.0');
    expect(previousTag(['v0.2.0'], '0.2.0')).toBeUndefined();
  });

  test('a pre-release is below its release, and tags that are not releases are ignored', () => {
    expect(previousTag(['v0.2.0-rc.1', 'v0.1.0'], '0.2.0')).toBe('v0.2.0-rc.1');
    expect(previousTag(['latest', 'docs-1', 'v0.1.0', '0.1.5'], '0.2.0')).toBe('v0.1.0');
  });

  test('a current version that is not semver is an error', () => {
    expect(() => previousTag(['v0.1.0'], 'main')).toThrow('not a semver version');
  });
});

describe('upgradeManifest', () => {
  const resolve = (name: string) => `file:/tarballs/${name.replace('@blendx/', 'blendx-')}.tgz`;
  const pins = { typescript: '7.0.2', '@types/bun': '1.4.2' };

  test('moves every blendx package, workspace or pinned, and keeps the rest', () => {
    const upgraded = upgradeManifest(
      {
        name: '@blendx/example-addition',
        version: '0.0.0',
        type: 'module',
        scripts: { generate: 'blendx generate' },
        dependencies: { '@electric-sql/pglite': '0.5.8', blendx: 'workspace:*', pg: '8.23.0' },
        devDependencies: { '@blendx/cli': '0.1.0', '@blendx/react': 'workspace:*' },
      },
      resolve,
      pins,
    );
    expect(upgraded.dependencies).toEqual({
      '@electric-sql/pglite': '0.5.8',
      blendx: 'file:/tarballs/blendx.tgz',
      pg: '8.23.0',
    });
    expect(upgraded.devDependencies).toEqual({
      '@blendx/cli': 'file:/tarballs/blendx-cli.tgz',
      '@blendx/react': 'file:/tarballs/blendx-react.tgz',
      typescript: '7.0.2',
      '@types/bun': '1.4.2',
    });
    expect(upgraded.scripts).toEqual({ generate: 'blendx generate' });
    expect(upgraded.type).toBe('module');
    expect(upgraded.name).toBe('blendx-upgrade-check');
    expect(upgraded.private).toBe(true);
  });

  test('overrides point the packages at each other through the tarballs', () => {
    const upgraded = upgradeManifest({ dependencies: { blendx: '0.1.0' } }, resolve, pins);
    expect(upgraded.overrides).toEqual({
      '@blendx/core': 'file:/tarballs/blendx-core.tgz',
      '@blendx/dbml': 'file:/tarballs/blendx-dbml.tgz',
      '@blendx/hono': 'file:/tarballs/blendx-hono.tgz',
      blendx: 'file:/tarballs/blendx.tgz',
    });
  });

  test('an app without dev dependencies still gets the tooling pins', () => {
    const upgraded = upgradeManifest({ dependencies: { blendx: '0.1.0' } }, resolve, pins);
    expect(upgraded.devDependencies).toEqual(pins);
  });
});

describe('changedFiles', () => {
  test('lists changed, added and removed files, sorted by path', () => {
    const before = new Map([
      ['src/generated/client.gen.ts', 'export const tables = {};\n'],
      ['src/generated/routes.gen.ts', 'export const routes = 1;\n'],
      ['review/old.yaml', 'format: 1\n'],
    ]);
    const after = new Map([
      ['src/generated/client.gen.ts', 'export const tables = {};\nexport const appActions = {};\n'],
      ['src/generated/routes.gen.ts', 'export const routes = 1;\n'],
      ['review/new.yaml', 'format: 1\n'],
    ]);
    expect(changedFiles(before, after)).toEqual([
      { path: 'review/new.yaml', status: 'added' },
      { path: 'review/old.yaml', status: 'removed' },
      { path: 'src/generated/client.gen.ts', status: 'changed' },
    ]);
  });

  test('a line-ending difference alone is not a change', () => {
    const before = new Map([['a.ts', 'one\r\ntwo\r\n']]);
    const after = new Map([['a.ts', 'one\ntwo\n']]);
    expect(changedFiles(before, after)).toEqual([]);
  });
});
