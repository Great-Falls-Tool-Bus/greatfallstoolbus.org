# CI-SCHEMA.md — Tinyland Spoke Site CI & Lane Contract

> **Status**: Normative. Every repository spawned from
> `tinyland-inc/site.scaffold` is governed by the contract in this
> document and the JSON Schemas under [`./schemas/`](./schemas/).
>
> **Companion artifacts:**
> - [`schemas/lanes.schema.json`](./schemas/lanes.schema.json) — the
>   `.github/lanes.json` shape every spoke ships.
> - [`schemas/blahaj-dispatch.schema.json`](./schemas/blahaj-dispatch.schema.json) —
>   the `repository_dispatch` payload sent to `tinyland-inc/blahaj`.
> - [`schemas/public-preview-dispatch.schema.json`](./schemas/public-preview-dispatch.schema.json) —
>   the explicit public/client preview payload sent to `tinyland-inc/blahaj`.
> - [`schemas/lane-ttl-reap-dispatch.schema.json`](./schemas/lane-ttl-reap-dispatch.schema.json) —
>   the scheduled expired-lane sweep payload sent to `tinyland-inc/blahaj`.
>
> **Read this first if** you are: spawning a new sister site, modifying
> the lane config, debugging a per-PR ephemeral env, onboarding a spoke
> to Flywheel RBE, or wiring `tinyland-inc/ci-templates` consumption.
>
> This document is the secondary overlay to [`../AGENTS.md`](../AGENTS.md).
> The two never contradict; `AGENTS.md` is the operating contract,
> `CI-SCHEMA.md` is the wire-format contract.
>
> For the broader distinction between static spokes, app/stateful spokes,
> `tinyland.dev`, Blahaj, and GloriousFlywheel, see
> [`spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`](./spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md).

---

## 1. Purpose & non-goals

### In scope

| Surface | Authority |
|---|---|
| `.github/lanes.json` schema and lifecycle | This doc + [`lanes.schema.json`](./schemas/lanes.schema.json) |
| `repository_dispatch` payload to Blahaj | This doc + [`blahaj-dispatch.schema.json`](./schemas/blahaj-dispatch.schema.json) |
| Flywheel wrapper cache/executor semantics | This doc §5 |
| Allowlist of proved REAPI target classes for spokes | This doc §5; mirrored from `tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json` |
| Runner-class-to-job mapping for static spokes | This doc §6 |
| Per-PR ephemeral env DNS, image tag, TTL, state-namespace rules | This doc §7 |
| Runtime broker-display spoke boundaries | [`spec/runtime-broker-display-2026-05-19.md`](./spec/runtime-broker-display-2026-05-19.md) |
| Public/client preview aliases protected by Cloudflare Access | This doc §8; [`public-preview-dispatch.schema.json`](./schemas/public-preview-dispatch.schema.json) |
| Scheduled expired-lane TTL backstop dispatch | This doc §7; [`lane-ttl-reap-dispatch.schema.json`](./schemas/lane-ttl-reap-dispatch.schema.json) |
| Required CI status checks and branch-protection ruleset name | This doc §9 |
| Gitleaks baseline and local scan recipes | This doc §12 |
| When laptops MAY / MUST run things locally | This doc §10 |
| `tinyland-inc/ci-templates` consumption (SemVer pin) | This doc §11 |
| Spoke-side conformance checklist | This doc §12 |

### Explicitly out of scope

- **Spoke runtime backends** — spokes have no app server, no DB, no auth
  at the edge. They are static projection consumers or read-only
  broker-display clients.
- **Payments, ActivityPub signing/delivery, HTTP-signature key custody,
  public Fediverse federation** — these live in `tinyland.dev` and the public
  Tinyland broker, never in a spoke.
- **Promotion of the current RustFS deployment to RBE CAS/action-cache or
  publication authority** without TIN-1147 closure — hard invariant.
- **Making OpenTofu RBE-eligible** — hard invariant.
- **Image publication policy** — `container-image-and-push` is blocked at
  the GloriousFlywheel manifest layer (image assembly + push is never
  remote-execution eligible). A spoke whose ARC pool provides a Docker-daemon
  runner pushes via standard GHCR/buildx flows from `tinyland-dind`. A spoke
  whose pool advertises only `tinyland-nix` (e.g., Great-Falls-Tool-Bus)
  instead builds the image DAEMONLESS via Nix
  (`nix/oci-image.nix` -> `dockerTools.streamLayeredImage`) + skopeo on
  `tinyland-nix` through `./GloriousFlywheel/.github/actions/nix-job` — no
  Docker daemon, no buildx (TIN-2543). Either way the shared cache only
  accelerates the SvelteKit build inputs; it never remotely executes the push.
- **The contents of `tinyland-inc/blahaj` itself** — this doc fixes the
  *wire* Blahaj receives, not its implementation.
- **Cloudflare credentials in spokes** — public DNS, Access, and Tunnel
  mutation credentials stay in Blahaj-owned protected environments.
- **Rules for `tinyland.dev` itself** — this doc governs spokes only.

---

## 2. The trunks+N model

A **lane** is a parallel configuration of the same commit. Every spoke
runs at least one lane (the default `main` lane); multi-trunk spokes
(e.g., the MassageIthaca acuity/bridge/homegrown pattern) declare N
lanes in `.github/lanes.json`.

### Lifecycle (PR-triggered lane)

```
PR opened/synchronized
  └─► spoke-ci.yml
        ├─► secrets-scan       (ubuntu-latest)
        ├─► lanes-load         (validate .github/lanes.json)
        ├─► flywheel-bazel-*   (per-lane matrix: build, test)
        └─► bazel-graph        (tinyland-nix-heavy)

PR opened/synchronized
  └─► lane-env.yml (spoke-lane-env.yml)
        ├─► lanes-load
        ├─► publish-image      (per-lane matrix, GHCR push)
        ├─► dispatch-apply     (one repository_dispatch carrying all N lanes)
        │     └─► Blahaj fans out → N envs provisioned in parallel
        │          └─► N `ci/lane/<name>` commit statuses posted on PR head SHA
        ├─► tailnet-qa         (per-lane matrix, filtered to e2e: true)
        └─► lane-status-check-finalize

PR closed (merged or not)
  └─► lane-env.yml on:[closed]
        └─► destroy-lanes      (one repository_dispatch, operation: destroy)
              └─► Blahaj reaps N envs idempotently

Hourly (scheduled-lane-reap.yml in ci-templates)
  └─► TTL backstop
        └─► Reap any PR env past its effective TTL
```

### Key contractual properties

1. **One image build per lane per commit.** Image is lane-agnostic
   unless the spoke's `lanes.json` sets `image_tag_template` with a
   `{LANE}` token.
2. **One dispatch carrying all lanes** — not N dispatches. This
   eliminates the MassageIthaca duplication bug where lane names were
   declared twice (once in `PR_ENV_TARGETS_JSON`, once inline in the
   dispatch `styles` array).
3. **Per-lane GitHub commit status checks** named `ci/lane/<name>`
   so branch protection can gate per-lane.
4. **Reap is idempotent.** Destroying an already-absent env is success.

---

## 3. `lanes.json` JSON Schema

Full schema: [`schemas/lanes.schema.json`](./schemas/lanes.schema.json).
Top-level shape (annotated):

```jsonc
{
  "schema_version": 1,                    // const; bumped on breaking changes
  "spoke": {
    "name": "site-scaffold",              // pattern: ^[a-z][a-z0-9-]{1,62}$
    "domain": "greatfallstoolbus.org.tinyland.dev",
    "image_repository": "ghcr.io/<owner>/<name>"   // optional; default at workflow time
  },
  "defaults": {                           // optional; per-lane overrides win
    "runner_class": "tinyland-nix",
    "ttl_hours": 72,
    "image_tag_template": "pr-{PR_NUMBER}-sha-{COMMIT_SHA}",
    "trigger": "pull_request",
    "e2e": false,
    "flywheel_target_classes": []
  },
  "lanes": [                              // minItems 1, maxItems 8
    {
      "name": "default",                  // pattern: ^[a-z][a-z0-9-]{0,30}$
      "trigger": "pull_request",          // pull_request | merge_main | release_tag | manual
      "theme": "scaffold",                // brand theme key
      "snapshot_source": "checked-in",    // tinyland://pulse/m1, broker:<route>, URL, or checked-in
      "runner_class": "tinyland-nix",     // optional override
      "e2e": false,
      "ttl_hours": 24,
      "tofu_state_suffix": "default",
      "image_tag_template": "...",
      "flywheel_target_classes": [...],
      "extra": { /* free-form, JSON-serializable, lane-scoped */ }
    }
  ]
}
```

### Example A — single-lane default spoke

This is the shipped template content. New sister sites start here.

```json
{
  "schema_version": 1,
  "spoke": {
    "name": "site-scaffold",
    "domain": "greatfallstoolbus.org.tinyland.dev"
  },
  "defaults": {
    "runner_class": "tinyland-nix",
    "ttl_hours": 72,
    "flywheel_target_classes": ["sveltekit-app-build", "sveltekit-unit-tests"]
  },
  "lanes": [
    {
      "name": "default",
      "trigger": "pull_request",
      "theme": "scaffold",
      "snapshot_source": "checked-in",
      "e2e": false
    }
  ]
}
```

### Example A2 - runtime broker-display blog spoke

```json
{
  "schema_version": 1,
  "spoke": {
    "name": "transscendsurvival-org",
    "domain": "transscendsurvival.org"
  },
  "defaults": {
    "runner_class": "tinyland-nix",
    "ttl_hours": 72,
    "flywheel_target_classes": ["sveltekit-app-build", "sveltekit-unit-tests"]
  },
  "lanes": [
    {
      "name": "default",
      "trigger": "pull_request",
      "theme": "transscend",
      "snapshot_source": "broker:/projections/jesssullivan-github-io/blog/broker-stream.v1.json",
      "e2e": true,
      "extra": {
        "content_transport": "dynamic-broker-stream",
        "broker_origin": "https://hub.tinyland.dev",
        "checked_in_post_payloads": false,
        "spoke_mutation_api": false,
        "spoke_activitypub_worker": false
      }
    }
  ]
}
```

### Example B — three-lane MassageIthaca-shaped spoke

```json
{
  "schema_version": 1,
  "spoke": {
    "name": "massageithaca",
    "domain": "massageithaca.com"
  },
  "defaults": {
    "runner_class": "tinyland-nix",
    "ttl_hours": 72,
    "image_tag_template": "pr-{PR_NUMBER}-sha-{COMMIT_SHA}",
    "flywheel_target_classes": [
      "sveltekit-app-build",
      "sveltekit-unit-tests",
      "deployment-bundle-packaging"
    ]
  },
  "lanes": [
    {
      "name": "acuity",
      "trigger": "pull_request",
      "theme": "mi-default",
      "snapshot_source": "tinyland://pulse/m1",
      "e2e": false,
      "extra": { "style": "acuity-hosted", "selfServiceBooking": false }
    },
    {
      "name": "bridge",
      "trigger": "pull_request",
      "theme": "mi-default",
      "snapshot_source": "tinyland://pulse/m1",
      "e2e": true,
      "extra": { "style": "acuity-bridge", "selfServiceBooking": true }
    },
    {
      "name": "homegrown",
      "trigger": "pull_request",
      "theme": "mi-default",
      "snapshot_source": "tinyland://pulse/m1",
      "e2e": true,
      "extra": { "style": "homegrown", "selfServiceBooking": true }
    }
  ]
}
```

---

## 4. Blahaj dispatch payload schema

Full schema:
[`schemas/blahaj-dispatch.schema.json`](./schemas/blahaj-dispatch.schema.json).

The composite action `tinyland-inc/ci-templates/.github/actions/lane-dispatch`
MUST construct this payload from the spoke's `lanes.json`. The composite
action `lane-reap` MUST emit the same shape with `operation: "destroy"`.
Blahaj has exactly one handler per spoke event_type; the `operation`
field discriminates.

### Provision example

```json
{
  "event_type": "massageithaca-lane-env",
  "client_payload": {
    "schema_version": 1,
    "operation": "provision",
    "spoke": "massageithaca",
    "domain": "massageithaca.com",
    "pr_number": 312,
    "source_ref": "refs/pull/312/head",
    "commit_sha": "<full-40-char-commit-sha>",
    "image_ref": "ghcr.io/jesssullivan/massageithaca:pr-312-sha-<full-40-char-commit-sha>",
    "ttl_hours": 72,
    "tofu_state_prefix": "massageithaca/312",
    "lanes": [
      { "name": "acuity",    "fqdn": "pr-312-acuity.massageithaca.com",    "theme": "mi-default", "snapshot_source": "tinyland://pulse/m1", "e2e": false, "extra": { "style": "acuity-hosted",  "selfServiceBooking": false } },
      { "name": "bridge",    "fqdn": "pr-312-bridge.massageithaca.com",    "theme": "mi-default", "snapshot_source": "tinyland://pulse/m1", "e2e": true,  "extra": { "style": "acuity-bridge",  "selfServiceBooking": true  } },
      { "name": "homegrown", "fqdn": "pr-312-homegrown.massageithaca.com", "theme": "mi-default", "snapshot_source": "tinyland://pulse/m1", "e2e": true,  "extra": { "style": "homegrown",      "selfServiceBooking": true  } }
    ]
  }
}
```

### Destroy example

```json
{
  "event_type": "massageithaca-lane-env",
  "client_payload": {
    "schema_version": 1,
    "operation": "destroy",
    "spoke": "massageithaca",
    "pr_number": 312,
    "source_ref": "refs/pull/312/head",
    "commit_sha": "<full-40-char-commit-sha>",
    "image_ref": "expired-destroy",
    "ttl_hours": 1,
    "tofu_state_prefix": "massageithaca/312",
    "lanes": [
      { "name": "acuity",    "fqdn": "pr-312-acuity.massageithaca.com" },
      { "name": "bridge",    "fqdn": "pr-312-bridge.massageithaca.com" },
      { "name": "homegrown", "fqdn": "pr-312-homegrown.massageithaca.com" }
    ]
  }
}
```

---

## 5. Flywheel binding contract

Spokes opt into Flywheel through the repo wrapper
`scripts/gloriousflywheel-bazel.sh`, not by hard-coding endpoint values in
`.bazelrc`.

| Environment | Effect | Safe on |
|---|---|---|
| `GF_FLYWHEEL_PROFILE_STATE=unattached` | Explicitly no Flywheel profile attached. `just flywheel-verify` fails closed before cache-backed work. | Any fresh shell before enrollment. |
| `GF_FLYWHEEL_PROFILE_STATE=shared-cache-backed` | The shell/runner has a fleet profile for shared Bazel remote cache use. Must agree with `GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed`. | Developer shells and cluster runners with a real cache endpoint. |
| `GF_FLYWHEEL_PROFILE_STATE=executor-backed` | The shell/runner has a fleet profile for opt-in REAPI executor use. Must agree with `GF_BAZEL_SUBSTRATE_MODE=executor-backed`. | Cluster runners and proved target classes only. |
| `GF_FLYWHEEL_PROFILE_STATE=local-proof` | Bounded operator proof through a local port-forward. Requires `GF_BAZEL_LOCAL_PROOF=port-forward`. | Manual proof only; not product evidence for broad/default RBE. |
| `BAZEL_REMOTE_CACHE` + `GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed` | Remote cache only. The wrapper passes `--remote_cache` explicitly and defaults uploads off. | Cluster-reachable runners, or operator-provided routable developer endpoints. |
| `BAZEL_REMOTE_INSTANCE_NAME=spoke-<slug>` | Non-secret REAPI routing metadata. The wrapper passes `--remote_instance_name` so CAS/AC/RBE requests land in the expected tenant instead of Bazel's `default` instance. | Token-enforced cache/executor paths with a tenant-scoped credential. |
| `GF_BAZEL_JOBS` / `BAZEL_REMOTE_MAX_CONNECTIONS` | Optional executor throttles. The wrapper passes them as `--jobs` and `--remote_max_connections` in executor-backed mode only. | Bounded proof lanes and small executor pools where the tenant cap is lower than Bazel's default fan-out. |
| Above plus `BAZEL_REMOTE_EXECUTOR` + `GF_BAZEL_SUBSTRATE_MODE=executor-backed` | Remote executor plus cache. The wrapper adds `--remote_executor`, disables local fallback, forces `--spawn_strategy=remote`, adds worker platform property, and selects the endpoint-free `flywheel-executor` config. | Cluster runners only. Composite action `flywheel-bazel` MUST refuse this mode on `ubuntu-latest`. |

The advertised operator/agent path is `just flywheel-enroll`, then
`just flywheel-doctor`, then `just flywheel-verify`. The first command explains
or materializes an ignored local fallback from explicit endpoint data; it does
not mint tokens or store bearer credentials. The preferred source is the
GloriousFlywheel Home Manager/NixOS profile distribution, which exports
`GF_FLYWHEEL_PROFILE_STATE` plus non-secret endpoint metadata.

Pull requests MUST leave `GF_BAZEL_REMOTE_UPLOAD` false or unset. Trusted
default-branch or operator lanes may set `GF_BAZEL_REMOTE_UPLOAD=true`
explicitly. `.bazelrc.flywheel` is allowed to define safe behavior such as
timeouts, `remote_download_minimal`, worker platform hints, and
`flywheel-eligible` tag filters; it MUST NOT define `remote_cache`,
`remote_executor`, or upload authority.

Authentication material is runtime authority. The wrapper may accept
environment-provided `BAZEL_CREDENTIAL_HELPER`, `BAZEL_REMOTE_HEADER`,
`BAZEL_REMOTE_CACHE_HEADER`, and `BAZEL_REMOTE_EXEC_HEADER` values and pass them
as Bazel flags. These values MUST NOT appear in `.bazelrc`, workflow YAML,
checked-in examples, docs, or Justfile defaults. `BAZEL_REMOTE_INSTANCE_NAME` is
routing metadata, not a secret; it may be documented, but must still come from
the profile/operator environment rather than checked-in endpoint defaults.
Executor throttles are also runtime profile metadata; they document the current
proof envelope and must not become a substitute for server-side queueing.

### Proved-class allowlist for static spokes

Mirrored from
`tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json` at
the tag this schema was cut against. The enum in
[`schemas/lanes.schema.json`](./schemas/lanes.schema.json) is the
authoritative gate; adding a class to a spoke's
`flywheel_target_classes` without a matching scaffold tag fails CI
schema validation.

| Target class | Status | executor-backed wrapper allowed? |
|---|---|---|
| `sveltekit-app-build` | proved | ✅ |
| `sveltekit-unit-tests` | proved | ✅ |
| `deployment-bundle-packaging` | proved | ✅ |
| `docs-site-static-build` | proved | ✅ |
| `web-playwright-chromium-static-smoke` | candidate | ❌ — rejected at runtime until promoted |

### How to add a target class

1. PR to `tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json`
   promoting a candidate to `proved`. Proof MUST cite:
   - default-branch `workflow_run` ID
   - artifact ID
   - `remote_processes > 0`
   - `worker_image_digest`
2. After merge, PR to `greatfallstoolbus.org` bumping the enum in
   `lanes.schema.json` and adding a row to this table. Tag the next
   `greatfallstoolbus.org` minor version.
3. Spokes adopt by bumping their `ci-templates` SemVer pin (§11) and
   editing `lanes.json.flywheel_target_classes`.

### Hard invariants (verbatim)

- Current RustFS is not trusted RBE CAS / action-cache / publication authority
  until TIN-1147 proves repair or replacement. Do not promote it from this
  manifest or any spoke.
- Do **not** make OpenTofu targets (`opentofu-validate`, `opentofu-fmt`)
  RBE-eligible. They are blocked at the manifest layer and MUST NOT
  appear in any spoke's `flywheel_target_classes`.
- Do **not** make developer-server targets (`//app:dev`) RBE-eligible.
  Devservers are interactive long-running local processes; remote
  execution proof requires bounded actions with declared outputs.
- State authority remains in env-owned S3-compatible buckets; the
  `tofu_state_prefix` rules in §7 are the only state-routing surface
  this schema controls.
- Spokes MUST NOT count remote cache hits, ARC runner dispatch, or
  GitHub-hosted execution as "RBE".

---

## 6. Runner class matrix

| Job | Default `runs-on` | Why | executor-backed wrapper? |
|---|---|---|---|
| `secrets-scan` (gitleaks) | `ubuntu-latest` | Org-default; security-gating concern, runs before any cluster reachability is assumed. | no |
| `build-and-test` (`just check`, `just build`) | `tinyland-nix` | Canonical Nix devshell. | yes (proved classes only) |
| `bazel-graph` (`bazelisk mod graph`, wrapper build for `//:node_modules`) | `tinyland-nix-heavy` | Graph queries are memory-hungry. | yes (proved classes only) |
| `bazel-rbe-proof` (optional) | `tinyland-nix-heavy` | Dispatches/awaits GloriousFlywheel proof. | n/a (dispatcher only) |
| `publish-image` (dind pools) | `tinyland-dind` | Container build + push to GHCR (buildx). | no (`container-image-and-push` blocked) |
| `publish-image` (nix-only pools, e.g. GFTB) | `tinyland-nix` | Daemonless Nix image build (`dockerTools.streamLayeredImage`) + skopeo push via the nix-job action; the pool has no `tinyland-dind` (TIN-2543). | no (`container-image-and-push` blocked) |
| `lane-qa` (waits for envs, runs E2E) | `tinyland-nix-kvm` | Needs tailnet join + Playwright. | candidate (`web-playwright-chromium-static-smoke`), gated |
| `dispatch-apply` / `dispatch-reap` | `ubuntu-latest` | Pure `gh api` calls; no cluster reachability needed. | n/a |
| `pulse-ingest` (snapshot refresh PRs) | `tinyland-nix` | Nix devshell. | no |

**Escape hatch rule:** `runs-on: ubuntu-latest` is permitted only for
jobs whose entire purpose is a `gh api` call, a webhook dispatch, or a
security gate that must execute before cluster trust is established.
Every other job MUST use a `tinyland-*` class.

---

## 7. Per-PR ephemeral env contract

### DNS naming

`pr-{PR_NUMBER}-{LANE}.<spoke.domain>` by default. Override at lane
level via `lanes[].domain` (full FQDN). The composite action
`lane-dispatch` computes this from `lanes.json`; workflows MUST NOT
hardcode lane URLs.

### Image tagging

`pr-{PR_NUMBER}-sha-{COMMIT_SHA}` (full SHA). Override via
`defaults.image_tag_template` or `lanes[].image_tag_template`. Tokens:
`{PR_NUMBER}`, `{COMMIT_SHA}`, `{LANE}`. The image is lane-agnostic by
default; if a spoke needs per-lane images, it includes `{LANE}` in the
template.

### TTL rules

- **Default**: `defaults.ttl_hours` (schema default 72).
- **Per-lane override**: `lanes[].ttl_hours`.
- **Per-PR override via label**: `lane-ttl/7d`, `lane-ttl/30d`,
  `lane-ttl/keep` raise the TTL for *that PR*. `lane-ttl/keep` pins to
  720h (the schema max) — no infinite TTLs.
- Labels that would *lower* the TTL are rejected by the `lane-dispatch`
  composite action. TTL is a floor for visibility, not a ceiling.

### Reap triggers

All three MUST be implemented in `tinyland-inc/ci-templates`:

1. `pull_request: closed` → immediate reap dispatch.
2. **TTL backstop**: a scheduled workflow calls
   `spoke-lane-ttl-reap.yml`, which sends a
   `<spoke>-lane-ttl-reap` dispatch. Blahaj lists PR envs and destroys
   any past TTL — covers GH webhook misses.
3. **Manual** `workflow_dispatch: lane-reap` accepting `pr_number`.

### Idempotency

Reap MUST be safe to run twice. Blahaj handlers MUST treat "env does
not exist" as success on a destroy. The `lane-dispatch` composite
MUST NOT fail if a previous reap already succeeded — it sends and
exits 0.

### State-namespace rules

S3 key prefix: `<spoke.name>/<pr_number>/<lane.tofu_state_suffix || lane.name>/`.

The `lane-dispatch` composite derives this and passes it as
`tofu_state_prefix` in the dispatch payload. The payload carries a key prefix,
not a provider choice. Bucket endpoints are env-owned S3-compatible storage
selected by operators. In Tinyland today that storage plane is RustFS, but
spokes must not hard-code provider endpoints in workflows, Just recipes, or
Tofu files.

---

## 8. Public preview overlay

Tailnet PR lanes are the default review surface. A public/client preview is an
explicit overlay on top of an already-provisioned lane, not a replacement for
the lane lifecycle.

### Contract

Spokes request public previews by dispatching
`<spoke>-public-preview` with a payload that validates against
[`schemas/public-preview-dispatch.schema.json`](./schemas/public-preview-dispatch.schema.json).
The payload names the source repository, PR, commit, lane, existing origin FQDN,
requested public hostname, TTL, and Cloudflare Access allowlist.

Default posture:

- `auth.provider`: `cloudflare-access`
- `auth.identity_provider`: `One-time PIN`
- `auth.session_duration`: `24h`
- `ttl_hours`: `72`, max `168`
- at least one `allow_emails` or `allow_email_domains` entry

### Ownership

Blahaj owns Cloudflare DNS records, Access applications/policies, Tunnel ingress
rules, and reaping. Spoke workflows do not receive Cloudflare credentials and do
not call the Cloudflare API directly. One-off API-first emergency repairs must be
source-captured in Blahaj before they are treated as durable infrastructure.

### Naming

Prefer client- or purpose-specific names such as
`jen-preview.example.com`. Do not recycle retired validation names such as
`beta` or branch-name namespaces. Public preview routes must carry source PR,
source commit, expiry, and cleanup policy in Blahaj source state.

---

## 9. CI gate contract

### Required status checks

| Check | When required |
|---|---|
| `secrets-scan` | always |
| `build-and-test` | always |
| `bazel-graph` | always |
| `ci/lane/<name>` | one per entry in `lanes.json.lanes`, posted by Blahaj against the head SHA |
| `lane-qa` | when any lane has `e2e: true` |
| `bazel-rbe-proof` | when `flywheel_target_classes` is non-empty |
| `public-preview-dispatch` | only when a PR asks for a public/client preview |

### Org-level ruleset

Branch protection ruleset name: **`tinyland-spoke-default`**. Source of
truth: `tinyland-inc/.github` (currently empty profile — seeding this
ruleset is a follow-up tracked in the implementation plan).

Spokes import the ruleset via the GitHub org UI or via Terraform
managed in `tinyland-infra`. Per-repo overlay: a spoke MAY add
additional checks but MUST NOT remove any from the default set without
an exception comment in its `AGENTS.md`.

---

## 10. `--local` escape-hatch contract

Reconciles the existing `nix develop`-first DX with cluster-first CI.

| Activity | `--local` allowed? | Required path |
|---|---|---|
| `just dev`, `just preview`, doc edits | yes | always local |
| `just check` (gitleaks dir scan + svelte-check + lint + unit) | yes | local or cluster; recipe accepts both |
| `just build` (artifact-producing) | yes for ad-hoc; **no** for any artifact that will be uploaded, deployed, or used as a release input | local OK for dev; cluster MUST for CI |
| `just bazel-graph` | yes (laptop) for graph reading | cluster MUST for cache-uploading or executor-backed builds |
| `just flywheel-enroll`, `just flywheel-doctor`, `just flywheel-verify` | yes; read-only enrollment diagnostics | local or cluster |
| `just flywheel-build`, `just flywheel-test`, `scripts/gloriousflywheel-bazel.sh ...` | only after `just flywheel-verify` passes with a real `BAZEL_REMOTE_CACHE` | cluster-only for executor-backed mode |
| Anything that mutates state (`tofu apply`, image push, snapshot publish) | no | cluster MUST |
| `just validate-static-projection`, `just pulse-ingest` (read-only) | yes | local or cluster |

### Recipe contract

Every Flywheel Bazel recipe MUST fail fast when `BAZEL_REMOTE_CACHE` is absent.
The scaffold does not silently fall back to heavy local Bazel for artifact or
executor-shaped work. Local graph inspection remains available through
`just bazel-graph`.

---

## 11. Versioning & evolution

### `ci-templates` consumption

Spokes reference reusable workflows as:

```yaml
uses: tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml@v2.7.0
```

**Never `@main`.** `@main` is the develop branch and breaks without
notice; `@v2` is a floating tag for quick-start documentation only;
`@v2.7.0` is the current immutable pin spokes should use. Renovate / Dependabot
tracks the pin.

### `lanes.json` schema versioning

Top-level `schema_version` (currently `1`). Breaking changes bump it;
migration notes go in `docs/CI-SCHEMA-CHANGELOG.md` (created when v2
ships). The scaffold ships a `just migrate-lanes` recipe for forward
migration at that time.

### Allowlist updates

Flow: GloriousFlywheel manifest PR → enum bump in `lanes.schema.json`
→ this scaffold tagged → spoke bumps `ci-templates` pin → spoke edits
its `lanes.json.flywheel_target_classes`. The allowlist enum is the
authoritative gate.

### This doc's tag

Every change to `CI-SCHEMA.md` bumps `greatfallstoolbus.org`'s git tag. Spokes
consume a specific scaffold tag at template-instantiation time and may
stay on it; conformance is checked against the tag they were spawned
from until they explicitly upgrade.

---

## 12. Conformance checklist

A spoke is "house-style compliant" if all 17 items below pass.
`scripts/check-conformance.sh` (shipped in this scaffold) implements
the mechanical items.

- [ ] `tinyland.repo.json` exists, validates against
  `docs/schemas/tinyland-repo-manifest.schema.json`, and declares
  `static-spoke` or `static-spoke-scaffold` for this scaffold.
- [ ] `.github/lanes.json` exists and validates against
  `lanes.schema.json` at the scaffold tag the repo was spawned from.
- [ ] `.github/workflows/ci.yml` references
  `tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml` pinned by
  SemVer (not `@main`, not `@<sha>` longer than 30 days old without
  justification).
- [ ] Repo imports the org ruleset `tinyland-spoke-default`
  (verified via `gh api repos/{owner}/{repo}/rulesets`).
- [ ] Required status checks listed in §9 are all configured.
- [ ] `flywheel_target_classes` (if present) is a subset of the proved
  allowlist in §5.
- [ ] No `runs-on: ubuntu-latest` in jobs that touch state, build
  images, or run Bazel.
- [ ] `scripts/gloriousflywheel-bazel.sh` exists and every Flywheel Bazel
  operation recipe (`flywheel-build`, `flywheel-test`, `flywheel-run`,
  `flywheel-coverage`, `flywheel-fetch`, `flywheel-info`) calls it instead of
  raw `bazelisk`.
- [ ] `just flywheel-enroll`, `just flywheel-doctor`, and
  `just flywheel-verify` exist, inspect `GF_FLYWHEEL_PROFILE_STATE`, and fail
  closed before cache-backed Bazel work.
- [ ] No hard-coded `remote_cache`, `remote_executor`, or cache-upload authority
  appears in `.bazelrc.flywheel`, Justfile, or workflow YAML.
- [ ] No provider-specific state endpoint, and no RBE CAS/action-cache
  authority, appears in `Justfile`, `tofu/`, or workflow YAML.
- [ ] No reference to OpenTofu targets in `flywheel_target_classes`.
- [ ] `spoke.image_repository` matches `ghcr.io/<repo-owner>/<spoke.name>`
  or is explicitly overridden with an in-file comment.
- [ ] Tailnet DNS for each lane resolves to a runner-reachable address.
- [ ] `AGENTS.md` cites the scaffold tag the repo conforms to.
- [ ] In-house `@tummycrypt/*` / `@tinyland/*` package versions in
  `package.json` are exact and match corresponding `bazel_dep` versions in
  `MODULE.bazel` when a Bazel module exists.
- [ ] `.gitleaks.toml` extends the default gitleaks ruleset, the Nix dev shell
  includes gitleaks, and `Justfile` exposes both working-tree and git-history
  gitleaks scan recipes.
- [ ] If `tinyland.repo.json` declares SBOM status `recipe-available` or
  `generated`, `Justfile` exposes `just sbom` and the Nix dev shell includes
  `syft`.

---

## 13. Diagrams

### PR lifecycle across lanes

```mermaid
sequenceDiagram
  autonumber
  actor Dev as Developer
  participant PR as GitHub PR
  participant CI as Spoke CI<br/>(spoke-ci.yml + lane-env.yml)
  participant GHCR
  participant BH as Blahaj
  participant CL as Cluster (envs)
  participant ST as GitHub Status API

  Dev->>PR: open PR
  PR->>CI: pull_request: opened
  par per-lane build
    CI->>CI: secrets-scan + lanes-load + bazel-graph
    CI->>GHCR: publish-image (one per lane, tag pr-N-sha-XXXX)
  end
  CI->>BH: one repository_dispatch carrying lanes[] (N lanes)
  par parallel provisioning
    BH->>CL: provision env (acuity)
    BH->>CL: provision env (bridge)
    BH->>CL: provision env (homegrown)
  end
  BH->>ST: post N `ci/lane/<name>` status checks
  CI->>BH: wait for N health checks
  CI->>CL: tailnet-qa (lanes filtered to e2e: true)
  Dev->>PR: close/merge
  PR->>CI: pull_request: closed
  CI->>BH: repository_dispatch operation=destroy
  par reap
    BH->>CL: destroy env (acuity)
    BH->>CL: destroy env (bridge)
    BH->>CL: destroy env (homegrown)
  end
  Note over BH,CL: Hourly TTL backstop sweeps any envs past TTL,<br/>covers webhook misses. Destroy is idempotent.
```

### Flywheel binding flow

```mermaid
flowchart TD
  A[Developer or CI starts<br/>Flywheel work] --> AA[just flywheel-enroll<br/>doctor / verify]
  AA --> B{GF_FLYWHEEL_PROFILE_STATE<br/>attached?}
  B -->|no| E[ERROR: fail fast<br/>no heavy local fallback]
  B -->|yes| C{nix devshell}
  C --> D[scripts/gloriousflywheel-bazel.sh]
  D --> DD{BAZEL_REMOTE_CACHE set<br/>and real endpoint?}
  DD -->|no| E
  DD -->|yes| F{GF_BAZEL_SUBSTRATE_MODE}
  F -->|shared-cache-backed| G[Remote cache only<br/>uploads default false]
  F -->|executor-backed| H{BAZEL_REMOTE_EXECUTOR set<br/>and cluster-safe?}
  F -->|unset / invalid| E
  H -->|no| E
  H -->|yes| I{target class<br/>in proved allowlist?}
  I -->|no| J[ERROR: refuse,<br/>exit non-zero]
  I -->|yes| K[Dispatch to gf-reapi-cell executor<br/>+ remote cache]
  G --> L[Action results read from cache;<br/>writes only when trusted lane opts in]
  K --> L
  L --> M[Done]
  E --> M

  classDef invariant fill:#fde,stroke:#c33,color:#000
  X[/Hard invariants<br/>current RustFS is not trusted CAS/AC/publication authority<br/>OpenTofu cannot reach executor branch<br/>developer-servers cannot reach executor branch<br/>cache hits are not RBE/]:::invariant
```

---

## Cross-references

- [`../AGENTS.md`](../AGENTS.md) — operating contract; superordinate
  for repo posture rules. This doc is the wire-format complement.
- `tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json` —
  upstream source of the proved-class allowlist.
- `tinyland-inc/ci-templates@v2.7.0` — the versioned reusable
  workflows and composite actions this contract assumes.
- `tinyland-inc/tinyland-infra/modules/spoke/*` — the five spoke-facing
  Tofu modules (`dns-pr-env`, `state-namespace`, `cache-quota`,
  `runner-binding`, `blahaj-app-install`) consumed by
  `tofu/main.tf`.
- `tinyland-inc/blahaj` — receiver of the `repository_dispatch`
  payload defined in §4. This doc fixes the wire; Blahaj owns the
  implementation.
- [`schemas/lanes.schema.json`](./schemas/lanes.schema.json),
  [`schemas/blahaj-dispatch.schema.json`](./schemas/blahaj-dispatch.schema.json),
  [`schemas/public-preview-dispatch.schema.json`](./schemas/public-preview-dispatch.schema.json),
  [`schemas/lane-ttl-reap-dispatch.schema.json`](./schemas/lane-ttl-reap-dispatch.schema.json)
  — companion JSON Schemas referenced throughout.
