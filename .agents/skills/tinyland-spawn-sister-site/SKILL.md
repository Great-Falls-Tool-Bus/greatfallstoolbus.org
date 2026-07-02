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
public artifacts (GitHub repo, default branch, possibly DNS via tofu). The user
must initiate it. The agent assists; it does not decide to spawn.

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
git add -A
git commit -m "feat: scaffold <site-domain> from site.scaffold"
git push -u origin main

# 9. Verify CI green (secrets-scan, build-and-test, bazel-graph).
gh run watch
```

## What to NOT do during a spawn

- Do not call raw `pnpm`/`vite`/`bazelisk` outside the Justfile — the rebrand
  encodes Skeleton 4.15.2 and the Tailwind v4 compat shim; bypassing `just`
  breaks the pin discipline.
- Do not add runtime DB, auth, payments, mutation APIs, or ActivityPub delivery
  workers. A spoke is a read-only static consumer of `tinyland.dev` snapshots.
- Do not unpin Skeleton or the Tailwind v4 shim without coordination across
  spokes (Skeleton 4.x → 5.x is a fleet-wide migration).
- Do not fork `tummycrypt_tinyland_color_utils`, `tinyvectors`, or the vite
  plugins per-site. Pin via `tinyland-inc/bazel-registry`.
- Do not add Cloudflare API credentials to the spoke. `blahaj` owns DNS,
  Access, Tunnel ingress, and TTL cleanup.
- Do not commit `.env`, decrypted SOPS, or tokens. The Justfile's
  `secrets-scan` recipe is part of `just check`.

## Post-spawn handoffs

- Open a Linear issue under TIN-1437 (site.scaffold v2 umbrella) to track the
  new spoke's adoption status.
- Add the spoke's domain to the parent scaffold's spoke registry (when one
  exists — currently a manual list in `docs/spec/...`).
- If the spoke needs per-PR ephemeral envs beyond the default lane, edit
  `.github/lanes.json` and run `just lanes-validate` before pushing.
- If the spoke needs public client previews, follow the
  `docs/schemas/public-preview-dispatch.schema.json` overlay rather than
  recycling `alpha`/`beta`.

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
