# site.scaffold Agent Map

## Read Order

1. `AGENTS.md`
2. `CLAUDE.md` when running under Claude
3. `tinyland.repo.json` for machine-readable repo shape
4. `docs/agent-adoption.md` when adopting this contract in another repo
5. `docs/CI-SCHEMA.md` before CI, lane, Blahaj, Tofu, or Flywheel changes
6. `docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`
   before applying static-spoke rules to app repos or `tinyland.dev`
7. The relevant `.agents/skills/*/SKILL.md`
8. `Justfile`

## Skills

- `.agents/skills/tinyland-flywheel-bazel/SKILL.md`
- `.agents/skills/tinyland-static-spoke/SKILL.md`
- `.agents/skills/tinyland-repo-contract/SKILL.md`

Claude-compatible project skill entrypoints are symlinked from
`.claude/skills/*` to the canonical `.agents/skills/*` directories.

## Paste-To-Agent

Use `docs/agent-adoption.md` as the canonical prompt source. It tells agents to
triage worktrees first, classify repo shape, map enforceable layers, flag smells,
preserve dirty work, patch minimal conformance gaps, and validate through Just.

## Core Recipes

- `just setup`
- `just check`
- `just build`
- `just ci`
- `just secrets-scan-dir`
- `just secrets-scan`
- `just sbom`
- `just bazel-graph`
- `just repo-manifest-validate`
- `just flywheel-enroll`
- `just flywheel-doctor`
- `just flywheel-verify`
- `just flywheel-info`
- `just flywheel-build`
- `just flywheel-test`
- `just conformance`

## Flywheel Environment

- `GF_FLYWHEEL_PROFILE_STATE` records the enrollment state:
  `unattached`, `shared-cache-backed`, `executor-backed`, or `local-proof`.
- `BAZEL_REMOTE_CACHE` is required for Flywheel-backed work.
- `GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed` uses remote cache only.
- `GF_BAZEL_SUBSTRATE_MODE=executor-backed` also requires `BAZEL_REMOTE_EXECUTOR`.
- `GF_BAZEL_REMOTE_UPLOAD=true` is trusted-lane only.
- Pull requests are read-only cache consumers.

## Taxonomy

- Static spokes consume checked-in projections and do not own runtime app
  behavior.
- `tinyland.dev` is the mothership/content authority and is not governed by
  static-spoke conformance.
- MassageIthaca-shaped app repos may own runtime behavior but should consume
  generic lane, reaper, public-preview, and Flywheel contracts.
- Blahaj should be the generic GitOps receiver for lane envs, TTL reaps, public
  previews, runtime smoke, and final lane statuses.

## Prohibited

- Runtime database or backend in a spoke.
- Browser or edge fetches back to `tinyland.dev` for projections.
- Hard-coded Bazel cache, executor, token, or header values.
- OpenTofu, devserver, or image-push targets marked RBE eligible.
- Committed ad hoc validation scripts. Use `/tmp` or promote to a named script plus Just/Bazel target.
