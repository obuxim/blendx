# Releasing blendx

How a version of blendx reaches npm (docs/decisions.md D35). This page is for the maintainer; an app author installs from npm as [getting started](guide/getting-started.md#install-blendx) says.

## What is published

Six packages, always together and at one version: `blendx`, `@blendx/core`, `@blendx/hono`, `@blendx/dbml`, `@blendx/cli` and `@blendx/react`. Each tarball holds `dist/` (compiled JavaScript and declaration files), a README and the license, under a manifest derived from the workspace one: `exports` and the CLI `bin` on `dist/`, the shared version in place of `workspace:*`, no dev dependencies. The repository's own manifests stay on the sources, so nothing in the repository can be published by accident.

- `bun run build`: `dist/` for every package, in dependency order. `bun run check` runs it, since declaration emit can fail where a plain typecheck passes.
- `bun run pack <folder>`: the six tarballs, from a built tree.
- `bun run pack:test`: builds, packs, installs the tarballs into a fresh app made from `examples/addition`, and runs it on Bun and Node. CI runs it as the `pack` job.
- `bun run upgrade:check [v<previous>]`: builds, packs, and upgrades the addition example as committed at the previous release to the tarballs, then generate, review, tsc and its tests, printing what the upgrade rewrote. CI runs it as the `upgrade` job. It is step 3 of the gate below.

## Before tagging: the release gate

Nothing is tagged until all four hold. 0.2.0 went out with the first two missed, and the second release commit needed two CI fixes before the tag; this gate is the rule since.

1. **CI is green on GitHub for the exact commit that will be tagged.** A local `bun run check` is not a substitute: on Windows the path-separator tests fail and hide real failures behind them, and the Node-only checks (`smoke:node`, `conformance:node`) run only on CI. `gh run list --branch main --limit 1` shows the run; every job must pass.
2. **The public API diff since the previous tag has been read.** `git diff v<previous> HEAD -- packages/*/src` for removed or renamed exports, changed signatures, changed return types and narrowed types. Each is either reverted or written into the changelog with what a user must change. The generated files' formats and the review YAML format count too: a change there means "run `blendx generate` and `blendx review` after upgrading" in the changelog.
3. **The upgrade check is green.** `bun run upgrade:check` takes the addition example as committed at the previous release tag, with its generated files and review, moves its blendx dependencies to the six freshly packed tarballs, then runs a user's steps: `blendx generate`, `blendx review`, `tsc --noEmit`, its tests. It prints which generated and review files the upgrade rewrote; that list, and anything the user would have to change by hand, go into the changelog. CI runs it as the `upgrade` job on every push, so read that job's output for the commit being tagged. The packing test (`bun run pack:test`) covers a fresh app only, not an upgrade. The previous release defaults to the highest `v*` tag below the current version; `bun run upgrade:check v0.1.0` names another.
4. **`docs/changelog.md` has the version's entry**: what changed, what a user must do to upgrade, what breaks and how it shows. Written before the tag, from steps 2 and 3, not from memory.

## Cutting a release

1. The release gate above holds.
2. Set the version everywhere and commit it:

   ```sh
   bun run version 0.2.0
   git commit -am "Release 0.2.0"
   git push
   ```

3. Tag the commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

The `release` workflow then runs `bun run check`, fails unless the tag names the version of every package (`bun run version --check v0.2.0`), packs the six, and stages them in dependency order (dbml, core, hono, blendx, cli, react) with `npm stage publish --provenance --access public`. A package already on npm at that version is skipped, so rerunning the workflow after a partial failure stages only what is missing, and a tag for a version that was published by hand runs green. Staging uses npm's trusted publishing: the workflow proves its identity to npm with a GitHub OIDC token, so no npm token is stored in the repository, and every version carries provenance linking it to the commit and the workflow run.

4. Nothing is live yet: a staged version is not installable. Approve the six, in the same dependency order, with your 2FA, logged in to npm on your machine (`npm login`, npm 11.15 or later):

   ```sh
   npm stage list @blendx/dbml      # one line per staged version, with its stage id
   npm stage approve <stage-id>     # asks for the one-time password
   ```

   Repeat for `@blendx/core`, `@blendx/hono`, `blendx`, `@blendx/cli` and `@blendx/react`, or approve them on npmjs.com under each package's Staged Packages tab. A staged version that should not go live is dropped with `npm stage reject <stage-id>`.

To rehearse without staging, run the workflow by hand from the Actions tab with `dry_run` on: it does everything but the staging itself, and `npm stage publish --dry-run` still validates every tarball.

## Setting up npm, once

- Create the `@blendx` organisation on npm, or claim the scope for your account. The unscoped `blendx` name is free.
- Trusted publishing is configured per package, and npm only lets you configure it on a package that exists. So the first release is published by hand, from a built tree, logged in to npm:

  ```sh
  bun run check
  bun run pack tarballs
  for name in blendx-dbml blendx-core blendx-hono blendx blendx-cli blendx-react; do
    npm publish "./tarballs/$name-0.1.0.tgz" --access public
  done
  ```

- Then, on npmjs.com, open each of the six packages, Settings, Trusted publishing, and add a GitHub Actions publisher: repository `obuxim/blendx`, workflow `release.yml`, no environment. A publisher is allowed `npm stage publish`, which is all the workflow uses; direct `npm publish` is a separate box under Allowed actions that stays off, and the registry refuses it with `403 OIDC permission denied for this action`. A publisher cannot be edited afterwards; delete it and add it again. Every later release goes through the workflow.
- Keep the version in `docs/guide/getting-started.md` in step with the latest release.

This was done for 0.1.0 on 2026-09-14: the six were published by hand from this machine, the trusted publisher was added to each, and the `v0.1.0` tag was pushed afterwards, so the first workflow run published nothing and only proved the setup.
