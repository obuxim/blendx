/**
 * The pure parts of the upgrade check (docs/releasing.md, the release gate): which tag is the
 * previous release, how an app's manifest moves to the new packages, and which files an
 * upgrade rewrote. `scripts/upgrade-check.ts` runs them; `scripts/upgrade.test.ts` pins them.
 */

export interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  [key: string]: unknown;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** A version as comparable parts, or undefined for a tag that is not a release. */
function parse(tag: string): [number, number, number, string] | undefined {
  const match = SEMVER.exec(tag);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ''];
}

function compare(a: [number, number, number, string], b: [number, number, number, string]) {
  for (const index of [0, 1, 2] as const) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  // A release outranks its pre-releases; two pre-releases compare as strings.
  if (a[3] === b[3]) return 0;
  if (a[3] === '') return 1;
  if (b[3] === '') return -1;
  return a[3] < b[3] ? -1 : 1;
}

/**
 * The release before `current` among `tags`: the highest release tag whose version is below
 * it. Tags that are not `v<semver>` are ignored. Undefined when there is none.
 */
export function previousTag(tags: readonly string[], current: string): string | undefined {
  const target = parse(current);
  if (!target) throw new Error(`current version "${current}" is not a semver version`);
  let best: { tag: string; parts: [number, number, number, string] } | undefined;
  for (const tag of tags) {
    if (!tag.startsWith('v')) continue;
    const parts = parse(tag);
    if (!parts || compare(parts, target) >= 0) continue;
    if (!best || compare(parts, best.parts) > 0) best = { tag, parts };
  }
  return best?.tag;
}

const isBlendx = (name: string) => name === 'blendx' || name.startsWith('@blendx/');

/**
 * The app's manifest with every blendx package it names, at whatever version or `workspace:*`,
 * moved to `resolve(name)`, plus overrides so the packages' dependencies on each other resolve
 * there too, and the tooling pins the check needs (`typescript`, `@types/bun`) as dev
 * dependencies. Everything else in the manifest stays as the app had it.
 */
export function upgradeManifest(
  previous: Manifest,
  resolve: (name: string) => string,
  pins: Record<string, string>,
): Manifest {
  const move = (from: Record<string, string> | undefined) =>
    Object.fromEntries(
      Object.entries(from ?? {}).map(([name, version]) => [
        name,
        isBlendx(name) ? resolve(name) : version,
      ]),
    );
  const { overrides: _, ...rest } = previous;
  return {
    ...rest,
    name: 'blendx-upgrade-check',
    private: true,
    dependencies: move(previous.dependencies),
    devDependencies: { ...move(previous.devDependencies), ...pins },
    overrides: Object.fromEntries(
      ['@blendx/core', '@blendx/dbml', '@blendx/hono', 'blendx'].map((name) => [
        name,
        resolve(name),
      ]),
    ),
  };
}

export type Change = { path: string; status: 'changed' | 'added' | 'removed' };

/**
 * Which files differ between two snapshots (path to content), ignoring line endings: a
 * Windows checkout can hold CRLF where the generator writes LF, and that is not a change.
 */
export function changedFiles(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Change[] {
  const normal = (text: string) => text.replaceAll('\r\n', '\n');
  const changes: Change[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(path);
    const is = after.get(path);
    if (was === undefined) changes.push({ path, status: 'added' });
    else if (is === undefined) changes.push({ path, status: 'removed' });
    else if (normal(was) !== normal(is)) changes.push({ path, status: 'changed' });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
