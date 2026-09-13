# Review format

`blendx review` writes `review/<resource>.yaml` for every blend: what each action does, derived from the code, so a human can check the behaviour without reading TypeScript. Beside it, `review/<resource>.examples.yaml` belongs to the humans: concrete inputs and what must come out of them. Until P12.1 moves it here, the exact layout of both files is recorded in `docs/decisions.md` (the D9 notes for P10.1, P10.3 and P10.5).

## The fix-request workflow

Editing the review file does not change behaviour. It is how a human asks for a change:

1. A reviewer reads `review/<resource>.yaml` and edits it to say what should be different, for example `authorize: authenticated` on `destroy`. Or they add an example to `review/<resource>.examples.yaml` with the output they expect.
2. `blendx review --check` now fails. An edit to the YAML shows as a unified diff: the `-` lines are what the reviewer asked for, the `+` lines are what the code does. A new example fails with one line naming what calculate wrote and what was expected.
3. The blend is changed, by a developer or an AI agent, never the YAML: a policy, a rule, a hook or a calculate. `blendx generate` then refreshes the generated files.
4. When the change reproduces the reviewer's edit exactly, `blendx review --check` passes and the reviewer's file is untouched. When the change also moves lines the reviewer did not write, such as a calculate's source, `blendx review` rewrites the file and the check passes.

`packages/cli/test/fix-request.test.ts` runs both paths on a copy of `examples/addition`.
