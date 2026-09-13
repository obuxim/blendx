# Cascade

Each stage of the pipeline (`pipeline.md`) has one hook, and four levels can set it: the schema default, the app (`defineApp({ hooks })`), the resource (`blend(model, { hooks })`) and the action (`a.store({ ... })`). They run in that order. Each level receives what the level above produced, so the most specific level has the last word. after is the exception: every level's hook runs (below).

Not every level can hook every stage:

| Stage | App | Resource | Action |
|---|---|---|---|
| rules | yes | yes | yes |
| load | | | yes |
| authorize | yes | yes | yes |
| calculate | | | yes |
| save | | | yes |
| later | yes | yes | yes |
| after | yes | yes | yes |
| respond | yes | yes | yes |

App and resource hooks run for many tables or actions at once, so each must return the type it receives. Load, calculate and save depend on one table's columns, so only an action sets them. after and later return nothing, so every level can set them.

Tests:
- [without hooks every stage is the schema default](../core/test/cascade.test.ts)

## Value stages: rules, authorize, calculate, respond

A value hook receives `prev`, the value so far, and returns the value to use. Ignoring `prev` replaces it, and using it extends it. A hook never mutates it.

- rules: `prev` is the rules for the action, from the schema or the level above. A plain object returned by a hook is made strict, so unknown keys are still refused; `.loose()` is the explicit way to accept them.
- authorize: `prev` is the policy's decision. App, resource and action hooks then run in that order.
- calculate: `prev` is the default writes, the input's writable columns.
- respond: each level receives the reply so far. respond hooks see only the public record.

Tests:
- [each level receives the rules of the level above: schema, app, resource, action](../core/test/cascade.test.ts)
- [an action can replace the defaults; a plain object is made strict](../core/test/cascade.test.ts)
- [the policy decides first, then app, resource and action hooks run in order](../core/test/cascade.test.ts)
- [an action extends the default writes or replaces them](../core/test/cascade.test.ts)
- [app, resource and action each receive the reply so far](../core/test/cascade.test.ts)
- [the policy sees the identity, the record, the validated input and the action](../core/test/authorize.test.ts)
- [deny refuses every request unless an explicit hook replaces its decision](../core/test/authorize.test.ts)

## Effect stages: load and save

An effect hook receives `runDefault()` instead of a value. Calling it runs the default, extending it; a save hook may pass other writes to it. Not calling it replaces the default.

Tests:
- [calling runDefault extends the default, skipping it replaces the default](../core/test/cascade.test.ts)
- [a load hook can scope the listing to the requester](../core/test/engine-load.test.ts)

## after: every level runs

after (docs/decisions.md D26) has no default to extend or replace, so no level replaces another: the app's hook runs, then the resource's, then the action's, each with the same saved row, loaded row, input, identity and database. App and resource hooks run only for actions that write, and an action that writes nothing cannot have one. What one level throws is reported, and the next level still runs (`pipeline.md`).

Tests:
- [app, resource and action after run in that order, none replacing another](../core/test/after.test.ts)
- [provenance: after counts app and resource hooks only on actions that write](../core/test/after.test.ts)
- [blend() refuses after on an action that writes nothing](../core/test/after.test.ts)

later (docs/decisions.md D27) follows the same rule, except that each level's hook becomes an outbox entry of its own, which the worker runs; the entries run in no set order.

Tests:
- [provenance: later counts app and resource hooks only on actions that write](../core/test/later.test.ts)
- [blend() refuses later on an action that writes nothing](../core/test/later.test.ts)

## Provenance

The resolved endpoint records which levels shaped each stage, the schema first. The review file shows it as a `# from:` comment on every stage that more than the schema shaped (`review-format.md`).

Tests:
- [hidden columns leave the record; resource and app hooks show in from](../core/test/review.test.ts)
- [stages shaped by a hook say so; calculate shows its source and writes](../cli/test/emit-review.test.ts)
