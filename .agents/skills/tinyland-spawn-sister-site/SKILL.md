---
name: tinyland-spawn-sister-site
description: Spawn a Tinyland static spoke from tinyland-inc/site.scaffold into a named consumer organization. Proves the exact template tree, stamps immutable creation provenance and the consumer-owned overlay join, and runs the reviewed conformance path. Use when the user asks to create a sister site, spawn a spoke, add a brand site, or scaffold a domain.
when_to_use: |
  Use when the user wants a new static spoke under the Tinyland enterprise. Not for
  hub (tinyland.dev), package-producer, infra, or tooling repos — those have different
  scaffolds (not yet authored). Confirm the target shape with /tinyland-whoami first
  if the user's intent is ambiguous.
disable-model-invocation: true
argument-hint: "[site-domain] [site-purpose-one-liner]"
allowed-tools:
  - Bash(gh api *)
  - Bash(gh repo create *)
  - Bash(gh repo clone *)
  - Bash(gh repo edit *)
  - Bash(just *)
  - Bash(git *)
  - Bash(test *)
  - Bash(direnv allow)
  - Bash(./scripts/rebrand.sh *)
  - Read
  - Edit
  - Write
---

# Tinyland Spawn Sister Site

## Why this is user-only

`disable-model-invocation: true` because spawning a new repo creates durable
remote state (a GitHub repository and default branch). The user must initiate it.
The agent assists; it does not decide to spawn or authorize infrastructure.

## Inputs the agent should confirm before running

1. **Target repository** — exact `OWNER/REPO` in the consumer organization.
2. **Consumer-owned overlay** — exact `OWNER/REPO`, its declared overlay role,
   and its composition. The overlay owner must match the target owner.
3. **Target domain** — a lowercase fully qualified hostname.
4. **Site purpose** — one line. It becomes the GitHub and manifest description.
5. **Tinyland brand actor** — optional. If supplied, the spoke will be wired
   to verify signed Pulse snapshots from that actor (`<actor>#main-key`).
   Defaults to deferring to `tinyland.dev`'s actor.
6. **Theme intent** — copy an existing theme from `src/lib/styles/themes/`
   or start a new one. Most spokes start by copying.

## Spawn ritual (run in order)

```bash
TARGET_REPOSITORY=Example-Org/example-site
TARGET_DOMAIN=example.test
TARGET_DESCRIPTION='One-line site purpose.'
CONSUMER_OVERLAY=Example-Org/example-infra
OVERLAY_ROLE=organization-execution-overlay
OVERLAY_COMPOSITION=distinct
TARGET_PARENT=/absolute/path/to/reviewed/workspace
REPO_NAME=${TARGET_REPOSITORY#*/}

# 1. Bracket the template transaction with an immutable source SHA. A source
#    movement during generation fails closed rather than guessing provenance.
TEMPLATE_SOURCE_SHA=$(gh api repos/tinyland-inc/site.scaffold/commits/main --jq .sha)
TEMPLATE_TREE=$(gh api \
  "repos/tinyland-inc/site.scaffold/git/commits/$TEMPLATE_SOURCE_SHA" \
  --jq .tree.sha)

gh repo create "$TARGET_REPOSITORY" \
  --template tinyland-inc/site.scaffold \
  --private \
  --description "$TARGET_DESCRIPTION"

# 2. Clone locally.
gh repo clone "$TARGET_REPOSITORY" "$TARGET_PARENT/$REPO_NAME"
cd "$TARGET_PARENT/$REPO_NAME"

TEMPLATE_SOURCE_AFTER=$(gh api repos/tinyland-inc/site.scaffold/commits/main --jq .sha)
CHILD_TREE=$(git rev-parse 'HEAD^{tree}')
test "$TEMPLATE_SOURCE_SHA" = "$TEMPLATE_SOURCE_AFTER"
test "$TEMPLATE_TREE" = "$CHILD_TREE"

# 3. Activate the dev shell.
direnv allow

# 4. Stamp only explicit machine identity. Human-facing brand copy is reviewed
#    separately; canonical site.scaffold URLs and schema IDs remain unchanged.
./scripts/rebrand.sh \
  --repository="$TARGET_REPOSITORY" \
  --description="$TARGET_DESCRIPTION" \
  --organization-overlay="$CONSUMER_OVERLAY" \
  --overlay-role="$OVERLAY_ROLE" \
  --overlay-composition="$OVERLAY_COMPOSITION" \
  --scaffold-origin-sha="$TEMPLATE_SOURCE_SHA" \
  "$TARGET_DOMAIN"

# 5. Review and edit human-facing brand surfaces with the session's normal
#    file-edit mechanism. Start with src/routes/+page.svelte, README.md,
#    AGENTS.md, robots/sitemap, and public agent indexes. Do not launch a GUI.

# 6. Pin the GitHub repo description + homepage URL.
gh repo edit --description "$TARGET_DESCRIPTION" --homepage "https://$TARGET_DOMAIN"

# 7. Pre-flight: secrets, lint, typecheck, unit, build, conformance.
just check
just build
just conformance

# 8. First commit + push.
git status --short
# Stage every reviewed path explicitly; never use git add -A in a shared tree.
git diff --name-only
# Replace the placeholders below with the reviewed list printed above.
git add -- <reviewed-path> [<reviewed-path> ...]
git diff --cached --name-only
git commit -S -m "feat: scaffold $TARGET_DOMAIN from tinyland-inc/site.scaffold"
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
- Never rewrite canonical `tinyland-inc/site.scaffold` references or schema IDs
  into consumer names. Creation provenance is immutable; later scaffold syncs
  are reviewed changes, not origin rewrites.

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
