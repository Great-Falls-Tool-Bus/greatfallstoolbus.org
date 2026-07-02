---
name: tinyland-whoami
description: Classify the current repository's role inside the Tinyland ecosystem (hub / static-spoke / dynamic-spoke / package-producer / package-authority / infra / tooling / business-internal) and surface the small set of skills, contracts, and authorities that actually apply. Use when landing in an unfamiliar tinyland repo, when AGENTS.md is missing or thin, when an agent needs to decide which other skill to invoke, or when the user asks "what kind of repo am I in?" / "what should I read first?" / "what skills apply here?".
when_to_use: |
  Run on cold landing in any repo under tinyland-inc/* or any sister site spawned from
  site.scaffold. Especially valuable when AGENTS.md is missing/stale, when the repo's
  shape isn't obvious from filenames, when an agent must pick between conflicting
  conventions (mothership vs spoke vs package), or when the user asks for orientation.
allowed-tools:
  - Read
  - Bash(just whoami)
  - Bash(jq *)
  - Bash(cat tinyland.repo.json)
  - Bash(ls *)
  - Bash(test *)
---

# Tinyland Whoami — Cold-Landing Repo Classifier

## Why this skill exists

Tinyland repos come in shapes that have different rules. A static spoke must not
own auth or payments; the mothership must; a package-producer publishes Bazel
modules into `tinyland-inc/bazel-registry`; infra repos (blahaj, lab) own GitOps
receipt and on-prem K8s; tooling repos (this scaffold, ci-templates) template
and template-validate the others. Applying the wrong shape's rules — for example
adding ActivityPub delivery to a static spoke, or treating tinyland.dev like a
spoke — causes real, durable damage.

This skill tells you which shape applies before you edit anything.

## How to classify (in order)

1. **Read `tinyland.repo.json` if it exists.** That's the authoritative declaration.
   `taxonomy.primary_role` is the canonical answer. `boundaries.*` tell you what
   the repo is allowed to own (`owns_auth`, `owns_payments`, `owns_activitypub_delivery`,
   `owns_runtime_backend`, etc.). `authorities.*` tell you who owns the things
   this repo doesn't (content authority, GitOps receiver, RBE authority, package
   registry). Stop here when present.

2. **Run `just whoami`.** The recipe wraps `scripts/whoami.py`, which validates
   `tinyland.repo.json` against `docs/schemas/tinyland-repo-manifest.schema.json`,
   then prints a one-screen summary with the matching skills to load.

3. **Fall back to heuristics** when `tinyland.repo.json` is absent (older repos
   not yet brought into the house contract). Detect in this order:

   | If the repo has...                                        | The role is likely...      |
   |-----------------------------------------------------------|---------------------------|
   | `.activitypub/{actors,remote-actors}/` + adapter-node    | `hub` (mothership)        |
   | `svelte.config.js` with `adapter-static` + `MODULE.bazel` consuming `tummycrypt_tinyland_*` | `static-spoke` |
   | `svelte.config.js` with `adapter-node` + Postgres        | `dynamic-spoke`           |
   | `MODULE.bazel` declaring `module(name = "tummycrypt_*")` + publish workflow | `package-producer` |
   | Repo named `bazel-registry` + Starlark + BCR layout       | `package-authority`       |
   | `kustomize` / `tofu/` + cluster manifests (`deploy/`)     | `infra`                   |
   | `.github/actions/` reusable composites + no app code      | `tooling`                 |
   | `.gnucash` files + entity dirs                            | `business-internal`       |

   If two patterns match, prefer the more specific one (e.g. `.activitypub/`
   beats `MODULE.bazel`-as-consumer).

4. **If you still don't know, ask the user.** Don't guess. Don't apply
   static-spoke rules to a repo that might be the mothership.

## What to do once you know the role

For each role, the canonical skill chain is:

- **hub (`tinyland.dev`)**: `tinyland-repo-contract` always; mothership-specific
  rules live in `tinyland.dev/AGENTS.md`. Don't import static-spoke rules. Owns
  AP delivery, auth, payments, scheduling, media lifecycle.
- **static-spoke**: `tinyland-repo-contract` + `tinyland-static-spoke` +
  `tinyland-flywheel-bazel` (for cache-first Bazel only). Federates from
  `tinyland.dev` via signed `PublicPulseSnapshot` JSON. Read-only consumer.
- **dynamic-spoke** (e.g. `software.tinyland.dev-booking`): repo-contract + the
  dynamic-spoke skill (not yet authored — flag to the user). Owns its own data,
  consumes hub auth.
- **package-producer**: repo-contract + a package-producer skill (not yet
  authored). Must publish into `tinyland-inc/bazel-registry`. Versions must be
  exact-pinned by consumers.
- **infra (`blahaj`, `lab`)**: repo-contract only here. Per-repo `AGENTS.md` is
  load-bearing; do not generalize.
- **tooling (`site.scaffold`, `ci-templates`)**: repo-contract +
  whatever the repo templates. This is the meta-layer.

## Outputs to produce

After classification, write a 6-line summary to the conversation:

```
Role:        <primary_role>          (source: tinyland.repo.json | heuristic)
Owns:        <boundaries.owns_* that are true>
Defers to:   <authorities.* values>
First read:  AGENTS.md, docs/CI-SCHEMA.md (if present), Justfile
Skills:      <ordered list of skills to load>
Risks:       <one line on what this role must NOT do>
```

This is the canonical orientation block. Paste it back to the user so they can
confirm before you edit anything.

## Anti-patterns

- Do not apply static-spoke restrictions wholesale to `tinyland.dev`.
- Do not treat the absence of `tinyland.repo.json` as "not a tinyland repo" —
  many older repos predate the manifest. Use heuristics, then offer to author
  the manifest as a follow-up.
- Do not skip this skill when AGENTS.md looks complete. The manifest is the
  machine-readable source of truth; AGENTS.md is prose that can drift.
