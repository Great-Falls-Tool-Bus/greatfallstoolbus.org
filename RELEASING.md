# Releasing `site.scaffold`

`site.scaffold` releases are the conformance anchor for repos spawned from the
template. A spoke may stay on the scaffold tag it was spawned from until it
explicitly upgrades.

## Version Rule

- Use SemVer tags: `vMAJOR.MINOR.PATCH`.
- Keep the floating major tag, such as `v0`, pointed at the latest release in
  that major line.
- Never reuse or move an immutable `vMAJOR.MINOR.PATCH` tag.
- Do not tag arbitrary merges. The release workflow only cuts tags from a main
  commit whose subject is exactly `release: vX.Y.Z`.

## Release PR

1. Move the intended changelog entries from `## [Unreleased]` into
   `## [X.Y.Z] - YYYY-MM-DD`.
2. Update `package.json` `version` to `X.Y.Z`.
3. Keep `## [Unreleased]` present and empty.
4. Run:

   ```sh
   nix develop --command just check
   nix develop --command just conformance
   git diff --check
   ```

5. Open the PR with the release commit subject:

   ```text
   release: vX.Y.Z
   ```

After that commit lands on `main`, `.github/workflows/release.yml` cuts the
immutable tag, moves the floating major tag with an explicit remote lease, and
creates the GitHub Release from `CHANGELOG.md`.

## Recovery

If immutable `vX.Y.Z` was created but the floating major tag or GitHub Release
failed, do not delete or recreate the immutable tag. Repair only the missing
floating tag or Release, record the run ID in Linear, and patch the workflow
before the next release.
