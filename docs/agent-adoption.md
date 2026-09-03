# Agent Adoption Flow

This is the DRY handoff for asking an AI coding agent to adopt the
`tinyland-inc/site.scaffold` contract in any Tinyland repo.

## Paste To Agent

> Adopt the Tinyland repo contract for this repo: read `AGENTS.md`, `Justfile`, `flake.nix`, `tinyland.repo.json` if present, `.github/workflows/*`, `.github/lanes.json`, `.bazelrc*`, `MODULE.bazel`, and `docs/CI-SCHEMA.md` if present; classify the repo shape and authority boundaries against the exact `tinyland-repo-manifest.v2.schema.json`; map the repo to the enforceable layers in `tinyland-inc/site.scaffold/docs/agent-adoption.md`; flag contract smells; patch only minimal conformance gaps; run through `just <recipe>` entrypoints only; validate with `just check` plus `just conformance` or the closest documented equivalent; do not remove or rewrite dirty worktrees without preserving them and reporting the stash/branch.

For plugin-capable agents, install or load the scaffold skills first:

```text
/plugin marketplace add github:tinyland-inc/site.scaffold
/plugin install scaffold-core@site-scaffold
```

If plugin install is unavailable, read these files directly from the scaffold:

- `.agents/skills/tinyland-whoami/SKILL.md`
- `.agents/skills/tinyland-repo-contract/SKILL.md`
- `.agents/skills/tinyland-static-spoke/SKILL.md`
- `tinyland-inc/GloriousFlywheel/.agents/skills/tinyland-flywheel-enroll/SKILL.md`
- `.agents/skills/tinyland-scaffold-doctor/SKILL.md`

## First Pass

Before editing, produce a short repo orientation:

1. Worktree state: current branch, upstream, dirty files, stashes, and all
   worktrees from `git worktree list --porcelain`.
2. Repo shape: static spoke, static-spoke scaffold, mothership/content
   authority, app/stateful spoke, package producer, package authority, infra, or
   tooling.
3. Authority boundaries: what this repo owns, what it consumes, and which
   sibling repo owns the delegated surface.
4. Enforceable layers present or missing.
5. Contract smells and the smallest patch plan.

Dirty or locked worktrees are evidence, not trash. Preserve them with a named
stash or leave them alone. Prunable worktree metadata may be reported separately
from live paths.

## Enforceable Layers

Use these layers to characterize the repo and decide what applies:

| Layer | Files | Expected shape |
| --- | --- | --- |
| Repo contract | `AGENTS.md`, `CLAUDE.md`, `tinyland.repo.json` | Clear repo role, authority boundaries, and first-read instructions. |
| Command surface | `Justfile` | Every operation goes through `just <recipe>`. CI uses `nix develop --command just <recipe>`. |
| Toolchain | `flake.nix`, `.envrc` | Reproducible shell with tools used by Just recipes. |
| Validation | `just check`, tests, schema validators | Named checks, no ad hoc untracked scripts. |
| Secrets | `.gitleaks.toml`, `just secrets-scan-dir`, `just secrets-scan` | Gitleaks default rules plus narrow Tinyland additions. |
| Bazel graph | `MODULE.bazel`, `MODULE.bazel.lock`, `BUILD.bazel` | Bzlmod graph proof and exact in-house package parity. |
| Flywheel v4 | `.github/lanes.json`, immutable `spoke-ci-v4.yml`, consumer-owned `-infra` overlay | Finite Bazel actions; no provider, endpoint, runner, cache-only, local, or hosted fallback. |
| Owner transactions | Consumer `-infra` overlay and controller results | Non-action publication, preview, reap, and apply operations use typed owner transactions; the application does not dispatch directly to a provider. |
| Static projection | snapshot recipes, projection docs | Static spokes consume checked-in public snapshots only. |
| Agent ingestion | `.agents/skills/*`, `.claude/skills/*`, `static/llms.txt`, `static/agent-map.md` | Agent-readable surfaces link back to durable repo truth. |
| SBOM | `just sbom`, `syft`, `tinyland.repo.json` | SBOM generation is documented and ignored artifacts stay under `build/sbom/`. |

Do not apply static-spoke-only rules to `tinyland.dev` or to
MassageIthaca-shaped app repos. Org-wide rules still apply: explicit
entrypoints, reproducible toolchains, secrets scanning, CI clarity, and durable
docs over prompt-only requirements.

## Smells

Flag these before patching:

- CI or docs call `pnpm`, `vite`, `bazelisk`, `tofu`, or scripts directly where
  a `just` recipe should exist.
- No `flake.nix`, or the flake omits tools used by documented recipes.
- Validation lives only in one-off files outside `scripts/`, tests, Bazel
  targets, schemas, or Just recipes.
- The ActionPlan contains a runner, pool, endpoint, tenant, repository,
  lifecycle, publication, or provider-placement field.
- A v4 caller bypasses `spoke-ci-v4.yml@0067a1f0e16012ea91d0602b7d185e534774cadb` or the image-custodied
  `gf-action-client`.
- A repo preserves a v3 profile, cache-only path, local execution branch, or
  hosted runner as a v4 fallback.
- Pull requests can upload to the remote cache without a trusted lane.
- OpenTofu, dev-server, or image-push targets are marked RBE eligible.
- Static spokes fetch `tinyland.dev` at browser or edge runtime.
- An application carries provider credentials or directly dispatches a public
  preview instead of using its consumer overlay and a controller result.
- A provider-specific S3 endpoint appears in spoke `tofu/`, workflow YAML, or
  Just recipes instead of coming from operator environment.
- RustFS appears as RBE CAS/action-cache/publication authority.
- An in-house `@tummycrypt/*` or `@tinyland/*` source appears in package.json or
  pnpm-lock.yaml, or a BCR module lacks its public `:pkg` graph link.
- Agent-facing files disagree with each other, or requirements live only in a
  prompt.

## Conformance Patch Order

1. Add or repair `AGENTS.md` and `tinyland.repo.json` so repo shape is explicit.
2. Normalize commands behind `Justfile` recipes.
3. Ensure `flake.nix` includes every tool those recipes call.
4. Add secrets scans and schema validators.
5. Wire finite Bazel actions and the immutable v4 caller; put signed demand in
   the consumer-owned `-infra` overlay.
6. Link non-action owner transactions through the consumer overlay and
   controller contract instead of per-repo provider dispatches.
7. Publish agent ingestion surfaces only after the durable contract files are
   true.
8. Run `just check`, `just conformance`, and repo-specific build/test gates.

If a repo cannot yet implement a layer, document the gap and owner instead of
silently inventing a local workaround.
