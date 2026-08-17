# Deploy lane: Cloudflare Pages (RETIRED — project deleted, historical reference only)

> **STATUS (2026-07-07): retired as the serving lane AND deleted.** ADR 0010
> (`docs/decisions/0010-on-prem-is-the-production-host.md`) executed the
> cutover ADR 0008 accepted: production serves on-cluster (`adapter-node` ->
> OCI image -> K8s -> `cloudflared`), not Cloudflare Pages. Per ADR 0010
> Amendment 2 (TIN-2560), the operator closed the cutover-rollback window early
> and the `greatfallstoolbus-org` Pages project was **deleted 2026-07-06**
> (PR #122/#123, workflow run 28801030150) along with the repo's `Pages:Edit`
> token, rather than held warm through ~2026-07-08.
> `.github/workflows/deploy-pages.yml` — the workflow this doc describes below
> — has been removed (`chore/retire-pages-lane`). This page is kept as a
> historical reference to a lane that no longer exists in any form (no
> project, no warm standby, no rollback target); see
> [`docs/runbooks/cf-pages-rollback.md`](../runbooks/cf-pages-rollback.md) for
> why the rollback procedure it once described is no longer reachable and what
> the current rollback path is instead.

Historical description of the retired lane, for reference: this repo did not
carry the Wrangler implementation locally; the removed
`.github/workflows/deploy-pages.yml` was a thin wrapper around the reusable
Tinyland lane:

```yaml
jobs:
  deploy:
    permissions:
      contents: read
      deployments: write
    uses: tinyland-inc/ci-templates/.github/workflows/spoke-deploy-cloudflare-pages.yml@v2.10.0
    secrets: inherit
```

The shared lane built the adapter-static `build/` with the house
`nix develop --command just setup/check/build` entrypoints, resolved the
Cloudflare Pages project name from the repo slug (`greatfallstoolbus-org` by
default), and ran `wrangler pages deploy build` only outside pull requests.

Credentials were org-provisioned GitHub secrets: `CLOUDFLARE_API_TOKEN` plus
`CLOUDFLARE_ACCOUNT_ID`, inherited by name by the called workflow and never
stored in source. Pull requests built only and never mutated Pages, DNS,
Access, or repo settings.

Blahaj and the `great-falls-tool-bus-infra` overlay own DNS, Cloudflare Access,
Tunnel, and edge apply authority — unaffected by this lane's retirement. See
`docs/DEVELOPMENT.md` "Deploying" for the current on-cluster serving lane.
