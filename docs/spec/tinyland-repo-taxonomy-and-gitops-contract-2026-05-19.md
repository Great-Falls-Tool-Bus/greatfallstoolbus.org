# Tinyland Repo Taxonomy and GitOps Convergence - 2026-05-19

Status: working specification for `greatfallstoolbus.org`, `ci-templates`, Blahaj,
GloriousFlywheel, MassageIthaca-shaped app repos, and `tinyland.dev`.

Linear: TIN-1570, under TIN-1437 "Spoke Fan-out + CI House-Style v2".

## Purpose

Tinyland repos should converge toward a GitLab Auto DevOps-like developer
experience for GitHub, Kubernetes, OpenTofu, and GloriousFlywheel: a new repo
declares its shape, uses standard Just/Nix entrypoints, and gets predictable CI,
ephemeral PR environments, cache/RBE behavior, reaping, public-preview overlays,
and conformance checks without hand-copying lane/reaper/route logic.

The current noise comes from policy being split across spoke workflows,
`ci-templates`, Blahaj, GloriousFlywheel, and repo-local docs. The fix is not to
make every repo a static spoke. The fix is to separate repo taxonomy from the
org-wide contract and make Blahaj the generic GitOps receiver.

## Layered Taxonomy

### 1. Org-Wide Repo Contract

Applies to every Tinyland repo, regardless of Bazel/static/app shape.

- `AGENTS.md` states role, authority boundaries, validation, and non-goals.
- `Justfile` is the human/agent command surface when a repo has local commands.
- `nix develop --command just <recipe>` is the default reproducible shell path.
- Secrets scanning is explicit and runnable through a standard recipe.
- GitHub Actions is the primary hosted control path.
- Durable requirements live in repo files, schemas, Just recipes, tests, or
  Linear issues; prompt-only instructions are not authoritative.

### 2. Bazel, Package, Cache, and RBE Contract

Applies to repos that consume or produce Tinyland packages.

- GloriousFlywheel owns cache/RBE substrate truth, target-class eligibility,
  runner posture, and consumer wrapper semantics.
- `MODULE.bazel` and the Tinyland registry are the package graph authority for
  Bazel consumers.
- npm package references for in-house packages are compatibility edges until a
  repo is fully Bazel-native; they must be exact and parity-checked.
- OpenTofu, developer servers, and image push are not RBE target classes.
- Cache hits are not RBE proof. RBE proof requires executor-backed evidence for
  an allowed target class.

### 3. Static Spoke Contract

Applies to repos spawned from `tinyland-inc/greatfallstoolbus.org`.

- The repo is a static projection consumer, not an app backend.
- It does not own auth, user data, payments, media lifecycle, ActivityPub
  delivery, broker runtime fetches, or mutation APIs.
- `.github/lanes.json` is the sole spoke-side lane declaration.
- Static projection input is checked-in and validated before use.
- Public/client preview routes are explicit Blahaj-owned overlays, not spoke
  Cloudflare credentials.
- Per-spoke infrastructure may live in `tofu/`, but the consumed modules come
  from GloriousFlywheel and state uses operator-provisioned S3-compatible
  storage. Spokes do not hard-code a provider; Tinyland's current internal
  backend is RustFS.

### 4. Mothership Contract

Applies to `tinyland.dev`.

- `tinyland.dev` is the mothership: content authority, admin surface, broker,
  profile/owner registry authority, and future federation authority.
- It consumes Bazel modules but is not a static projection consumer.
- It may own runtime policy and internal integration glue that a static spoke
  must never inherit.
- Its CI/conformance surface should not be forced through `greatfallstoolbus.org`
  static-spoke checks. It still shares the org-wide repo and Bazel/cache
  contracts.

### 5. App/Stateful Spoke Contract

Applies to MassageIthaca-shaped repos.

- The repo may own real runtime behavior such as booking, admin, auth bootstrap,
  payment readiness, and app deployment policy.
- It is not required to pass static-spoke non-goals.
- It should still consume the generic lane, reaper, public-preview, Flywheel,
  and GitOps receiver contracts so app-specific behavior does not require
  duplicated CI plumbing.
- App-specific environment shapes belong in lane metadata and Blahaj route
  authority, not repeated across workflow YAML, shell scripts, schemas, and
  Terraform renderers.

### 6. Blahaj GitOps Receiver Contract

Applies to `tinyland-inc/blahaj`.

- Blahaj validates `greatfallstoolbus.org`/`ci-templates` dispatch schemas itself.
- Blahaj routes by `client_payload.spoke`, not by bespoke workflow names such as
  `massageithaca-pr-envs`.
- Blahaj owns apply, smoke, final per-lane commit statuses, PR-close reap,
  scheduled TTL reap, public-preview provisioning, and public-preview cleanup.
- Blahaj consumes GloriousFlywheel module-emitted state, DNS, runner-binding,
  cache-quota, and app-install shapes instead of redefining them.

## Desired "Works Out of the Box" Flow

For a static spoke:

1. Create from `greatfallstoolbus.org`.
2. Run `scripts/rebrand.sh <domain>`.
3. Fill `tofu/spoke.auto.tfvars`.
4. Edit `.github/lanes.json` only when the lane topology changes.
5. Commit and open a PR.
6. Standard CI validates secrets, package parity, static projection shape,
   lanes, Bazel graphability, and conformance.
7. `ci-templates` builds/pushes lane images and dispatches one generic
   `<spoke>-lane-env` payload.
8. Blahaj applies all lane environments, smokes them, posts final
   `ci/lane/<name>` statuses, and reaps them on close or TTL expiry.
9. Public/client previews are requested by a generic `<spoke>-public-preview`
   payload and applied/reaped by Blahaj.

For an app/stateful spoke:

1. Keep app-owned runtime behavior in the app repo.
2. Use the same lane declaration, dispatch, status, reaper, and preview
   contracts.
3. Put app-specific route/runtime variants in lane metadata and Blahaj intent,
   not in duplicated bespoke receiver workflows.

For `tinyland.dev`:

1. Keep mothership authority separate from static-spoke conformance.
2. Consume GloriousFlywheel cache/package contracts where applicable.
3. Continue to own broker, admin, AP/federation, projection, and authority
   surfaces that spokes consume as reviewed static artifacts.

## TTL Split

Two TTL surfaces intentionally differ:

- Lane environments: default 72h, label-raised to 7d, 30d, or capped `keep`
  at 720h.
- Public preview aliases: default 72h, capped at 168h because these are
  externally reachable Cloudflare Access overlays.

Blahaj should enforce both caps from the relevant schema. A lane-env receiver
that caps all PR lanes at 168h is stale.

## Cross-Repo Noise To Remove

- Bespoke Blahaj receivers for individual repos when a generic
  `<spoke>-lane-env` receiver can validate and route by payload.
- Lane names repeated in workflow YAML, shell scripts, schema examples, Tofu
  renderers, and route validators.
- Hard-coded Bazel cache/executor endpoints in reusable templates or rc files.
- Spoke workflows that know Cloudflare mutation details.
- Spoke CI posting final lane success before Blahaj has applied and smoked the
  runtime environment.
- Per-repo reaper scripts when one schema-validated Blahaj reaper can list by
  spoke/PR/lane labels.
- Static-spoke conformance language applied to `tinyland.dev` or
  MassageIthaca-shaped apps without taxonomy context.

## Repo Workstreams

### `greatfallstoolbus.org`

- Keep `docs/CI-SCHEMA.md` scoped to static spokes.
- Keep this taxonomy spec as the cross-repo map.
- Make `just conformance` assert the static-spoke contract only.
- Keep `AGENTS.md`, project skills, `static/llms.txt`, and `/agent` aligned
  with the taxonomy.

### `ci-templates`

- Remove endpointful Flywheel fragments and consume GloriousFlywheel wrapper
  semantics.
- Make `spoke-ci`, lane env, TTL reap, and public-preview workflows derive
  more from `.github/lanes.json` and PR context.
- Add reusable conformance and OpenTofu validation workflows where they reduce
  spoke boilerplate without making OpenTofu RBE-eligible.
- Release-check that reusable workflows and docs do not teach `@main` pins for
  consumers.

### `blahaj`

- Add generic schema-validated receivers:
  - `<spoke>-lane-env`
  - `<spoke>-lane-ttl-reap`
  - `<spoke>-public-preview`
- Replace MassageIthaca-specific lane/env handlers with spoke-routed generic
  handlers.
- Post final per-lane statuses after apply/smoke.
- Move state handling to the operator-provisioned S3-compatible contract for PR
  envs, without hard-coding a storage provider in spoke payloads.
- Enforce lane TTL and public-preview TTL separately.

### `GloriousFlywheel`

- Treat `config/rbe-target-eligibility.json` as the central allowlist.
- Keep the consumer Bazel wrapper as the downstream contract.
- Keep the five spoke OpenTofu modules as the spoke-facing infra authority.
- Update stale module-reference docs to include the five spoke modules.
- Add SBOM/public manifest generation if release compliance needs a first-class
  artifact.

### `MassageIthaca`

- Do not reclassify it as a static spoke.
- Migrate bespoke lane/reaper/public-preview wiring toward the generic
  `ci-templates` and Blahaj contracts.
- Keep booking/admin/auth/payment behavior app-owned.
- Express deployment variants through `.github/lanes.json` metadata and Blahaj
  intent instead of duplicated workflow logic.

### `tinyland.dev`

- Keep mothership authority separate from static-spoke conformance.
- Avoid importing static-spoke restrictions that would block broker/admin/AP
  authority.
- Share only the org-wide repo contract and Bazel/cache/package contract.

## Acceptance Criteria

- A new static spoke can be laced up with `AGENTS.md`, `Justfile`, Nix,
  `.github/lanes.json`, `tofu/spoke.auto.tfvars`, and standard reusable
  workflows, with no bespoke Blahaj workflow.
- Adding a lane is a one-file spoke change plus any required Blahaj route
  authority update.
- Blahaj, not spoke CI, posts final lane health after runtime apply/smoke.
- `ci-templates` does not publish endpointful Bazel rc fragments.
- GloriousFlywheel remains the only source for RBE target-class eligibility.
- `tinyland.dev`, static spokes, and app/stateful spokes have clearly separate
  conformance rules while still sharing the org-wide repo contract.
