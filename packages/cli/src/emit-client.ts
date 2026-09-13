/**
 * Emits client.gen.ts: every action's method and path, by table and action name (D25). A typed
 * client calls an action by name through it: a custom action's method, and whether it acts on
 * a record or the collection, are in its blend, and AppType only has routes. The file imports
 * nothing, so a web app loads it without loading the server. Order follows routes.gen.ts.
 */
import { type Resource, toEndpoints } from '@blendx/core';
import { byCodeUnit, HEADER, routeOf } from './emit-routes.ts';

const str = (value: string) => JSON.stringify(value);

/** An object literal with one `"key": value` line per entry, indented for its depth. */
function object(entries: readonly (readonly [string, string])[], depth: number): string {
  if (entries.length === 0) return '{}';
  const indent = '  '.repeat(depth);
  const lines = entries.map(([key, value]) => `${indent}  ${str(key)}: ${value},`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** Emits client.gen.ts for the app's blends. Output is deterministic. */
export function emitClient(resources: readonly Resource[]): string {
  const tables = [...resources]
    .sort((a, b) => byCodeUnit(a.model.name, b.model.name))
    .map((resource) => {
      const actions = toEndpoints(resource).map(
        (endpoint) => [endpoint.action, str(routeOf(endpoint))] as const,
      );
      return [resource.model.name, object(actions, 1)] as const;
    });
  const note = '// Each action: "METHOD /path". Imports nothing, so a web app can load it.';
  return `${HEADER}\n${note}\n\nexport const endpoints = ${object(tables, 0)} as const;\n`;
}
