#!/usr/bin/env bash
# Check spoke conformance with docs/CI-SCHEMA.md §12 checklist.
#
# Exit 0 if all mechanical checks pass; non-zero with a checklist of
# failures otherwise. Items not mechanically verifiable (org ruleset
# membership, tailnet DNS reachability) are flagged as MANUAL.
#
# Usage: scripts/check-conformance.sh [--strict]
#   --strict  treat MANUAL items as failures (default: warn)

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

STRICT=0
if [[ "${1:-}" == "--strict" ]]; then STRICT=1; fi

pass=0
fail=0
manual=0

ok() { printf "  ✓ %s\n" "$1"; pass=$((pass+1)); }
no() { printf "  ✗ %s\n" "$1"; fail=$((fail+1)); }
man() {
  if (( STRICT )); then no "MANUAL (strict): $1"; else
    printf "  ⚠ MANUAL: %s\n" "$1"; manual=$((manual+1));
  fi
}

echo "Conformance check (see docs/CI-SCHEMA.md §12)"
echo

# 0. repo manifest exists and validates against the repo taxonomy schema.
if [[ -f tinyland.repo.json ]]; then
  set +e
  python3 scripts/validate-lanes.py \
    --schema docs/schemas/tinyland-repo-manifest.schema.json \
    --instance tinyland.repo.json >/dev/null 2>&1
  rc=$?
  set -e
  case $rc in
    0) ok "tinyland.repo.json validates against tinyland-repo-manifest.schema.json" ;;
    2) man "tinyland.repo.json validator unavailable (jsonschema missing — run inside nix develop)" ;;
    *) no "tinyland.repo.json fails schema validation (run just repo-manifest-validate for details)" ;;
  esac

  role=$(jq -r '.taxonomy.primary_role // empty' tinyland.repo.json)
  if [[ "$role" == "static-spoke" || "$role" == "static-spoke-scaffold" ]]; then
    ok "repo manifest declares a static-spoke-compatible role"
  else
    no "repo manifest must declare static-spoke or static-spoke-scaffold for this scaffold (got: ${role:-missing})"
  fi
else
  no "tinyland.repo.json is missing"
fi

# 1. lanes.json exists and validates
if [[ -f .github/lanes.json ]]; then
  set +e
  python3 scripts/validate-lanes.py >/dev/null 2>&1
  rc=$?
  set -e
  case $rc in
    0) ok ".github/lanes.json validates against lanes.schema.json" ;;
    2) man ".github/lanes.json validator unavailable (jsonschema missing — install via D3 PR2 flake.nix expansion)" ;;
    *) no ".github/lanes.json fails schema validation (run just lanes-validate for details)" ;;
  esac
else
  no ".github/lanes.json is missing"
fi

# 2. ci.yml pins ci-templates by SemVer
if [[ -f .github/workflows/ci.yml ]]; then
  if grep -qE 'tinyland-inc/ci-templates[^@]*@(v[0-9]+\.[0-9]+\.[0-9]+|[0-9a-f]{40})' .github/workflows/ci.yml; then
    ok ".github/workflows/ci.yml pins ci-templates by SemVer or sha"
  elif grep -qE 'tinyland-inc/ci-templates' .github/workflows/ci.yml; then
    no ".github/workflows/ci.yml references ci-templates but not via SemVer pin"
  else
    man "ci.yml does not reference ci-templates yet (pre-cutover OK)"
  fi
else
  no ".github/workflows/ci.yml is missing"
fi

# 3 & 4. Org ruleset + required checks
man "Org ruleset tinyland-spoke-default imported (verify: gh api repos/{owner}/{repo}/rulesets)"
man "Required status checks per §9 configured at the repo level"

# 5. flywheel_target_classes subset of proved allowlist
if [[ -f .github/lanes.json ]]; then
  allowed='sveltekit-app-build sveltekit-unit-tests deployment-bundle-packaging docs-site-static-build web-playwright-chromium-static-smoke'
  bad=""
  while IFS= read -r cls; do
    if [[ -n "$cls" ]] && ! echo " $allowed " | grep -q " $cls "; then
      bad="$bad $cls"
    fi
  done < <(jq -r '[(.defaults.flywheel_target_classes // [])[], (.lanes[]?.flywheel_target_classes // [])[]] | .[]' .github/lanes.json 2>/dev/null | sort -u)
  if [[ -z "$bad" ]]; then
    ok "flywheel_target_classes (if any) are within the proved allowlist"
  else
    no "flywheel_target_classes contains non-allowlisted entries:$bad"
  fi
fi

# 6. No runs-on: ubuntu-latest in artifact / state / bazel jobs.
# Allowed on ubuntu-latest: secrets-scan, lane-dispatch dispatcher, pulse-ingest
# wrapper, cloudflare/vercel/netlify external-publication deploys (need vendor
# API egress, can't realistically live on self-hosted ARC). Flagged: any job
# whose key matches bazel-*, build*, publish-image, tofu-*, test-e2e, or
# flywheel-*.
if [[ -d .github/workflows ]]; then
  offenders=""
  while IFS= read -r f; do
    # Only flag if file declares a non-exempt job AND that job uses ubuntu-latest.
    if grep -qE '^\s*(bazel-[a-z]+|build-[a-z]+|publish-image|tofu-[a-z]+|flywheel-[a-z]+):' "$f"; then
      if grep -qE '^\s*runs-on:\s*ubuntu-latest\b' "$f"; then
        offenders="$offenders $f"
      fi
    fi
  done < <(ls .github/workflows/*.yml 2>/dev/null)
  if [[ -z "$offenders" ]]; then
    ok "No runs-on: ubuntu-latest in artifact/bazel/state jobs"
  else
    # Pre-D3 PR6 cutover state is tolerated; once ci-templates pin lands,
    # promote this to a hard fail.
    if grep -qE 'tinyland-inc/ci-templates[^@]*@v[0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml 2>/dev/null; then
      no "runs-on: ubuntu-latest found in artifact-shaped jobs:$offenders"
    else
      man "runs-on: ubuntu-latest in artifact-shaped jobs:$offenders (acceptable pre-D3 PR6 cutover)"
    fi
  fi
fi

# 7. Flywheel recipes use the wrapper, not raw Bazel/Bazelisk.
if [[ -f Justfile ]]; then
  if [[ -x scripts/gloriousflywheel-bazel.sh || -f scripts/gloriousflywheel-bazel.sh ]]; then
    if awk '/^flywheel-[A-Za-z0-9_-]+/{in_recipe=1; next} /^[A-Za-z0-9_.-]+[[:space:]]*:/ {in_recipe=0} in_recipe && /bazelisk[[:space:]]+(build|test|run|coverage)/ {bad=1} END {exit bad ? 0 : 1}' Justfile; then
      no "flywheel-* Justfile recipes invoke raw bazelisk instead of scripts/gloriousflywheel-bazel.sh"
    elif grep -q 'scripts/gloriousflywheel-bazel.sh' Justfile; then
      ok "Flywheel Justfile recipes route through scripts/gloriousflywheel-bazel.sh"
    else
      no "Flywheel Justfile recipes do not call scripts/gloriousflywheel-bazel.sh"
    fi
  else
    no "scripts/gloriousflywheel-bazel.sh is missing"
  fi
fi

# 7b. Endpoint and upload authority must not live in scaffold rc/workflow files.
# Ignore the defensive rejection regex inside `just sync-flywheel-bazelrc`.
endpoint_hits=$(
  grep -rnE '(--remote_cache=|--remote_executor=|--remote_upload_local_results=true)' \
    --include='.bazelrc.flywheel' --include='Justfile' --include='*.yml' --include='*.yaml' \
    --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null \
    | grep -v 'grep -Eq --' || true
)
if [[ -n "$endpoint_hits" ]]; then
  no "Hard-coded Flywheel endpoint or cache-upload authority found outside wrapper env"
else
  ok "No hard-coded Flywheel endpoint or cache-upload authority in rc/workflow/Justfile surfaces"
fi

# 8. No provider-specific state endpoint in spoke wiring. Descriptive prose is
# fine; flag only actual backend wiring such as provider URLs/backend blocks or
# endpoint literals in Tofu/workflows/Justfile.
if grep -rqEi '(rustfs://|minio://|garage://|backend\s+"(rustfs|minio|garage)"|endpoint\s*=\s*"(rustfs|minio|garage)[^"]*")' \
     --include='*.tf' --include='*.json' --include='*.yml' --include='*.yaml' --include='Justfile' \
     --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null; then
  no "provider-specific state-backend wiring found in repo (state provider is operator/env authority)"
else
  ok "No provider-specific state-backend wiring in repo"
fi

# 8b. Storage substrate is RustFS only — never Garage/MinIO (both hallucinations).
# Flag garage/minio in actual Tofu HCL wiring (endpoint/host literals); strip `#` comments first so
# the descriptive "never Garage/MinIO" guidance in backend.tf is not itself a false positive.
if find ./tofu -name '*.tf' -not -path '*/.git/*' -exec sed 's/#.*//' {} + 2>/dev/null | grep -qiE '\b(garage|minio)\b'; then
  no "Garage/MinIO referenced in tofu/*.tf wiring — the state substrate is RustFS only (Garage/MinIO are hallucinations)"
else
  ok "No Garage/MinIO in tofu/*.tf wiring (RustFS-only state substrate)"
fi

# 9. No OpenTofu in flywheel_target_classes (already covered by item 5)
ok "OpenTofu target-class check (subsumed by allowlist check)"

# 10. image_repository pattern
if [[ -f .github/lanes.json ]]; then
  img=$(jq -r '.spoke.image_repository // empty' .github/lanes.json)
  if [[ -z "$img" ]]; then
    ok "spoke.image_repository unset (default ghcr.io/<owner>/<spoke.name> resolved at workflow time)"
  elif echo "$img" | grep -qE '^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+$'; then
    ok "spoke.image_repository matches ghcr.io/<owner>/<repo>"
  else
    no "spoke.image_repository does not match ghcr.io/<owner>/<repo>: $img"
  fi
fi

# 11. Tailnet DNS — manual
man "Tailnet DNS for each lane resolves to a runner-reachable address"

# 12. AGENTS.md cites scaffold tag
if grep -qE 'site\.scaffold|scaffold (tag|version|@v[0-9])|spawned from' AGENTS.md 2>/dev/null \
   && grep -qE '\b(tag|spawned from|conforms to)\b' AGENTS.md 2>/dev/null; then
  ok "AGENTS.md cites the scaffold tag/spawning point"
else
  man "AGENTS.md cites the scaffold tag the repo conforms to (pre-D3 PR7 OK)"
fi

# 13. In-house package Bzlmod/npm parity
if [[ -f package.json && -f MODULE.bazel ]]; then
  set +e
  python3 scripts/check-inhouse-package-parity.py >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "In-house @tummycrypt/@tinyland package versions match MODULE.bazel"
  else
    no "In-house @tummycrypt/@tinyland package versions drift from MODULE.bazel"
  fi
else
  man "In-house package parity skipped (package.json or MODULE.bazel missing)"
fi

# 14. Gitleaks baseline exists and is routed through Just + Nix.
if [[ -f .gitleaks.toml ]]; then
  if grep -qE '^\[extend\]' .gitleaks.toml && grep -qE 'useDefault[[:space:]]*=[[:space:]]*true' .gitleaks.toml; then
    ok ".gitleaks.toml extends the default gitleaks ruleset"
  else
    no ".gitleaks.toml must extend the default gitleaks ruleset"
  fi
else
  no ".gitleaks.toml is missing"
fi

if [[ -f Justfile ]] && grep -qE '^[[:space:]]*secrets-scan-dir:' Justfile && grep -qE 'gitleaks[[:space:]]+dir' Justfile \
  && grep -qE '^[[:space:]]*secrets-scan:' Justfile && grep -qE 'gitleaks[[:space:]]+git' Justfile; then
  ok "Justfile exposes working-tree and git-history gitleaks scans"
else
  no "Justfile must expose secrets-scan-dir (gitleaks dir) and secrets-scan (gitleaks git)"
fi

if [[ -f flake.nix ]] && grep -qE '\bgitleaks\b' flake.nix; then
  ok "Nix dev shell includes gitleaks"
else
  no "flake.nix must include gitleaks for reproducible scans"
fi

# 15. SBOM posture must be executable when the manifest claims a recipe.
if [[ -f tinyland.repo.json ]]; then
  sbom_status=$(jq -r '.supply_chain.sbom.status // "not-required"' tinyland.repo.json)
  case "$sbom_status" in
    not-required)
      ok "SBOM generation not required by repo manifest"
      ;;
    planned)
      man "SBOM generation is planned but not yet required by conformance"
      ;;
    recipe-available|generated)
      if [[ -f Justfile ]] && grep -qE '^[[:space:]]*sbom([[:space:]][^:]*)?:' Justfile \
        && grep -qE '\bsyft\b' flake.nix 2>/dev/null; then
        ok "SBOM manifest status is backed by just sbom and syft in the Nix dev shell"
      else
        no "SBOM manifest status requires just sbom and syft in flake.nix"
      fi
      ;;
    *)
      no "Unknown SBOM manifest status: $sbom_status"
      ;;
  esac
fi

# 16. Public-safe: no internal cluster endpoints / hostnames leak into the tree.
# gitleaks only catches token shapes; this guards the private blahaj / tool-bus
# topology (and tofu/ slug-correctness) across ALL committed files.
if [[ -f scripts/scan-internal-endpoints.sh ]] && bash scripts/scan-internal-endpoints.sh >/dev/null 2>&1; then
  ok "no internal cluster endpoints/hostnames in tree (public-safe scan)"
else
  no "internal cluster endpoint/hostname leak — run just scan-endpoints"
fi

echo
echo "summary: ${pass} pass, ${fail} fail, ${manual} manual"
if (( fail > 0 )); then exit 1; fi
exit 0
