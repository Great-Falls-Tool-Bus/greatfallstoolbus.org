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
#   static (default)  -> @sveltejs/adapter-static  (DB-less)
#   node              -> @sveltejs/adapter-node     (dynamic-spoke variant)
# The dynamic-spoke variant is the flagged adapter mode authored in
# docs/decisions/dynamic-spoke-adapter-mode.md. Adapter selection never creates
# a deploy lane: publication, preview lifecycle, apply, and edge mutation stay
# in separately authorized controller and owner-overlay transactions.
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

# Preserve the immutable schema-v2 creation provenance before the placeholder
# substitution touches tinyland.repo.json. The template must supply it; the
# spawned repository must never infer it from its own history.
ORIGIN_SHA=
if [[ -f tinyland.repo.json ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "error: jq is required to preserve schema-v2 scaffold_origin" >&2
    exit 1
  fi
  ORIGIN_REPO=$(jq -r '.scaffold_origin.repository // empty' tinyland.repo.json)
  ORIGIN_SHA=$(jq -r '.scaffold_origin.commit_sha // empty' tinyland.repo.json)
  if [[ "$ORIGIN_REPO" != "tinyland-inc/site.scaffold" \
      || ! "$ORIGIN_SHA" =~ ^[0-9a-f]{40}$ \
      || "$ORIGIN_SHA" =~ ^0{40}$ ]]; then
    echo "error: tinyland.repo.json lacks an exact schema-v2 scaffold_origin" >&2
    exit 1
  fi
fi

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

  # 3) tinyland.repo.json: convert the scaffold instance to the schema-v2
  #    app-stateful role (jq, tmp+mv). A non-scaffold role must not retain
  #    taxonomy.spawned_repo_role.
  if command -v jq >/dev/null 2>&1 && [[ -f tinyland.repo.json ]]; then
    jq '
      .taxonomy.primary_role = "app-stateful-spoke"
      | del(.taxonomy.spawned_repo_role)
      | .taxonomy.layers = [
          "org-wide-repo-contract",
          "bazel-package-cache-rbe",
          "app-stateful-spoke"
        ]
      | .boundaries.owns_runtime_backend = true
      | .boundaries.owns_gitops_apply = false
      | .boundaries.owns_cloudflare_mutation = false
      | .boundaries.owns_application_pins = false
      | .boundaries.owns_application_state = false
      | .boundaries.owns_secret_declarations = false
      | .boundaries.owns_application_workloads = false
      | .boundaries.owns_application_zone_dns = false
      | .boundaries.owns_application_mail_policy = false
      | .boundaries.owns_application_database = false
    ' \
      tinyland.repo.json > tinyland.repo.json.tmp \
      && mv tinyland.repo.json.tmp tinyland.repo.json
  fi

  echo "adapter: swapped to @sveltejs/adapter-node (dynamic-spoke variant)"
  echo "  svelte.config.js          -> adapterNode()"
  echo "  package.json devDep       -> @sveltejs/adapter-node"
  echo "  primary_role              -> app-stateful-spoke"
}

if ! grep -rq 'site\.scaffold' --exclude='tinyland.repo.json' --include='*.json' --include='*.md' --include='*.ts' --include='*.js' --include='*.bazel' --include='Justfile' --include='.envrc' --include='.bazelrc' .; then
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

# tinyland.repo.json — restore the exact schema-v2 scaffold origin captured
# before the global brand substitution.
if [[ -n "$ORIGIN_SHA" ]]; then
  jq --arg sha "$ORIGIN_SHA" '
    .scaffold_origin = {
      repository: "tinyland-inc/site.scaffold",
      commit_sha: $sha
    }
  ' tinyland.repo.json > tinyland.repo.json.tmp \
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
[[ -n "$ORIGIN_SHA" ]] && echo "  scaffold_origin: ${ORIGIN_SHA}" || true
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
  echo "  - Declare only finite Bazel actions in the schema-v2 ActionPlan."
  echo "  - Do not add publication, preview, apply, or provider placement here."
  echo "  - This spoke now declares app-stateful-spoke; it MAY own a runtime"
  echo "    backend. Re-check boundaries in tinyland.repo.json before shipping."
fi
