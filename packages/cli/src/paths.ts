import { relative, sep } from 'node:path';

/**
 * `target` relative to the folder `from`, always starting with ./ or ../ and using /.
 * Generated files use it for import specifiers and drizzle-kit paths.
 */
export function relativeTo(from: string, target: string): string {
  const path = relative(from, target).split(sep).join('/');
  return path === '..' || path.startsWith('../') ? path : `./${path}`;
}
