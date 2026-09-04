---
name: tinyland-scaffold-doctor
description: Audit a Tinyland repo for drift against its immutable tinyland-inc/site.scaffold creation origin. Reports a scorecard covering repo contracts, manifest validity, schema-v2 ActionPlan shape, immutable ci-templates v4 adoption, and absence of provider placement or fallback execution. Use when validating a spawn, diagnosing CI drift, or preparing a reviewed upstream synchronization.
when_to_use: |
  Use when the user asks "is this site healthy", "does this match scaffold", "what's
  drifted", "audit conformance", or after running /tinyland-spawn-sister-site to
  verify the new spoke is house-style compliant. Also use proactively if you notice
  a sister site failing a check the scaffold passes — drift is the most common cause.
allowed-tools:
  - Read
  - Bash(just conformance)
  - Bash(just lanes-validate)
  - Bash(just repo-manifest-validate)
  - Bash(just inhouse-package-parity)
  - Bash(just secrets-scan-dir)
  - Bash(just bazel-graph)
  - Bash(jq *)
  - Bash(diff *)
  - Bash(git *)
  - Bash(grep *)
  - Bash(test *)
---

# Tinyland Scaffold Doctor

## What "drift" means

Drift is divergence between this repo and the exact scaffold commit recorded in
its schema-v2 `scaffold_origin`.
The scaffold ships pinned versions (Skeleton 5.0.1 as a version-locked
skeleton + skeleton-svelte pair, shim-free Tailwind v4),
recipe shapes (`just check` / `just ci` / `just conformance`), schemas
(`docs/schemas/lanes.schema.json`, `tinyland-repo-manifest.v2.schema.json`), and
authority boundaries (no Cloudflare creds in a spoke, no runtime broker fetches,
no application-owned OpenTofu state or apply). Drift erodes those guarantees silently — a spoke that
"works" today can fail conformance because a recipe was renamed, a flake input
was dropped, a Bazel registry entry was unpinned, or a Cloudflare token leaked
in.

Scaffold-doctor's job is to make drift visible.

## How to run it

Three layers, run in this order:

### Layer 1 — Existing checks (fast)

```bash
just conformance                # registered repo-role conformance checks
just repo-manifest-validate     # tinyland.repo.json against the JSON Schema
just lanes-validate             # .github/lanes.json against schema
just inhouse-package-parity     # package.json versions == MODULE.bazel versions
just secrets-scan-dir           # gitleaks against working tree
just bazel-graph                # module-graph integrity proof
```

A green pass on all six is the floor, not the ceiling.

### Layer 2 — Scaffold-version drift (deep)

Compare this repo against its exact scaffold origin. Never substitute the
latest release when provenance is absent; report the missing origin as drift.

```bash
# 1. Read the immutable schema-v2 origin.
SCAFFOLD_REPO="$(jq -r '.scaffold_origin.repository // empty' tinyland.repo.json)"
SCAFFOLD_SHA="$(jq -r '.scaffold_origin.commit_sha // empty' tinyland.repo.json)"
test "$SCAFFOLD_REPO" = tinyland-inc/site.scaffold
test "${#SCAFFOLD_SHA}" -eq 40

# 2. Fetch that immutable revision without changing the worktree, then diff
# load-bearing files directly against it. Surface (not auto-fix) drift.
git fetch "https://github.com/${SCAFFOLD_REPO}.git" "$SCAFFOLD_SHA"
for f in Justfile flake.nix .bazelrc .gitleaks.toml AGENTS.md \
         .github/lanes.json .github/workflows/ci.yml docs/CI-SCHEMA.md \
         docs/schemas/lanes.schema.json \
         docs/schemas/tinyland-repo-manifest.v2.schema.json \
         scripts/check-conformance.sh; do
  diff -u <(git show "$SCAFFOLD_SHA:$f") "$f" || true
done
```

Report each drift with: file, summary of change, likely cause (intentional
fork vs unintended drift), and whether to fold the scaffold's version back in.

### Layer 3 — Authority-boundary audit

These are the rules that should NEVER drift in a spoke:

- `tinyland.repo.json` `boundaries.owns_*` flags match the role.
- `.github/lanes.json` is an ActionPlan/v4 schema-3 declaration containing
  only finite Bazel commands, exact workspace targets, abstract REAPI
  capabilities, and closed result dispositions. It owns no tenant,
  repository, runner, endpoint, credential, publication, or apply instance.
- The application workflow invokes the immutable
  `tinyland-inc/ci-templates/.github/workflows/spoke-ci-v4.yml@32e39ced0008edf4564ebeb173a5e8fbf069e28f`
  (`v5.1.0`, carrying ActionPlan/v4 schema 3) and only
  selects a checked-in action name. It has no v3, cache-only, local,
  hosted-runner, direct-endpoint, port-forward, or profile fallback.
- Consumer enrollment instances live in the organization's own `-infra`
  repository as signed `OwnerInstallation/v1` and `TenantOverlay/v1` values.
  GF core owns their types and verifier, never those consumer instances, and
  the application repo never names provider placement.
- Root `.bazelversion` equals the estate-wide Bazel version the repo
  recorded next to its exact-SHA `bazel-registry` pin, as a
  `# estate-bazelversion: <x.y.z>` line in `.bazelrc` (TIN-3857 Step A).
  The row is gated on that registry pin actually being present in
  `.bazelrc`; a repo without one gets an explicit `SKIP` row, never a
  silently missing row.
  Offline check: it catches local drift, it does NOT contact the registry,
  so re-reading the registry's own `.bazelversion` stays part of the
  documented re-pin step in `.bazelrc`. Those two values agree as of the
  current pin: the estate value 8.2.1 is what the pinned
  `tinyland-inc/bazel-registry` commit itself records. Keeping them in
  agreement is the re-pin procedure's job, not this row's.
- `flake.nix` has no hard-coded secrets or token paths.
- `.github/workflows/*.yml` contain only the immutable v4 CI-template
  invocation for application actions. They do not dispatch, publish, reap,
  apply, mutate Cloudflare, or name provider placement.
- `package.json` and its lockfile contain no in-house npm source edge for
  `@tummycrypt/*` or `@tinyland/*`; in-house packages enter through the pinned
  Bzlmod/BCR graph.
- Application consumers contain no state backend, provider configuration,
  cluster manifest, direct apply command, or application-owned lifecycle
  controller. A repo-local `tofu/` path is permitted only for declare-only
  intent explicitly allowed by its manifest and repo contract.
- No browser/edge runtime fetch of `tinyland.dev` from a spoke (snapshots
  only, ingested at build time).

Use existing conformance/schema checks plus read-only inspection for these
rows. Do not add an ad hoc repo-local validator merely to restate the prose.
Surface any violation as **P0 drift** — the spoke is no longer house-style
compliant in a way that may silently corrupt the federation perimeter.

## Output format

Produce a scorecard, one row per check, in this shape:

```
PASS | check-name                      | (one-line evidence)
PASS | ...
WARN | flake.nix: missing git-cliff   | recorded scaffold origin adds git-cliff to devShell
FAIL | .github/workflows/ci.yml:18    | invokes v3/cache-only execution instead of ci-templates v4
P0   | tofu/backend.tf                | application consumer owns a forbidden OpenTofu state/apply root
```

Then a `SUMMARY:` line:

```
SUMMARY: 14 PASS, 2 WARN, 1 FAIL, 1 P0
```

Then a `NEXT STEPS:` block: ordered list of fixes, P0 first.

## When to suggest an upstream synchronization

If a reviewed upstream scaffold change should be adopted, port that exact
change and cite its source commit in the PR. Keep
`tinyland.repo.json.scaffold_origin.commit_sha` unchanged: it records the
creation transaction, not the newest synchronized revision. Until the schema
defines a separate synchronization field, use the reviewed PR/commit record;
never paper over drift by rewriting creation provenance.

## What this skill does NOT do

- It does not auto-fix drift. Drift fixes are PRs, not script outputs — they
  need human review.
- It does not enforce non-static-spoke rules on `tinyland.dev` or
  MassageIthaca-shaped app repos. Run `/tinyland-whoami` first to confirm the
  role before invoking this skill.
- It does not validate snapshot contents (signature, Pulse M1 shape) — that's
  what `just validate-static-projection` does. The doctor only verifies the
  recipe exists and is wired correctly.
