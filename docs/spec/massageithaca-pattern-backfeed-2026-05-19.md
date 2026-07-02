# MassageIthaca Pattern Backfeed - 2026-05-19

MassageIthaca is an application repo, not a static spoke, but its K8s
productionization work exposed patterns that should become Tinyland house style
for static spokes and sister sites. This note is the adoption checklist for
backfeeding those lessons into `site.scaffold`, `ci-templates`, Blahaj, and
GloriousFlywheel without making every spoke rediscover the same decisions.

Read this with
[`tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`](./tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md):
MassageIthaca should consume generic lane, reaper, public-preview, and
Flywheel contracts without being reclassified as a static spoke.

## Adopted Patterns

### 1. Public Client Preview Overlay

Tailnet PR lanes remain the default review surface. Public client review routes
are explicit overlays, requested by a schema-validated dispatch and applied by
Blahaj.

House rule:

- The spoke emits a `public-preview` request payload.
- Blahaj owns Cloudflare DNS, Cloudflare Access, Tunnel ingress, and cleanup.
- Default auth is Cloudflare Access One-time PIN.
- The preview must include at least one allowed email or email domain.
- TTL defaults to 72h and may not exceed 168h without an explicit exception.
- Preview hostnames are purpose-specific, for example `jen-preview.<domain>`.
  Do not recycle retired operational names like `alpha` or `beta`.

Completion metric:

- A spoke can request a preview alias without receiving Cloudflare credentials.
- The preview is source-controlled in Blahaj route authority.
- The reaper can delete DNS, Access app, and Tunnel ingress resources
  idempotently when the PR closes or the TTL expires.

Regression coverage:

- JSON Schema validates the dispatch payload.
- Blahaj route-contract tests require Access OTP, allowlist, proxied CNAME, and
  cleanup metadata.
- Reaper workflow has a dry-run mode and hostname-scoped cleanup.

### 2. Structured Multi-Env Lanes

MassageIthaca proved the value of declaring all PR lane variants in a single
schema file rather than duplicating lane names across workflows, shell env, and
Blahaj intent payloads.

House rule:

- `.github/lanes.json` is the sole spoke-side lane declaration.
- PR lane dispatch is one schema-validated payload carrying all lanes.
- Blahaj owns provisioning, per-lane status, and idempotent destroy.
- Scheduled TTL reap is a separate schema-validated dispatch.
- Branch-name heuristics are tolerated only as migration glue.

Completion metric:

- Adding or removing a lane is a one-file spoke change plus any required Blahaj
  route authority change.
- Each lane gets a stable `ci/lane/<name>` status.
- PR close and TTL expiry both destroy stale lane resources.

Regression coverage:

- `.github/lanes.json` validates against `lanes.schema.json`.
- Dispatch payload validates against `blahaj-dispatch.schema.json`.
- Reap payload validates against `lane-ttl-reap-dispatch.schema.json`.

### 3. Bazel-First Package Consumption

Static spokes still use pnpm/Vite for the canonical static build today, but
Tinyland-owned packages should be treated as Bazel-first artifacts. npm package
references are compatibility edges, not independent authority.

House rule:

- `MODULE.bazel` is the version authority for in-house packages.
- Any in-house package left in `package.json` must use an exact version.
- The npm version must match the corresponding `bazel_dep` version.
- Ranges such as `^`, `~`, wildcard, and disjunctions are forbidden for
  `@tummycrypt/*` and `@tinyland/*`.
- Remote executor proof must show actual executor attachment when claiming RBE
  coverage. Cache hits alone are not proof.

Completion metric:

- `just inhouse-package-parity` passes.
- CI conformance fails on package/module drift.
- Spoke CI delegates remote proof to GloriousFlywheel instead of running
  important Bazel acceptance locally.

Regression coverage:

- `scripts/check-inhouse-package-parity.py` checks `package.json` against
  `MODULE.bazel`.
- `just conformance` includes the parity gate.
- PR templates require remote CI/RBE evidence rather than local-only proof.

### 4. Agent Contract Drift Control

The MassageIthaca work became safer after the repo-local `AGENTS.md` carried
current environment truth, ownership boundaries, and validation posture.

House rule:

- `AGENTS.md` is the operator-facing contract for a spoke.
- It must name the repo role, non-goals, lane posture, preview posture, Bazel
  posture, and validation evidence policy.
- Scratch plans and PR bodies may explain current work, but they do not outrank
  `AGENTS.md` or the schema docs.

Completion metric:

- A new agent can identify the canonical validation surface without reading old
  local scratchpads.
- The agent contract tells it not to add backend/auth/payment surfaces to a
  static spoke.
- Public preview and Bazel/RBE rules are visible before touching workflows.

Regression coverage:

- `just conformance` verifies `AGENTS.md` cites scaffold/schema adoption.
- PR template asks authors to confirm remote proof and package parity.

## Backfeed Tranche Map

| Tranche | Repo | Finish line |
| --- | --- | --- |
| Public preview schema + workflow | `site.scaffold`, `ci-templates` | reusable dispatch action, workflow, schema, docs |
| Public preview apply/reap authority | `blahaj` | generic route validator/reaper plus per-spoke route contract |
| Lane TTL reap | `site.scaffold`, `ci-templates`, `blahaj` | reusable dispatch schema and Blahaj idempotent cleanup |
| Bazel-first package parity | `site.scaffold` | conformance gate over `package.json` and `MODULE.bazel` |
| Remote proof wrapper | `ci-templates`, `GloriousFlywheel` | dispatcher-only action plus GF artifact evidence contract |
| Agent contract refresh | `site.scaffold` | `AGENTS.md` and PR template encode current house posture |

## Non-Goals

- Do not move static spoke production builds to a local-only acceptance model.
- Do not give spokes Cloudflare mutation credentials.
- Do not make OpenTofu or developer-server targets RBE eligible.
- Do not treat a MassageIthaca app-specific backend lane as required for static
  spokes.
- Do not collapse app deployment, bridge runtime, and public-preview edge
  authority into one repo.
