# Blendx improvement suggestions from Ledgerline

Tested with `blendx`, `@blendx/cli`, and `@blendx/react` 0.1.0 on Bun 1.4.2.

## Clarify or expand `blendx/drizzle` helper exports

**Observed:** While writing an expense `save` hook that checks whether a project is archived, I imported `eq` from `blendx/drizzle`. `bun run generate` failed with `SyntaxError: Export named 'eq' not found`, and TypeScript reported that the module has no exported member `eq`. The package currently exports `sql` and `drizzle-orm/pg-core`, but not Drizzle's comparison helpers.

**Expected developer experience:** A save-hook author using the Blendx-pinned Drizzle entry point can discover which query helpers are supported without a failed generation run.

**Impact:** This interrupted generation while implementing a routine related-table check. The module name and its goal of keeping apps on Blendx's Drizzle version made `eq` a plausible import.

**Workaround used:** Import `sql` from `blendx/drizzle` and use an SQL template in the `where` call, as shown in the [hooks guide](https://blendx.zubairhasan.com/docs/hooks/).

**Suggestion:** Re-export common query operators such as `eq` from the pinned Drizzle version, or add an explicit `blendx/drizzle` export list and a related-table query example to the docs. Either would make the supported path clear before generation.

No other reproducible Blendx framework issue was encountered in this implementation. Local port conflicts and the initial absence of project tests were environment and project setup issues, so they are not listed as framework defects.
