#!/usr/bin/env bash
# Stamp a repository generated from tinyland-inc/site.scaffold with its exact
# consumer identity and immutable template provenance.
#
# This historical helper is retained for repositories generated from the
# scaffold. The scaffold remains the authority for the workflow and schema;
# this consumer copy must not invent publication, apply, or provider placement.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: scripts/rebrand.sh [--adapter=node|static] \
  --repository=OWNER/REPO \
  --description='one-line purpose' \
  --organization-overlay=OWNER/REPO \
  --overlay-role=organization-execution-overlay|application-owner-overlay \
  --overlay-composition=distinct|co-located-application-overlay \
  --scaffold-origin-sha=FULL_SHA \
  <site.example.com>
EOF
  exit 64
}

ADAPTER=static
REPOSITORY=
DESCRIPTION=
ORGANIZATION_OVERLAY=
OVERLAY_ROLE=
OVERLAY_COMPOSITION=
SCAFFOLD_ORIGIN_SHA=
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --adapter=node) ADAPTER=node ;;
    --adapter=static) ADAPTER=static ;;
    --adapter=*)
      echo "error: unknown adapter '${arg#--adapter=}' (want node|static)" >&2
      exit 64
      ;;
    --repository=*) REPOSITORY=${arg#--repository=} ;;
    --description=*) DESCRIPTION=${arg#--description=} ;;
    --organization-overlay=*) ORGANIZATION_OVERLAY=${arg#--organization-overlay=} ;;
    --overlay-role=*) OVERLAY_ROLE=${arg#--overlay-role=} ;;
    --overlay-composition=*) OVERLAY_COMPOSITION=${arg#--overlay-composition=} ;;
    --scaffold-origin-sha=*) SCAFFOLD_ORIGIN_SHA=${arg#--scaffold-origin-sha=} ;;
    -*)
      echo "error: unknown flag '$arg'" >&2
      usage
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 1 || -z "${POSITIONAL[0]:-}" ]]; then
  usage
fi

DOMAIN=${POSITIONAL[0]}
if [[ -z "$REPOSITORY" || -z "$DESCRIPTION" || -z "$ORGANIZATION_OVERLAY" \
    || -z "$OVERLAY_ROLE" || -z "$OVERLAY_COMPOSITION" \
    || -z "$SCAFFOLD_ORIGIN_SHA" ]]; then
  echo "error: repository, description, overlay identity, and exact scaffold origin are required" >&2
  usage
fi

REPO_REFERENCE_RE='^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
DOMAIN_RE='^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
SHA_RE='^[0-9a-f]{40}$'

if [[ ! "$REPOSITORY" =~ $REPO_REFERENCE_RE ]]; then
  echo "error: --repository must be an exact OWNER/REPO coordinate" >&2
  exit 64
fi
if [[ ! "$ORGANIZATION_OVERLAY" =~ $REPO_REFERENCE_RE ]]; then
  echo "error: --organization-overlay must be an exact OWNER/REPO coordinate" >&2
  exit 64
fi
if [[ ! "$DOMAIN" =~ $DOMAIN_RE ]]; then
  echo "error: site domain must be a lowercase fully-qualified hostname" >&2
  exit 64
fi
if [[ ! "$SCAFFOLD_ORIGIN_SHA" =~ $SHA_RE || "$SCAFFOLD_ORIGIN_SHA" =~ ^0{40}$ ]]; then
  echo "error: --scaffold-origin-sha must be a nonzero lowercase full Git SHA" >&2
  exit 64
fi

case "$OVERLAY_ROLE" in
  organization-execution-overlay|application-owner-overlay) ;;
  *)
    echo "error: invalid --overlay-role" >&2
    exit 64
    ;;
esac
case "$OVERLAY_COMPOSITION" in
  distinct|co-located-application-overlay) ;;
  *)
    echo "error: invalid --overlay-composition" >&2
    exit 64
    ;;
esac

REPOSITORY_OWNER=${REPOSITORY%%/*}
REPOSITORY_NAME=${REPOSITORY#*/}
OVERLAY_OWNER=${ORGANIZATION_OVERLAY%%/*}
REPOSITORY_OWNER_FOLD=$(printf '%s' "$REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
OVERLAY_OWNER_FOLD=$(printf '%s' "$OVERLAY_OWNER" | tr '[:upper:]' '[:lower:]')
if [[ "$REPOSITORY_OWNER_FOLD" != "$OVERLAY_OWNER_FOLD" ]]; then
  echo "error: consumer overlay owner must match repository owner" >&2
  exit 64
fi

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required to stamp schema-v2 identity" >&2
  exit 69
fi
if [[ ! -f tinyland.repo.json ]]; then
  echo "error: tinyland.repo.json is required" >&2
  exit 66
fi
if ! jq -e '.schema_version == 2 and (.repo | type == "object") and (.enrollment | type == "object")' \
  tinyland.repo.json >/dev/null; then
  echo "error: tinyland.repo.json must be a schema-v2 manifest" >&2
  exit 65
fi

EXISTING_ORIGIN_REPO=$(jq -r '.scaffold_origin.repository // empty' tinyland.repo.json)
EXISTING_ORIGIN_SHA=$(jq -r '.scaffold_origin.commit_sha // empty' tinyland.repo.json)
if [[ -n "$EXISTING_ORIGIN_REPO" || -n "$EXISTING_ORIGIN_SHA" ]]; then
  if [[ "$EXISTING_ORIGIN_REPO" != "tinyland-inc/site.scaffold" \
      || "$EXISTING_ORIGIN_SHA" != "$SCAFFOLD_ORIGIN_SHA" ]]; then
    echo "error: scaffold_origin is immutable and does not match this transaction" >&2
    exit 65
  fi
fi

if [[ "$ADAPTER" == "static" && -f svelte.config.js ]] \
  && grep -q 'adapter-node' svelte.config.js; then
  echo "error: refusing to stamp a node-configured repository as static" >&2
  exit 65
fi
if [[ "$ADAPTER" == "node" && -f package.json ]] \
  && ! jq -e '(.dependencies["@sveltejs/adapter-node"] // .devDependencies["@sveltejs/adapter-node"]) != null' \
    package.json >/dev/null; then
  echo "error: the frozen package graph must already carry @sveltejs/adapter-node" >&2
  exit 65
fi

# Stamp only explicit machine identity fields. Never globally replace the
# literal `site.scaffold`: canonical SSOT URLs, schema IDs, and skill pointers
# must continue to name tinyland-inc/site.scaffold in every generated child.
jq \
  --arg repository "$REPOSITORY" \
  --arg repository_owner "$REPOSITORY_OWNER" \
  --arg repository_name "$REPOSITORY_NAME" \
  --arg description "$DESCRIPTION" \
  --arg domain "$DOMAIN" \
  --arg organization_overlay "$ORGANIZATION_OVERLAY" \
  --arg overlay_role "$OVERLAY_ROLE" \
  --arg overlay_composition "$OVERLAY_COMPOSITION" \
  --arg origin_sha "$SCAFFOLD_ORIGIN_SHA" \
  --arg adapter "$ADAPTER" \
  '.repo.name = $repository_name
   | .repo.github = $repository
   | .repo.domain = $domain
   | .repo.description = $description
   | del(.repo.linear)
   | .enrollment = {
       forgeScope: $repository_owner,
       organizationOverlay: $organization_overlay,
       organizationOverlayRole: $overlay_role,
       organizationOverlayComposition: $overlay_composition
     }
   | del(.scaffold_tag)
   | .scaffold_origin = {
       repository: "tinyland-inc/site.scaffold",
       commit_sha: $origin_sha
     }
   | .taxonomy.primary_role = (if $adapter == "node" then "app-stateful-spoke" else "static-spoke" end)
   | del(.taxonomy.spawned_repo_role)
   | .taxonomy.layers = (if $adapter == "node"
       then ["org-wide-repo-contract", "bazel-package-cache-rbe", "app-stateful-spoke"]
       else ["org-wide-repo-contract", "bazel-package-cache-rbe", "static-spoke"]
     end)
   | .boundaries.owns_runtime_backend = ($adapter == "node")' \
  tinyland.repo.json > tinyland.repo.json.tmp \
  && mv tinyland.repo.json.tmp tinyland.repo.json

# These are explicit consumer identity fields, not a repository-wide rewrite.
if [[ -f package.json ]]; then
  jq \
    --arg name "$REPOSITORY_NAME" \
    --arg homepage "https://github.com/${REPOSITORY}" \
    --arg repository_url "https://github.com/${REPOSITORY}.git" \
    '.name = $name
     | .homepage = $homepage
     | .repository = {type: "git", url: $repository_url}' \
    package.json > package.json.tmp \
    && mv package.json.tmp package.json
fi

if [[ -f MODULE.bazel ]]; then
  UNDERSCORED=$(printf '%s' "$DOMAIN" | tr '.-' '_')
  sed 's/name = "site_scaffold"/name = "'"$UNDERSCORED"'"/' \
    MODULE.bazel > MODULE.bazel.tmp \
    && mv MODULE.bazel.tmp MODULE.bazel
fi

apply_adapter_node() {
  if [[ -f svelte.config.js ]] && ! grep -q 'adapter-node' svelte.config.js; then
    cat > svelte.config.js.tmp <<'SVELTE_NODE'
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte'],
	preprocess: [vitePreprocess()],
	compilerOptions: { runes: true },
	kit: {
		adapter: adapter({ out: process.env.BUILD_OUTPUT_DIR ?? 'build' }),
		paths: { base: process.env.BASE_PATH ?? '' },
	},
};

export default config;
SVELTE_NODE
    mv svelte.config.js.tmp svelte.config.js
  fi

  # Both adapters are already frozen in the scaffold package graph. Select the
  # node adapter in Bazel without changing package.json or its lockfile.
  if [[ -f BUILD.bazel ]] && grep -q ':node_modules/@sveltejs/adapter-static' BUILD.bazel; then
    sed 's|:node_modules/@sveltejs/adapter-static|:node_modules/@sveltejs/adapter-node|g' \
      BUILD.bazel > BUILD.bazel.tmp \
      && mv BUILD.bazel.tmp BUILD.bazel
  fi
}

if [[ "$ADAPTER" == "node" ]]; then
  apply_adapter_node
fi

echo "stamped generated repository ${REPOSITORY} for ${DOMAIN}"
echo "  role:            $(jq -r '.taxonomy.primary_role' tinyland.repo.json)"
echo "  overlay:         ${ORGANIZATION_OVERLAY} (${OVERLAY_ROLE}, ${OVERLAY_COMPOSITION})"
echo "  scaffold_origin: ${SCAFFOLD_ORIGIN_SHA}"
echo "review and edit human-facing brand copy explicitly; canonical scaffold references were preserved"
