---
name: tinyland-spawn-sister-site
description: Spawn a new Tinyland static spoke site from tinyland-inc/site.scaffold. Wraps gh repo create --template, scripts/rebrand.sh, MODULE.bazel module renaming, theme bootstrapping, snapshot ingestion wiring, and the post-creation conformance checklist. Use when the user asks to "create a new sister site", "spawn a spoke", "add a brand site", "scaffold <domain>.com", or "stand up a new tinyland-inc/<name> from the scaffold".
when_to_use: |
  Use when the user wants a new static spoke under the Tinyland enterprise. Not for
  hub (tinyland.dev), package-producer, infra, or tooling repos — those have different
  scaffolds (not yet authored). Confirm the target shape with /tinyland-whoami first
  if the user's intent is ambiguous.
disable-model-invocation: true
argument-hint: "[site-domain] [site-purpose-one-liner]"
allowed-tools:
  - Bash(gh repo create *)
  - Bash(gh repo clone *)
  - Bash(gh repo edit *)
  - Bash(just *)
  - Bash(git *)
  - Bash(./scripts/rebrand.sh *)
  - Read
  - Edit
  - Write
---

# Tinyland Spawn Sister Site

## Why this is user-only

`disable-model-invocation: true` because spawning a new repo creates durable
artifacts (a GitHub repository and default branch). The user must initiate it.
The agent assists; it does not decide to spawn or authorize infrastructure.

## Inputs the agent should confirm before running

1. **Target domain** — e.g. `floorcables.com`, `pixelwise.xoxd.ai`,
   `boots.tinyland.dev`. Used as the repo name (with dots → hyphens) and the
   bazel module name (with dots → underscores).
2. **Site purpose** — one line. Becomes the `README.md` and GitHub repo
   description.
3. **Tinyland brand actor** — optional. If supplied, the spoke will be wired
   to verify signed Pulse snapshots from that actor (`<actor>#main-key`).
   Defaults to deferring to `tinyland.dev`'s actor.
4. **Theme intent** — copy an existing theme from `src/lib/styles/themes/`
   or start a new one. Most spokes start by copying.

## Spawn ritual (run in order)

```bash
# 1. Create the GitHub repo from the template.
gh repo create tinyland-inc/<repo-name> \
  --template tinyland-inc/site.scaffold \
  --private \
  --description "<purpose>"

# 2. Clone locally.
gh repo clone tinyland-inc/<repo-name> ~/git/<repo-name>
cd ~/git/<repo-name>

# 3. Activate the dev shell.
direnv allow

# 4. Run the rebrand script. This rewrites name strings, env-var prefixes,
#    bazel cache name, MODULE.bazel module(name=...), README, AGENTS.md,
#    static/robots.txt, sitemap, llms.txt header, and tinyland.repo.json.
scripts/rebrand.sh <site-domain>

# 5. Replace the brand landing page.
$EDITOR src/routes/+page.svelte
# Reference the existing spokes under tinyland-inc/<other-site> for the shape.

# 6. Pin the GitHub repo description + homepage URL.
gh repo edit --description "<purpose>" --homepage "https://<site-domain>"

# 7. Pre-flight: secrets, lint, typecheck, unit, build, conformance.
just check
just build
just conformance

# 8. First commit + push.
git status --short
# Stage every reviewed path explicitly; never use git add -A in a shared tree.
# Use `git add -- path ...` with only the reviewed paths shown above.
git diff --cached --name-only
git commit -S -m "feat: scaffold <site-domain> from tinyland-inc/site.scaffold"
git push -u origin main

# 9. Take one CI status snapshot, then return instead of polling.
gh run list --branch main --limit 5
```

## What to NOT do during a spawn

- Do not call raw `pnpm`/`vite`/`bazelisk` outside the Justfile — the rebrand
  encodes the Skeleton 5.0.1 paired pin (skeleton + skeleton-svelte identical,
  shim-free Tailwind v4); bypassing `just` breaks the pin discipline.
- Do not add runtime DB, auth, payments, mutation APIs, or ActivityPub delivery
  workers. A spoke is a read-only static consumer of `tinyland.dev` snapshots.
- Do not unpin Skeleton or split the skeleton/skeleton-svelte paired pin
  without coordination across spokes (the packages are version-locked; a solo
  major bump of either always breaks — see the 4.x → 5.x paired-bump PR).
- Do not fork `tummycrypt_tinyland_color_utils`, `tinyvectors`, or the vite
  plugins per-site. Pin via `tinyland-inc/bazel-registry`.
- Do not add Cloudflare API credentials, provider placement, OpenTofu state, or
  apply logic to the spoke. The consumer-owned organization overlay owns its
  signed demand and owner transactions; provider supply remains opaque.
- Do not commit `.env`, decrypted SOPS, or tokens. The Justfile's
  `secrets-scan` recipe is part of `just check`.

## Post-spawn handoffs

- Track adoption in the target organization's current initiative only when its
  repo contract names one; never attach a generic spoke to a GFTB project by
  default.
- Update a spoke registry only when site.scaffold names a current canonical
  registry; do not invent or reconstruct one from historical docs.
- If the spoke needs per-PR ephemeral envs beyond the default lane, edit
  `.github/lanes.json` and run `just lanes-validate` before pushing.
- A public client preview requires a separately admitted controller result and
  owner-overlay lifecycle transaction. If those authorities are unavailable,
  leave the preview unavailable; do not create a spoke-owned dispatch or
  reaper.

## When to push back on a spawn request

- If the user wants the spoke to be dynamic (server-rendered, owns its own DB),
  this is the wrong scaffold. They likely want a `dynamic-spoke` template
  (not yet authored — file as a follow-up under TIN-1437).
- If the user wants federation OUTBOUND (the spoke posts to the Fediverse), the
  spoke is the wrong custodian. `tinyland.dev` owns AP delivery. The spoke can
  consume Pulse snapshots but does not deliver.
- If the requested domain conflicts with an existing brand or recycles a
  retired name (`alpha`, `beta` for client previews), name it deliberately
  (e.g. `jen-preview.<domain>`).
