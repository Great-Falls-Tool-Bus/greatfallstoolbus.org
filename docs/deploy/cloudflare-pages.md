# Deploy lane: Cloudflare Pages (spinning down)

GFTB currently serves from Cloudflare Pages per ADR 0003. **ADR 0010 (operator
ruled 2026-07-05) made on-prem the production host and spins Cloudflare Pages
down**: on-prem serving behind the in-cluster `cloudflared` tunnel is the
accepted host, with **adapter-static served by a simple in-cluster static file
server as the primary path** (the adapter-node OCI image is retained only as the
reserved path for a future server need). Cloudflare Pages is kept **warm only
during the cutover window** and is then decommissioned (the project deleted and
the `Pages:Edit` token retired); it is **not** a permanent standby.

The cutover is operator-gated and not yet applied (ADR 0010 §5), so Cloudflare
Pages remains the *live* host and this lane stays authoritative for production
**until the cutover completes**. This repo does not carry the Wrangler
implementation locally anymore;
`.github/workflows/deploy-pages.yml` is a thin wrapper around the reusable
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

The shared lane builds the adapter-static `build/` with the house
`nix develop --command just setup/check/build` entrypoints, resolves the
Cloudflare Pages project name from the repo slug (`greatfallstoolbus-org` by
default), and runs `wrangler pages deploy build` only outside pull requests.

Credentials are org-provisioned GitHub secrets:
`CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID`. They are inherited by name
by the called workflow and are never stored in source. When either secret is
absent, the reusable workflow prints a notice and skips deployment. Pull
requests build only and never mutate Pages, DNS, Access, or repo settings.

Blahaj and the `great-falls-tool-bus-infra` overlay own DNS, Cloudflare Access,
Tunnel, and edge apply authority. This public repo owns only the static artifact
and the wrapper that asks Cloudflare Pages to publish it.
