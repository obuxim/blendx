import { expect } from 'bun:test';

/** Compares with the committed golden file. Missing goldens are written once (never on CI). */
export async function expectGolden(path: string, actual: string) {
  if (process.env.UPDATE_GOLDEN === '1' || (!(await Bun.file(path).exists()) && !process.env.CI)) {
    await Bun.write(path, actual);
  }
  // A fresh handle: a BunFile that was checked before the write can return stale content.
  expect(actual).toBe(await Bun.file(path).text());
}
