# `tofu/` — spoke infrastructure

This directory composes the five spoke-facing OpenTofu modules from
`tinyland-inc/GloriousFlywheel/tofu/modules/spoke-*`. The lanes contract
lives in [`../docs/CI-SCHEMA.md`](../docs/CI-SCHEMA.md).

## What this provisions

- `module.state_namespace` — S3 prefix `spokes/<slug>/` + env-reaper IAM.
- `module.cache_quota` — Attic + Bazel cache allocation.
- `module.runner_binding` — runner-class hard-deny ACL.
- `module.dns_pr_env` — wildcard `*.pr.<brand_domain>` CNAME + stable
  per-lane CNAMEs.
- `module.blahaj_app_install` — Blahaj GitHub App binding (only if
  `blahaj_installation_id > 0`).

`dynamic-spoke-deploy-target.tf` is a **design-stage, comment-only stub** (TIN-2228)
marking where the adapter-node (dynamic-spoke) blue/green deploy target will be
composed. It declares no resources and does not affect `tofu plan`; see
[`../docs/decisions/dynamic-canary-blue-green.md`](../docs/decisions/dynamic-canary-blue-green.md).

## Hard invariants (CI-SCHEMA §5)

- State backend MUST be **operator-provisioned S3-compatible storage** — in
  Tinyland today that is **RustFS** (never Garage, never MinIO; those are
  hallucinations). The endpoint is **NOT hard-coded** — env/operator authority.
- This directory MUST NOT add OpenTofu actions to Flywheel REAPI
  (`opentofu-validate` and `opentofu-fmt` are blocked at the manifest
  layer).
- Module source ref MUST be a SemVer tag (`?ref=vN.N.N`), never `?ref=main`.

## Usage

```bash
just tofu-init       # downloads modules, configures backend
just tofu-plan       # generates tfplan
just tofu-apply      # applies tfplan
```

## Configuration

Spoke-specific inputs live in `spoke.auto.tfvars`. `scripts/rebrand.sh`
fills in `spoke_slug` and `brand_domain` on template instantiation;
operators set the remaining values manually:

| Variable | Required | Default |
|---|---|---|
| `spoke_slug` | yes (rebrand) | `site-scaffold` |
| `brand_domain` | yes (rebrand) | `elders.tinyland.dev.tinyland.dev` |
| `github_org` | yes | `tinyland-inc` |
| `blahaj_installation_id` | for PR envs | `0` (skip) |
| `allowed_runner_classes` | yes | `["tinyland-nix"]` |
| `lane_allowlist` | for stable lanes | `[]` |
| `cache_quota_gib` | no | `50` |
| `ingress_target` | yes | n/a |

## Backend init

The S3 backend needs the **endpoint + credentials** for the cluster's **RustFS**
instance. Pass via the standard AWS-style env vars (the `aws` provider reads them
automatically; see [OpenTofu S3 backend docs][s3-backend]) before invoking
`just tofu-init`: at minimum `AWS_ENDPOINT_URL_S3` (e.g.
`http://attic-rustfs-hl.nix-cache.svc:9000`), `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY`. Operators typically source these from KeePassXC or
`direnv` `.envrc.local`. **Never** Garage/MinIO — RustFS only.

[s3-backend]: https://opentofu.org/docs/language/settings/backends/s3/

Alternatively use `tofu init -backend-config=...` directly. **Never** commit
credentials to this repo.

## Local-vs-cluster

`just tofu-plan` is laptop-friendly (read-only). `just tofu-apply` requires
cluster reachability for the Kubernetes-provider modules
(`dns_pr_env`, `cache_quota`, `runner_binding`,
`blahaj_app_install`) and is normally run from a cluster-attached
operator host. Per CI-SCHEMA §9, state-mutating operations MUST run from
a cluster runner; ad-hoc laptop `tofu apply` is not the supported path.

## Versioning

The `local.modules_ref = "spoke-tofu-modules-v1.0.0"` pin in `main.tf`
matches the GloriousFlywheel spoke-module tag the scaffold currently
conforms to. Bump in a dedicated PR after reviewing GloriousFlywheel's
CHANGELOG.
