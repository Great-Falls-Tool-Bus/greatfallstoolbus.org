# Deploy lane: Cloudflare Pages (opt-in)

The scaffold's **default** deploy lane is **GitHub Pages**
(`.github/workflows/deploy-pages.yml`; see `AGENTS.md` → *Build target*). Cloudflare Pages is a
**sanctioned opt-in** for fleet/org spokes that need the Cloudflare edge.

It requires org-provisioned `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets, which
**personal-account spokes do not have** — the deploy step simply skips when they are absent. That is
exactly why GitHub Pages is the default and the production truth for personal/foss spokes: the
CF-Pages-primary cutover was **reverted** (TIN-2153 / 2154 / 2155, all canceled).

A spoke **never** holds long-lived CF creds in source; the secrets are org/environment-provisioned
and **Blahaj owns DNS / Access / Tunnel** (the spoke only calls `wrangler-action` to push the built
`build/` artifact).

## When to use it

- The spoke lives under a Cloudflare-fronted org domain whose edge Blahaj owns.
- Org-level `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets are provisioned to the repo.
- You want atomic CF-Pages deploys (immutable deployment + alias swap) rather than the GitHub Pages
  artifact flow.

## How to switch

1. Replace `.github/workflows/deploy-pages.yml` with the Cloudflare workflow below (it builds the
   same `adapter-static` `build/`, then `wrangler pages deploy`).
2. In `svelte.config.js`, set `base` for your host: a **custom domain** uses `base: ''` (+ a
   `static/CNAME`); a **CF-Pages project path** uses `base: process.env.BASE_PATH ?? ''`.
3. Ensure the org `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets are present (the deploy
   step skips when they are absent).

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  deployments: write

concurrency:
  group: cloudflare-pages-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    name: Build and deploy
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v6
      - uses: cachix/install-nix-action@v31
        with:
          extra_nix_config: |
            experimental-features = nix-command flakes
      - name: Install workspace dependencies
        run: nix develop --command just setup
      - name: Check static site
        run: nix develop --command just check
      - name: Build static site
        run: nix develop --command just build
      - name: Resolve Cloudflare Pages target
        id: cloudflare
        env:
          RAW_BRANCH: ${{ github.head_ref || github.ref_name }}
        run: |
          site="${GITHUB_REPOSITORY#*/}"
          project="${site//./-}"
          project="${project//_/-}"
          branch="${RAW_BRANCH:-main}"
          branch="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
          echo "project=$project" >> "$GITHUB_OUTPUT"
          echo "branch=$branch" >> "$GITHUB_OUTPUT"
      - name: Check Cloudflare Pages credentials
        id: cloudflare_credentials
        if: github.event_name != 'pull_request'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          if [ -n "$CLOUDFLARE_API_TOKEN" ] && [ -n "$CLOUDFLARE_ACCOUNT_ID" ]; then
            echo "can_deploy=true" >> "$GITHUB_OUTPUT"
          else
            echo "::notice::Skipping Cloudflare Pages deploy because CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not configured."
            echo "can_deploy=false" >> "$GITHUB_OUTPUT"
          fi
      - name: Deploy static site
        if: github.event_name != 'pull_request' && steps.cloudflare_credentials.outputs.can_deploy == 'true'
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy build --project-name=${{ steps.cloudflare.outputs.project }} --branch=${{ steps.cloudflare.outputs.branch }}
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```
