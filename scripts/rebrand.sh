#!/usr/bin/env bash
# Per-site rebrand pass for sister sites spawned from tinyland-inc/site.scaffold.
#
# Usage: scripts/rebrand.sh [--adapter=node|static] <site.example.com>
#
# Substitutes scaffold placeholder strings with the new site identity:
#   site.scaffold        -> <site.example.com>
#   site_scaffold        -> <site_example_com>   (underscored, for MODULE.bazel)
#   bazel-site (cache)   -> bazel-<site>          (slug)
#
# --adapter selects the SvelteKit build target for the spawned spoke:
#   static (default)  -> @sveltejs/adapter-static  (GitHub/CF Pages, DB-less)
#   node              -> @sveltejs/adapter-node     (dynamic-spoke variant)
# The dynamic-spoke variant is the flagged adapter mode authored in
# docs/decisions/dynamic-spoke-adapter-mode.md. When `node`, the spoke is
# stamped with the `app-stateful-spoke` role and its deploy lane flips to the
# blue/green path designed in docs/decisions/dynamic-canary-blue-green.md.
#
# Idempotent: running twice is a no-op once strings have been replaced and the
# adapter has been selected (crash-safe: all in-place edits go through tmp+mv).

set -euo pipefail

usage() {
  echo "usage: $0 [--adapter=node|static] <site.example.com>" >&2
  exit 64
}

ADAPTER=static
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --adapter=node)   ADAPTER=node ;;
    --adapter=static) ADAPTER=static ;;
    --adapter=*)
      echo "error: unknown adapter '${arg#--adapter=}' (want node|static)" >&2
      exit 64
      ;;
    -*) echo "error: unknown flag '$arg'" >&2; usage ;;
    *)  POSITIONAL+=("$arg") ;;
  esac
done
set -- "${POSITIONAL[@]:-}"

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  usage
fi

DOMAIN=$1
UNDERSCORED=$(echo "$DOMAIN" | tr '.-' '_')
SLUG=$(echo "$DOMAIN" | cut -d. -f1)

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# ─────────────────────────────────────────────────────────────────────
# Dynamic-spoke adapter selection (TIN-2228). See
# docs/decisions/dynamic-spoke-adapter-mode.md. All edits are crash-safe
# (tmp+mv) and idempotent (a second `--adapter=node` is a no-op).
# ─────────────────────────────────────────────────────────────────────
apply_adapter_node() {
  # Idempotency gate: svelte.config.js already on adapter-node => nothing to do.
  if [[ -f svelte.config.js ]] && grep -q 'adapter-node' svelte.config.js; then
    echo "adapter: already @sveltejs/adapter-node (idempotent no-op)"
    return 0
  fi

  # 1) package.json: swap the adapter-static devDep -> adapter-node (jq, tmp+mv).
  if command -v jq >/dev/null 2>&1 && [[ -f package.json ]]; then
    jq '
      .devDependencies |= (
        . + {"@sveltejs/adapter-node": "^5.5.3"}
          | del(."@sveltejs/adapter-static")
      )
    ' package.json > package.json.tmp && mv package.json.tmp package.json
  fi

  # 2) svelte.config.js: deterministic adapter-node variant. Drops the
  #    static-isms (fallback / precompress / prerender); keeps runes + BASE_PATH.
  if [[ -f svelte.config.js ]]; then
    cat > svelte.config.js.tmp <<'SVELTE_NODE'
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte'],
	preprocess: [vitePreprocess()],
	compilerOptions: {
		runes: true,
	},
	kit: {
		// Dynamic-spoke variant (scripts/rebrand.sh --adapter=node).
		// adapter-node yields a Node server (node build/index.js) for spokes
		// that genuinely need a runtime: secret-holding proxy, upstream
		// normalization, or thin API routes. See
		// docs/decisions/dynamic-spoke-adapter-mode.md.
		adapter: adapter(),
		paths: {
			base: process.env.BASE_PATH ?? '',
		},
	},
};

export default config;
SVELTE_NODE
    mv svelte.config.js.tmp svelte.config.js
  fi

  # 3) tinyland.repo.json: stamp the dynamic-spoke role (jq, tmp+mv).
  #    Reuses the existing `app-stateful-spoke` repoRole (a dynamic spoke owns
  #    a runtime backend); see the ADR for why no new enum value is added.
  if command -v jq >/dev/null 2>&1 && [[ -f tinyland.repo.json ]]; then
    jq '.taxonomy.spawned_repo_role = "app-stateful-spoke"' \
      tinyland.repo.json > tinyland.repo.json.tmp \
      && mv tinyland.repo.json.tmp tinyland.repo.json
  fi

  echo "adapter: swapped to @sveltejs/adapter-node (dynamic-spoke variant)"
  echo "  svelte.config.js          -> adapterNode()"
  echo "  package.json devDep       -> @sveltejs/adapter-node"
  echo "  spawned_repo_role         -> app-stateful-spoke"
}

if ! grep -rq 'site\.scaffold' --include='*.json' --include='*.md' --include='*.ts' --include='*.js' --include='*.bazel' --include='Justfile' --include='.envrc' --include='.bazelrc' .; then
  echo "no scaffold placeholders detected — already rebranded?" >&2
  exit 0
fi

# Text substitutions across config, doc, and source files.
find . -type f \( \
    -name '*.md' -o -name '*.json' -o -name '*.ts' -o -name '*.js' \
    -o -name '*.bazel' -o -name '.bazelrc' -o -name '.envrc' \
    -o -name 'Justfile' -o -name '*.toml' -o -name '*.svelte' \
    -o -name '*.html' -o -name '*.css' -o -name '*.yml' \
    -o -name '*.yaml' -o -name 'flake.nix' \
  \) \
  -not -path './node_modules/*' -not -path './.git/*' -not -path './build/*' \
  -not -path './.svelte-kit/*' -not -path './pnpm-lock.yaml' \
  -not -path './MODULE.bazel.lock' -not -path './flake.lock' \
  -print0 | xargs -0 sed -i.bak \
    -e "s|site\\.scaffold|${DOMAIN}|g" \
    -e "s|site_scaffold|${UNDERSCORED}|g" \
    -e "s|bazel-site|bazel-${SLUG}|g"

# Clean up sed -i.bak backup files
find . -type f -name '*.bak' -not -path './node_modules/*' -not -path './.git/*' -delete

# ─────────────────────────────────────────────────────────────────────
# CI-SCHEMA (docs/CI-SCHEMA.md) artifacts. All steps are idempotent.
# ─────────────────────────────────────────────────────────────────────

# package.json .name (jq-driven for safety)
if command -v jq >/dev/null 2>&1 && [[ -f package.json ]]; then
  jq --arg slug "${SLUG}" '.name = $slug' package.json > package.json.tmp \
    && mv package.json.tmp package.json
fi

# .github/lanes.json — rewrite spoke.name + spoke.domain via jq
if command -v jq >/dev/null 2>&1 && [[ -f .github/lanes.json ]]; then
  jq --arg slug "${SLUG}" --arg domain "${DOMAIN}" \
    '.spoke.name = $slug | .spoke.domain = $domain' \
    .github/lanes.json > .github/lanes.json.tmp \
    && mv .github/lanes.json.tmp .github/lanes.json
fi

# tofu/spoke.auto.tfvars — rewrite spoke_slug + brand_domain (sed; preserves comments)
if [[ -f tofu/spoke.auto.tfvars ]]; then
  sed -i.bak \
    -e "s|^spoke_slug[[:space:]]*=.*|spoke_slug              = \"${SLUG}\"|" \
    -e "s|^brand_domain[[:space:]]*=.*|brand_domain            = \"${DOMAIN}\"|" \
    tofu/spoke.auto.tfvars
  rm -f tofu/spoke.auto.tfvars.bak
fi

# tofu/backend.tf — rewrite spoke-namespaced state key
if [[ -f tofu/backend.tf ]]; then
  sed -i.bak "s|spokes/site-scaffold/|spokes/${SLUG}/|g" tofu/backend.tf
  rm -f tofu/backend.tf.bak
fi

# tinyland.repo.json — stamp the scaffold release tag this spoke was spawned from.
# tinyland-scaffold-doctor Layer 2 reads .scaffold_tag for the version-drift diff; without it the
# doctor silently falls back to "latest release". Override the detected tag with SCAFFOLD_TAG=.
SCAFFOLD_TAG="${SCAFFOLD_TAG:-$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null || echo unknown)}"
if command -v jq >/dev/null 2>&1 && [[ -f tinyland.repo.json ]]; then
  jq --arg tag "${SCAFFOLD_TAG}" '.scaffold_tag = $tag' \
    tinyland.repo.json > tinyland.repo.json.tmp \
    && mv tinyland.repo.json.tmp tinyland.repo.json
fi

# Apply the dynamic-spoke adapter variant when requested (TIN-2228).
if [[ "$ADAPTER" == "node" ]]; then
  apply_adapter_node
fi


echo "rebranded scaffold to ${DOMAIN}"
echo "  underscored: ${UNDERSCORED}"
echo "  bazel cache: bazel-${SLUG}"
echo "  lanes.json spoke: ${SLUG} / ${DOMAIN}"
echo "  adapter:     ${ADAPTER}"
[[ -f tofu/backend.tf ]] && echo "  tofu state key:  spokes/${SLUG}/terraform.tfstate" || true
[[ -f tinyland.repo.json ]] && echo "  scaffold_tag:    ${SCAFFOLD_TAG}" || true
echo
echo "next:"
echo "  1. Review git diff"
echo "  2. Update README.md and AGENTS.md with brand purpose"
echo "  3. Update src/routes/+page.svelte with the landing page"
echo "  4. gh repo edit --description '...' --homepage 'https://${DOMAIN}'"
echo "  5. just setup && just check && just build"
echo "  6. just lanes-validate && just conformance"
if [[ "$ADAPTER" == "node" ]]; then
  echo
  echo "dynamic-spoke (adapter-node) follow-ups:"
  echo "  - Smoke-serve with 'node build/index.js' (NOT a static file server)."
  echo "  - Flip the deploy lane to the blue/green path:"
  echo "    docs/decisions/dynamic-canary-blue-green.md."
  echo "  - This spoke now declares app-stateful-spoke; it MAY own a runtime"
  echo "    backend. Re-check boundaries in tinyland.repo.json before shipping."
fi
