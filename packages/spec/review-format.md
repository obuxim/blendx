# Review format

`blendx review` writes `review/<resource>.yaml` for every blend and, when the app declares typed domain actions, `review/app-actions.yaml`: what each action does, derived from the code, so a human can check the behaviour without reading TypeScript. Beside a resource review, `review/<resource>.examples.yaml` belongs to the humans: concrete inputs and what must come out of them.

## review/app-actions.yaml

The generated app-action review has `format: 1`, `app_actions: true`, and `source` for the app module. Its actions are ordered by stable action name. Each action records its route, policy description, input fields when it accepts any, declared affected `writes`, typed success `reply`, and the generated Problem Details `errors`. A `multipart()` action additionally records `input_format: multipart/form-data` and its bounded `max_bytes`; its generated errors include 413 when the request exceeds that bound. It covers an app action's route contract without presenting it as a resource pipeline.

## review/&lt;resource&gt;.yaml

The file is generated. A header comment says so, and says that an edit is a fix request (below). Its keys, in this order:

- `format: 1`, `resource` (the table), `source` (the blend file) and `hidden` (the hidden columns, when there are any).
- `record`: the fields of a record in a reply, one line each, hidden columns removed. For example `created_at: string, or null`.
- `includes`, when the blend declares any (docs/decisions.md D28): each relation `?include=` may nest, with its table and the policy of the target's show, which decides each row. For example `user: users, through its show: signed-in users`. A has-many include (D31) also says its bound and its order: `notes: order_notes, at most 2, by id descending, through its show: authenticated`. Every path a dotted include may follow through the targets' own includes (D32) gets a line of its own after the include it goes through, `notes.author: users, through its show: authenticated`, so the file lists everything a request on this resource can reach.
- `actions`, in route order, each with:
  - `route`: `POST /addition_results`.
  - `input`, when the action takes any: one line per field, described from the resolved rules. For example `a: number` or `status: one of pending, paid, refunded, optional`.
  - `stages`: one line per unchanged stage, saying what the schema level does, such as `insert, setting created_at and updated_at`. For authorize, the line is the policy. An `allow.member()` authorization is a block: `default: member` and `membership` name its root, `via` path, membership `through` model and member column, `auth_key`, and each related root or member check. A stage that more than the schema shaped carries a `# from: schema, action` comment (`cascade.md`). An overridden `authorize` or `save` stage is a block instead: `default` gives the policy or schema behavior, `limitation` says why it does not describe the custom hook, and `hooks` maps each cascading level to its `file` and readable `source`. A custom member authorization keeps its `membership` block beside those fields. A save block also lists `writes` when its action declares related tables; without a custom save hook, that declaration still makes save a block and says the writes are outside the default. Direct inline functions and methods appear as literal source blocks; a referenced, imported or spread hook keeps its file and reads `not read: write the <stage> hook inline in this file`. `later` and `after` (docs/decisions.md D27, D26) are listed only on an action where a hook sets them, between save and respond and in that order, as `later: nothing # from: schema, action`: the schema does nothing, and the comment names the levels whose hooks run. An app that sets neither has no such lines.
  - `scope`, for an index with one (docs/decisions.md D22): the function exactly as written, as a literal block, with the `columns` it scopes by. The index's load stage then carries `# from: schema, action`.
  - `calculate`, for actions that calculate: the hook exactly as written, as a literal block, with the columns it `writes` (`returns` for a collection action). Without a hook, the default's writes. Embedded hook source expands leading tabs to two-space indentation before YAML writes it, so generated reviews are deterministic and pass whitespace checks.
  - `reveals`, for an action that reveals hidden columns (docs/decisions.md D24): the columns its reply carries. Its reply body then says so: `the record, with api_token`.
  - `reply`: the status and the body, or why the reply is not described (a custom reply with no declared `reply` schema).

The output is deterministic: the same code always gives the same file, with no timestamps and no line folding.

Tests:
- [the resource, its hidden columns, and the fields of its record](../core/test/review.test.ts)
- [actions come in route order](../core/test/review.test.ts)
- [store: its input, what each stage does, and which levels changed it](../core/test/review.test.ts)
- [custom actions: a declared reply, and replies that are not described](../core/test/review.test.ts)
- [without a hook: the input keys that are writable columns, hidden ones too](../core/test/review.test.ts)
- [each property in order, marking optional fields and defaults](../core/test/json-schema.test.ts)
- [the addition example](../cli/test/emit-review.test.ts)
- [the same review twice is the same text](../cli/test/emit-review.test.ts)
- [normalizes tab-indented source blocks to spaces](../cli/test/emit-review.test.ts)
- [stages shaped by a hook say so; calculate shows its source and writes](../cli/test/emit-review.test.ts)
- [custom authorize and save stages name their source files and limit the default](../cli/test/emit-review.test.ts)
- [reads direct app, resource and action hooks exactly as written](../cli/test/calculates.test.ts)
- [a custom authorization hook changes the readable source in the review diff](../cli/test/review.test.ts)
- [a custom save hook changes the readable source in the review diff](../cli/test/review.test.ts)
- [declared related writes make save explicit without a local save hook](../cli/test/emit-review.test.ts)
- [a scoped index shows its scope, and its load says the action shaped it (D22)](../cli/test/emit-review.test.ts)
- [an action that reveals hidden columns lists them, and its reply says so (D24)](../cli/test/emit-review.test.ts)
- [the review lists what an action reveals, and its reply says so](../core/test/reveal.test.ts)
- [after is listed only where a hook sets it, with its levels](../core/test/review.test.ts)
- [after is listed where a hook sets it, between save and respond (D26)](../cli/test/emit-review.test.ts)
- [later is listed only where a hook sets it, with its levels](../core/test/review.test.ts)
- [later is listed where a hook sets it, between save and after (D27)](../cli/test/emit-review.test.ts)
- [a resource's includes name each relation's table and the policy of its show](../core/test/review.test.ts)
- [the authorization stage names the root, membership source, and related checks](../core/test/review.test.ts)
- [a resource's includes follow its record (D28)](../cli/test/emit-review.test.ts)
- [an index scope yields its source and the columns it scopes by (D22)](../cli/test/calculates.test.ts)
- [writes one file per blend](../cli/test/review.test.ts)
- [--check: an edited file and a file without a blend drift; nothing is written](../cli/test/review.test.ts)

## review/&lt;resource&gt;.examples.yaml

Human-owned. It maps action names to lists of examples. Each example gives:

- `input`, and `record` for a member action;
- then one of `writes` (what calculate must return), `returns` (the same, for a collection action) or `rejects` (the JSON pointers, or query parameters, that validation must reject);
- and optionally a `name`.

```yaml
store:
  - name: adds a and b
    input: { a: 4, b: 3 }
    writes: { result: 7 }
  - name: both numbers are required
    input: { a: 4 }
    rejects: [/b]
```

Examples run without a database, the way the engine runs the action: the resolved rules validate, calculate runs, and the result is compared as JSON. `blendx review --check` runs them, and an app's tests call `checkExamples(appRoot)` from `@blendx/cli/examples`. Each failure is one line naming the file, the action, the example and what came out against what was expected.

Tests:
- [examples that hold: writes, returns, rejects, and plain accepted input](../core/test/examples.test.ts)
- [a wrong result names what calculate wrote and what was expected](../core/test/examples.test.ts)
- [mistakes in the file itself are failures too](../core/test/examples.test.ts)
- [a failing example fails the check with a readable line; fixed, it passes](../cli/test/review.test.ts)

## The fix-request workflow

Editing the review file does not change behaviour. It is how a human asks for a change:

1. A reviewer reads `review/<resource>.yaml` and edits it to say what should be different, for example `authorize: authenticated` on `destroy`. Or they add an example to `review/<resource>.examples.yaml` with the output they expect.
2. `blendx review --check` now fails. An edit to the YAML shows as a unified diff: the `-` lines are what the reviewer asked for, the `+` lines are what the code does. A new example fails with one line naming what calculate wrote and what was expected.
3. The blend is changed, by a developer or an AI agent, never the YAML: a policy, a rule, a hook or a calculate. `blendx generate` then refreshes the generated files.
4. When the change reproduces the reviewer's edit exactly, `blendx review --check` passes and the reviewer's file is untouched. When the change also moves lines the reviewer did not write, such as a calculate's source, `blendx review` rewrites the file and the check passes.

Tests:
- [an edit to the review YAML fails the check until the blend does what it says](../cli/test/fix-request.test.ts)
- [a new example fails the check until calculate produces it; then review rewrites](../cli/test/fix-request.test.ts)
