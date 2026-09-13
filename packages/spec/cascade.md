# Cascade

Each stage of the pipeline (`pipeline.md`) has one hook, and four levels can set it: the schema default, the app (`defineApp({ hooks })`), the resource (`blend(model, { hooks })`) and the action (`a.store({ ... })`). They run in that order. Each level receives what the level above produced, so the most specific level has the last word.

Not every level can hook every stage:

| Stage | App | Resource | Action |
|---|---|---|---|
| rules | yes | yes | yes |
| load | | | yes |
| authorize | yes | yes | yes |
| calculate | | | yes |
| save | | | yes |
| respond | yes | yes | yes |

App and resource hooks run for many tables or actions at once, so each must return the type it receives. Load, calculate and save depend on one table's columns, so only an action sets them.

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

## Provenance

The resolved endpoint records which levels shaped each stage, the schema first. The review file shows it as a `# from:` comment on every stage that more than the schema shaped (`review-format.md`).

Tests:
- [hidden columns leave the record; resource and app hooks show in from](../core/test/review.test.ts)
- [stages shaped by a hook say so; calculate shows its source and writes](../cli/test/emit-review.test.ts)
