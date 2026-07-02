# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer 2.0](https://semver.org/).

## [Unreleased]

### Fixed

- Forward GloriousFlywheel `BAZEL_REMOTE_INSTANCE_NAME` through the Bazel
  wrapper so tenant-scoped REAPI tokens do not fall back to Bazel's `default`
  instance.

## [0.1.0] - 2026-06-23

### Added

- First versioned `greatfallstoolbus.org` release surface, including a release workflow
  that cuts immutable `vMAJOR.MINOR.PATCH` tags, moves the floating `vMAJOR`
  tag with an explicit remote lease, and creates GitHub Releases from this
  changelog.
- Release operator runbook documenting the required `release: vX.Y.Z` commit
  shape and tag immutability rules.

### Changed

- Promote the scaffold package version to `0.1.0` so SBOM/source-version output
  matches the first taggable scaffold release.
- Correct spoke state guidance to stay provider-neutral: state keys target the
  operator-provisioned S3-compatible backend, while spokes must not hard-code a
  backend provider. Tinyland's current internal RustFS deployment remains
  separate from trusted RBE CAS/action-cache/publication authority.
