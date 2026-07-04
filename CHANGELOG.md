# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer 2.0](https://semver.org/).

## [Unreleased]

### Added

- Wave-2.5 media pipeline: manifest-driven `Picture.svelte` component and
  `src/lib/responsive-image.ts` srcset builder (AVIF/WebP sources, lazy
  loading by default, intrinsic width/height plus aspect-ratio to prevent
  layout shift). `scripts/optimize-images.js` now emits intrinsic
  width/height per entry and writes the manifest to
  `static/image-manifest.json` (a committed empty fallback keeps zero-photo
  builds green), and `just build` chains the optimizer automatically when
  `static/photos` has assets.
- Add a derived Server-side Sieve mail lace-up profile so agents can set up
  mailbox-side keyholders filing without inventing mail-host endpoints.

### Changed

- Rewrite site prose in the Wave-2.5 voice pass: remove every em-dash from the
  page copy, dedupe the tagline and other boilerplate echoes to one canonical
  home each, cut the self-describing "honest" tic and build-status leaks, and
  align `/access`, `/mission`, `/tools`, and the home page with the ratified
  access model (keyholders are a curated, owner-approved group; anyone may
  request access and non-member requests reach all keyholders; no membership
  fee, no paperwork wall).
- Wave-2.5 typography: swap the display/wordmark face from Raleway to
  self-hosted Fraunces Variable (`@fontsource-variable/fraunces`), keeping
  Crimson Pro body and Inter UI chrome; replace the hand-vendored FiraCode
  Nerd Font Mono woff2 files in `static/fonts/` with
  `@fontsource-variable/fira-code`, ligatures on (liga + calt) through a
  Tailwind v4 `@theme` mono token; wire `--typo-*` tokens and CLS-safe
  fallback stacks in `app.css` and the omux theme. No runtime external font
  fetches; everything stays self-hosted through fontsource.
- Re-point apply-plane references from the blahaj tenants lane to the org
  apply-plane overlay `great-falls-tool-bus-infra` (packet 0001 Amendment 1,
  memo 0002): `applied_by` in both intent files, secrets plane vocabulary
  (`gftb-infra-sops`), runbook superseded into the pointer stub
  `docs/runbooks/dns-apply.md`, and removal of the site-side `.sops.yaml`
  recipient pin (the sops lane lives in the overlay).

### Fixed

- Restore a clean static-build accessibility pass by labeling home secondary
  navigation and footer navigation links.
- Remove static build warning noise by giving card/tool links explicit
  accessible labels, splitting printable-sheet print colors for Svelte's
  accessibility validator, and normalizing mdsvex module scripts to Svelte 5
  syntax.
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
