# Releasing blendx

How a version of blendx reaches npm (docs/decisions.md D35). This page is for the maintainer; an app author installs from npm as [getting started](guide/getting-started.md#install-blendx) says.

## What is published

Six packages, always together and at one version: `blendx`, `@blendx/core`, `@blendx/hono`, `@blendx/dbml`, `@blendx/cli` and `@blendx/react`. Each tarball holds `dist/` (compiled JavaScript and declaration files), a README and the license, under a manifest derived from the workspace one: `exports` and the CLI `bin` on `dist/`, the shared version in place of `workspace:*`, no dev dependencies. The repository's own manifests stay on the sources, so nothing in the repository can be published by accident.

- `bun run build`: `dist/` for every package, in dependency order. `bun run check` runs it, since declaration emit can fail where a plain typecheck passes.
- `bun run pack <folder>`: the six tarballs, from a built tree.
- `bun run pack:test`: builds, packs, installs the tarballs into a fresh app made from `examples/addition`, and runs it on Bun and Node. CI runs it as the `pack` job.

## Cutting a release

1. Make sure `main` is green.
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

The `release` workflow then runs `bun run check`, fails unless the tag names the version of every package (`bun run version --check v0.2.0`), packs the six, and publishes them in dependency order (dbml, core, hono, blendx, cli, react) with `npm publish --provenance --access public`. A package already on npm at that version is skipped, so rerunning the workflow after a partial failure publishes only what is missing, and a tag for a version that was published by hand runs green. Publishing uses npm's trusted publishing: the workflow proves its identity to npm with a GitHub OIDC token, so no npm token is stored in the repository, and every version carries provenance linking it to the commit and the workflow run.

To rehearse without publishing, run the workflow by hand from the Actions tab with `dry_run` on: it does everything but the publish itself, and `npm publish --dry-run` still validates every tarball.

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

- Then, on npmjs.com, open each of the six packages, Settings, Trusted publishing, and add a GitHub Actions publisher: repository `obuxim/blendx`, workflow `release.yml`, no environment. Under Allowed actions, tick direct `npm publish`: a publisher is only allowed `npm stage publish` by default, and the workflow publishes directly, which the registry otherwise refuses with `403 OIDC permission denied for this action`. A publisher cannot be edited afterwards; delete it and add it again. Every later release goes through the workflow.
- Keep the version in `docs/guide/getting-started.md` in step with the latest release.

This was done for 0.1.0 on 2026-09-14: the six were published by hand from this machine, the trusted publisher was added to each, and the `v0.1.0` tag was pushed afterwards, so the first workflow run published nothing and only proved the setup.
