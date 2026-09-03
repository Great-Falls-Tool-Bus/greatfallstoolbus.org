---
name: tinyland-scaffold-doctor
description: Audit a Tinyland repo for drift against the greatfallstoolbus.org house-style contract. Reports a structured scorecard covering Justfile recipes, flake.nix toolchain, gitleaks, agent guidance, manifest validity, skill publication, the schema-v2 consumer-owned ActionPlan, immutable ci-templates v4 adoption, and the absence of provider placement or fallback execution in consumer source. Use when onboarding a sister site, diagnosing CI drift, validating a spawn, or preparing a scaffold-tag bump.
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

Drift is divergence between this repo and the scaffold tag it was spawned from.
The scaffold ships pinned versions (Skeleton 5.0.1 as a version-locked
skeleton + skeleton-svelte pair, shim-free Tailwind v4),
recipe shapes (`just check` / `just ci` / `just conformance`), schemas
(`docs/schemas/lanes.schema.json`, `tinyland-repo-manifest.schema.json`), and
authority boundaries (no Cloudflare creds in a spoke, no runtime broker fetches,
no rustfs state backend). Drift erodes those guarantees silently — a spoke that
"works" today can fail conformance because a recipe was renamed, a flake input
was dropped, a Bazel registry entry was unpinned, or a Cloudflare token leaked
in.

Scaffold-doctor's job is to make drift visible.

## How to run it

Three layers, run in this order:

### Layer 1 — Existing checks (fast)

```bash
just conformance                # conformance checklist (docs/CI-SCHEMA.md §11) + GFTB-local addendum
just repo-manifest-validate     # tinyland.repo.json against the JSON Schema
just lanes-validate             # .github/lanes.json against schema
just inhouse-package-parity     # package.json versions == MODULE.bazel versions
just secrets-scan-dir           # gitleaks against working tree
just bazel-graph                # module-graph integrity proof
```

A green pass on all six is the floor, not the ceiling.

### Layer 2 — Scaffold-version drift (deep)

Compare this repo against the scaffold tag it was spawned from.

```bash
# 1. Identify the scaffold tag this repo inherits from.
SCAFFOLD_TAG="$(jq -r '.scaffold_tag // empty' tinyland.repo.json)"
# (If empty, fall back to the most-recent tinyland-inc/site.scaffold release.)

# 2. Fetch the scaffold at that tag into /tmp.
mkdir -p /tmp/scaffold-doctor && cd /tmp/scaffold-doctor
gh repo clone tinyland-inc/site.scaffold scaffold-"$SCAFFOLD_TAG"
cd scaffold-"$SCAFFOLD_TAG" && git checkout "$SCAFFOLD_TAG"

# 3. Diff load-bearing files. Surface (not auto-fix) drift.
for f in Justfile flake.nix .bazelrc .gitleaks.toml AGENTS.md \
         .github/lanes.json .github/workflows/ci.yml docs/CI-SCHEMA.md \
         docs/schemas/lanes.schema.json \
         docs/schemas/tinyland-repo-manifest.schema.json \
         scripts/check-conformance.sh; do
  diff -u "/tmp/scaffold-doctor/scaffold-$SCAFFOLD_TAG/$f" "$f" || true
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
  `tinyland-inc/ci-templates/.github/workflows/spoke-ci-v4.yml@0067a1f0e16012ea91d0602b7d185e534774cadb`
  (`v5.0.0`, carrying ActionPlan/v4 schema 3) and only
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
- `.github/workflows/*.yml` do not invoke a Cloudflare API mutation step
  directly — they call into `blahaj` via the dispatch schemas.
- No `package.json` dependency on a non-exact in-house version
  (`^x.y.z` or `~x.y.z` are forbidden for `@tummycrypt/*` and `@tinyland/*`).
- `tofu/backend.tf` uses the `s3` backend type with **no hard-coded provider
  endpoint** (env/operator authority); the state substrate is **RustFS** — never
  Garage/MinIO (hallucinations).
- No browser/edge runtime fetch of `tinyland.dev` from a spoke (snapshots
  only, ingested at build time).

`grep` and small-script checks land each of these. Surface any violation as
**P0 drift** — the spoke is no longer house-style compliant in a way that may
silently corrupt the federation perimeter.

## Output format

Produce a scorecard, one row per check, in this shape:

```
PASS | check-name                      | (one-line evidence)
PASS | ...
WARN | flake.nix: missing git-cliff   | scaffold@v0.4.0 adds git-cliff to devShell
FAIL | .github/workflows/ci.yml:18    | invokes v3/cache-only execution instead of ci-templates v4
P0   | tofu/backend.tf:7              | hard-codes a provider state endpoint (forbidden — env authority)
```

Then a `SUMMARY:` line:

```
SUMMARY: 14 PASS, 2 WARN, 1 FAIL, 1 P0
```

Then a `NEXT STEPS:` block: ordered list of fixes, P0 first.

## When to suggest a scaffold-tag bump

If the doctor finds the scaffold is N+1 minor versions ahead and the spoke
is missing recipes the scaffold ships, suggest a scaffold-tag bump rather than
patching ad hoc. Bumps are coordinated by editing `tinyland.repo.json`'s
`scaffold_tag` (when that field exists) and re-running the spawn ritual's
post-creation steps minus the `gh repo create`.

## What this skill does NOT do

- It does not auto-fix drift. Drift fixes are PRs, not script outputs — they
  need human review.
- It does not enforce non-static-spoke rules on `tinyland.dev` or
  MassageIthaca-shaped app repos. Run `/tinyland-whoami` first to confirm the
  role before invoking this skill.
- It does not validate snapshot contents (signature, Pulse M1 shape) — that's
  what `just validate-static-projection` does. The doctor only verifies the
  recipe exists and is wired correctly.
