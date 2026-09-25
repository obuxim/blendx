/**
 * Emits client.gen.ts: every table's actions, each as its method and path, what the table
 * includes (D25, and its N.8 note), and the columns of its primary key (D30, D33). A typed client calls an action
 * by name through it: a custom action's method, and whether it acts on a record or the
 * collection, are in its blend, and AppType only has routes. The includes let a write to one
 * table refetch the queries of the tables that include it, and the key lets an optimistic
 * update find the row. The file imports nothing, so a web app loads it without loading the
 * server. Order follows routes.gen.ts.
 */
import { type App, indexSorts, type Resource, resolveIncludes, toEndpoints } from '@blendx/core';
import { byCodeUnit, HEADER, routeOf } from './emit-routes.ts';

const str = (value: string) => JSON.stringify(value);

/**
 * The primary key's columns in the key's order, one for most tables and several for a composite
 * key (D33), each with whether its values are numbers or strings in JSON (D30).
 */
function keyOf(resource: Resource): string {
  const { model } = resource;
  if (model.meta.primaryKey.length === 0) throw new Error(`${model.name} has no primary key`);
  // A Drizzle table carries its columns as properties, each with its data type: the JS type
  // first, then the SQL one, as in `number int53` or `string uuid`.
  const columns = model.table as unknown as Record<string, { dataType?: string } | undefined>;
  const entries = model.meta.primaryKey.map((column) => {
    const [js] = (columns[column]?.dataType ?? '').split(' ');
    const type = js === 'number' || js === 'bigint' ? 'number' : 'string';
    return `{ "column": ${str(column)}, "type": ${str(type)} }`;
  });
  return `[${entries.join(', ')}]`;
}

/** An object literal with one `"key": value` line per entry, indented for its depth. */
function object(entries: readonly (readonly [string, string])[], depth: number): string {
  if (entries.length === 0) return '{}';
  const indent = '  '.repeat(depth);
  const lines = entries.map(([key, value]) => `${indent}  ${str(key)}: ${value},`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** Emits client.gen.ts for the app's blends. Output is deterministic. */
export function emitClient(resources: readonly Resource[], app: App): string {
  const tables = [...resources]
    .sort((a, b) => byCodeUnit(a.model.name, b.model.name))
    .map((resource) => {
      const actions = toEndpoints(resource).map((endpoint) => {
        const defaultIndex =
          endpoint.builtin &&
          endpoint.action === 'index' &&
          !app.spec.hooks?.rules &&
          !endpoint.resourceHooks.rules &&
          !endpoint.hooks.rules;
        return [
          endpoint.action,
          object(
            [
              ['route', str(routeOf(endpoint))],
              ['writes', JSON.stringify(endpoint.writes)],
              ...(defaultIndex
                ? [['sorts', JSON.stringify(indexSorts(endpoint.model, endpoint.hidden))] as const]
                : []),
            ],
            3,
          ),
        ] as const;
      });
      const includes = Object.entries(resolveIncludes(resource))
        .map(([name, { target }]) => [name, str(target.model.name)] as const)
        .sort(([a], [b]) => byCodeUnit(a, b));
      const table = object(
        [
          ['actions', object(actions, 2)],
          ['includes', object(includes, 2)],
          ['key', keyOf(resource)],
        ],
        1,
      );
      return [resource.model.name, table] as const;
    });
  const note =
    '// Each table: its actions with their route, declared related writes and default index sort values, the tables its includes point to, and the\n' +
    '// columns of its primary key. appActions describes app-owned domain actions. Imports nothing, so a web app can load it.';
  const appActions = [...app.actions]
    .sort((a, b) => byCodeUnit(a.name, b.name))
    .map(
      (action) =>
        [
          action.name,
          object(
            [
              ['route', str(`${action.method.toUpperCase()} ${action.path}`)],
              ['writes', JSON.stringify(action.writes)],
            ],
            1,
          ),
        ] as const,
    );
  return `${HEADER}\n${note}\n\nexport const tables = ${object(tables, 0)} as const;\n\nexport const appActions = ${object(appActions, 0)} as const;\n`;
}
