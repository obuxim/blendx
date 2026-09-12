/**
 * The only way blendx loads @dbml/core.
 *
 * @dbml/parse (inside @dbml/core) bundles VS Code platform code that installs a
 * `message` listener on globalThis whenever `postMessage` exists. Bun defines
 * `postMessage` on the main thread, and that listener keeps the process alive
 * forever (oven-sh/bun#42512). Hiding `postMessage` during the import makes the
 * shim fall back to setTimeout. Remove the workaround once
 * test/bun-42512.test.ts reports that Bun is fixed.
 */
type DbmlCore = typeof import('@dbml/core');

let loading: Promise<DbmlCore> | undefined;

export function loadDbmlCore(): Promise<DbmlCore> {
  loading ??= importWithoutMessageShim();
  return loading;
}

async function importWithoutMessageShim(): Promise<DbmlCore> {
  const scope = globalThis as { postMessage?: unknown };
  if (typeof scope.postMessage !== 'function') return import('@dbml/core');

  const postMessage = scope.postMessage;
  scope.postMessage = undefined;
  try {
    return await import('@dbml/core');
  } finally {
    scope.postMessage = postMessage;
  }
}
