# Tinyland spoke CI and lane-metadata contract

Status: current after the TIN-489/TIN-3066 receiver contraction on 2026-08-03.

Machine-readable authority:

- [`schemas/lanes.schema.json`](./schemas/lanes.schema.json) — build and QA
  metadata for a spoke.
- [`schemas/tinyland-repo-manifest.schema.json`](./schemas/tinyland-repo-manifest.schema.json)
  and
  [`schemas/tinyland-repo-manifest.v2.schema.json`](./schemas/tinyland-repo-manifest.v2.schema.json)
  — repository role and ownership.

The former Blahaj lane, reaper, and public-preview dispatch schemas are removed.
Git history preserves them; they are not an execution contract.

## 1. Scope and ownership

This document defines:

- `.github/lanes.json` validation;
- CI runner and GloriousFlywheel target metadata;
- finite Just/Bazel validation entrypoints;
- required source gates and conformance.

This document does not define an application receiver, OpenTofu apply plane,
PR-environment controller, DNS mutation path, public-preview sender, or reaper.
Lane metadata grants none of those authorities.

Static publication uses the repository's declared atomic host. An application
or stateful product delegates live workloads, protected state/apply, PR
create/reap, and runtime receipts to its dedicated owner overlay.

## 2. Lane metadata

`.github/lanes.json` is the only spoke-side lane declaration. It feeds CI
matrices, build variants, static projection selection, and Flywheel target-class
checks. A consumer may use the metadata only under its own reviewed authority.

Minimal example:

```json
{
  "$schema": "../docs/schemas/lanes.schema.json",
  "schema_version": 1,
  "spoke": {
    "name": "example-site",
    "domain": "example.tinyland.dev"
  },
  "defaults": {
    "runner_class": "tinyland-nix",
    "flywheel_target_classes": [
      "sveltekit-app-build",
      "sveltekit-unit-tests"
    ]
  },
  "lanes": [
    {
      "name": "default",
      "theme": "tinyland",
      "snapshot_source": "checked-in"
    }
  ]
}
```

Rules:

- `schema_version` is currently `1`.
- `spoke.name` is a stable slug; `spoke.domain` is metadata, not DNS authority.
- Each lane has a unique `name`, `theme`, and `snapshot_source`.
- `runner_class` must be in the schema enum.
- `flywheel_target_classes` must be a subset of the schema allowlist.
- Lifecycle-shaped optional fields remain compatibility metadata. Their
  presence never creates a workflow, state namespace, or apply permission.
- Validate with `just lanes-validate` and `just conformance`.

## 3. Canonical entrypoints

All developer and CI operations route through `just`:

```text
nix develop --command just check
nix develop --command just build
nix develop --command just test-unit
nix develop --command just lanes-validate
nix develop --command just repo-manifest-validate
nix develop --command just conformance
```

Finite Bazel targets remain the build/test proof graph. Node-compatible
pnpm/Vite/check/image recipes first hydrate first-party packages from Bzlmod
`npm_link_package :pkg` outputs; that materialization is neither an npm source
rail nor remote-execution proof.

## 4. GloriousFlywheel binding

Flywheel-backed work uses `scripts/gloriousflywheel-bazel.sh` through the
`just flywheel-*` recipes. Endpoint and credential authority is runtime-only.

Required state:

| Variable | Meaning |
| --- | --- |
| `GF_FLYWHEEL_PROFILE_STATE` | `unattached`, `shared-cache-backed`, `executor-backed`, or `local-proof` |
| `GF_BAZEL_SUBSTRATE_MODE` | `shared-cache-backed` or, only for proved classes, `executor-backed` |
| `BAZEL_REMOTE_CACHE` | runtime-provided cache endpoint |
| `BAZEL_REMOTE_EXECUTOR` | required only for executor-backed mode |
| `GF_BAZEL_REMOTE_UPLOAD` | false/unset for PRs; true only in a trusted writing lane |
| `BAZEL_REMOTE_INSTANCE_NAME` | non-secret tenant routing metadata |

Optional credential helpers, headers, job limits, and connection limits remain
runtime inputs. They must not appear in `.bazelrc`, workflows, examples, or
tracked environment files.

Cold landing:

```text
just flywheel-enroll
just flywheel-doctor
just flywheel-verify
```

Missing enrollment fails closed. Do not substitute a local disk-cache build and
claim shared-cache or RBE evidence.

The scaffold remains `shared-cache-backed`. TIN-2851 blocks routine
executor-backed use even for otherwise proved target classes; executor mode is
limited to separately authorized product proofs.

Proved static-spoke classes:

- `sveltekit-app-build`
- `sveltekit-unit-tests`
- `deployment-bundle-packaging`
- `docs-site-static-build`

`web-playwright-chromium-static-smoke` remains candidate-only until the
GloriousFlywheel authority promotes it. OpenTofu, dev servers, browserful local
acceptance, and image publication are never executor-eligible.

## 5. Runner classes

| Class | Use |
| --- | --- |
| `tinyland-nix` | normal Nix/Bazel CI |
| `tinyland-nix-heavy` | reviewed high-memory build |
| `tinyland-nix-kvm` | KVM-required proof |
| `tinyland-nix-gpu` | GPU-required proof |
| `tinyland-docker` / `tinyland-dind` | explicitly reviewed container job |

**No-hosted rule (TIN-3914):** no workflow in this repository may name a
GitHub-hosted label (`ubuntu-*`, `macos-*`, `windows-*`) in `runs-on:`, at any
nesting -- scalar, list item, or the `{group:, labels:}` mapping form. The
former escape hatch for `gh api` calls, webhook dispatches, and pre-trust
security gates is withdrawn by operator ruling 2026-08-19: those jobs run fine
on the GF cache-fronted ARC fleet. Do not create a runner or hosted fallback in
a spoke. Enrollment binds a repository to an existing owner-approved pool.

## 6. CI gates

The scaffold's `.github/workflows/ci.yml` calls the pinned reusable spoke CI
workflow and adds a direct-reach boundary check. Its stable `merge-gate` requires
both results.

The source gates cover:

- secrets scanning;
- lanes and repository manifest validation;
- finite Bazel graph/build/test products;
- cache attachment where declared;
- no direct application/PR receiver reach;
- zero first-party npm sources, complete bazel_dep/npm_link_package edges,
  and role-aware spoke conformance.

Runtime QA and production admission are product-owned gates. The scaffold does
not ship a receiver-coupled admission workflow. A product may require an
owner-authenticated exact-head QA receipt plus a SHA-bound operator decision
before merge; see
[`patterns/operator-gate-handoff.md`](./patterns/operator-gate-handoff.md).

Default-branch rulesets are documented in
[`ci/branch-protection.md`](./ci/branch-protection.md). Repository settings are
operator authority and are not inferred from a source PR.

## 7. Static and dynamic publication

The default adapter-static product publishes an immutable build through GitHub
Pages. A custom static host must keep workflow, base path, and rollback behavior
consistent.

`scripts/rebrand.sh --adapter=node` changes repository role and build shape. It
does not install a deployment carrier. A dynamic product's owner overlay must
provide image-digest identity, state, saved-plan apply, health, rollback, PR
lifecycle, and real-edge served readback.

Spokes never receive long-lived Cloudflare mutation credentials. Edge intent
crosses to its owning infrastructure flow only through a reviewed product
contract.

## 8. OpenTofu posture

The generic `tofu/` composition is not an application apply plane. It keeps
SemVer-pinned bindings to GloriousFlywheel cache and runner products. Shared
OpenTofu module authority is `tinyland-inc/site.scaffold`; GloriousFlywheel
remains the runner/cache/RBE/execution-product authority. The composition does
not install PR DNS, an application receiver, or the retired
state-namespace/env-reaper IAM module.

Hard rules:

- backend type is S3-compatible with endpoint and credentials supplied by the
  operator environment;
- source never hard-codes provider endpoints or credentials;
- current Tinyland storage is RustFS, never an inferred alternate substrate;
- no OpenTofu target enters Flywheel RBE;
- application workloads, Secrets, admission, and PR lifecycle stay in the
  product owner overlay;
- `tofu apply` is never implied by source review or merge.

## 9. Local escape hatch

Browserful E2E and server-bundle acceptance are remote-first. A local escape is
allowed only when the repository documents and explicitly gates it, for example
`LOCAL=1`. Local output does not substitute for a required served QA route or
real-edge observation.

## 10. Versioning

- Reusable CI references use a reviewed SemVer release or immutable SHA, never
  `@main`.
- Breaking lane-schema changes bump `schema_version` and include migration
  notes.
- GloriousFlywheel target-class changes land in its authority first, then this
  schema, then consumers.
- Sister sites conform to the scaffold tag they deliberately adopted; source
  does not silently mutate them.

## 11. Conformance checklist

`just conformance` checks the enforceable source subset. A complete review also
confirms the manual repository settings and product-owned runtime evidence that
source cannot observe.

- [ ] repository manifest validates and declares the correct role;
- [ ] lanes validate as metadata;
- [ ] reusable CI references are immutable/versioned;
- [ ] Flywheel configuration is endpoint-free and target classes are allowed;
- [ ] in-house packages have zero npm specifiers and complete exact-pinned
  `bazel_dep` / `npm_link_package :pkg` edges;
- [ ] gitleaks working-tree and history recipes exist;
- [ ] no GitHub-hosted runner label (`ubuntu-*`, `macos-*`, `windows-*`) in any
  `runs-on:` under `.github/workflows/`, at any nesting (TIN-3914);
- [ ] SBOM posture matches the manifest;
- [ ] `just substrate-boundary` reports zero direct application/PR receiver
  reaches;
- [ ] production-convergence contract tests pass;
- [ ] default-branch rules and required contexts are read back separately;
- [ ] any product UI change has a real owner-issued QA route and human LOOK;
- [ ] no source check is misreported as `PINNED`, `RUNNING`, or `SERVED`.

## Cross-references

- [`patterns/production-convergence.md`](./patterns/production-convergence.md)
- [`patterns/owner-overlay-apply-plane.md`](./patterns/owner-overlay-apply-plane.md)
- [`patterns/operator-gate-handoff.md`](./patterns/operator-gate-handoff.md)
- [`spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`](./spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md)
- [`agent-adoption.md`](./agent-adoption.md)
