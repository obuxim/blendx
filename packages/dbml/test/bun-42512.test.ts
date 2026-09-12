/**
 * Tracks oven-sh/bun#42512: on Bun's main thread, a `message` listener on globalThis
 * keeps the process alive forever. loadDbmlCore() works around it for @dbml/core.
 */
import { describe, expect, test } from 'bun:test';

const repoRoot = `${import.meta.dir}/../../..`;

/** Runs `code` in a fresh Bun process; returns its exit code, or null if it was still running after `ms`. */
async function exitCodeWithin(ms: number, code: string): Promise<number | null> {
  const child = Bun.spawn([process.execPath, '-e', code], {
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  let timer: Timer | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const result = await Promise.race([child.exited, timeout]);
  clearTimeout(timer);
  if (result === null) {
    child.kill();
    await child.exited;
  }
  return result;
}

describe('oven-sh/bun#42512', () => {
  test('still present: a main-thread message listener keeps Bun alive', async () => {
    // If this fails, Bun fixed #42512: delete the workaround in src/dbml-core.ts and this test.
    expect(
      await exitCodeWithin(1000, "globalThis.addEventListener('message', () => {})"),
    ).toBeNull();
  });

  test('loadDbmlCore() parses and lets the process exit on its own', async () => {
    const code = `
      const { loadDbmlCore } = await import('@blendx/dbml');
      const { Parser } = await loadDbmlCore();
      const db = Parser.parse('Table a {\\n  id int [pk]\\n}', 'dbmlv2');
      if (db.schemas[0].tables[0].name !== 'a') process.exit(2);
    `;
    expect(await exitCodeWithin(10_000, code)).toBe(0);
  }, 15_000);
});
