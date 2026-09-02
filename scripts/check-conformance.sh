#!/usr/bin/env bash
# Check spoke conformance with the source contract in docs/CI-SCHEMA.md.
#
# Exit 0 if all mechanical checks pass; non-zero with a checklist of
# failures otherwise. Repository settings that are not mechanically verifiable
# from source are flagged as MANUAL.
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

echo "Conformance check (see docs/CI-SCHEMA.md)"
echo

# 0. repo manifest exists and validates against the sole v4 schema. Version 1
# is retired; an absent, mistyped, or non-2 value fails closed.
if [[ -f tinyland.repo.json ]]; then
  set +e
  manifest_out=$(python3 scripts/validate_repo_manifest.py \
    --manifest tinyland.repo.json 2>&1)
  rc=$?
  set -e
  manifest_line="${manifest_out##*$'\n'}"
  manifest_line="${manifest_line#error: }"
  case $rc in
    0) ok "$manifest_line" ;;
    2) man "tinyland.repo.json validator unavailable (jsonschema missing — run inside nix develop)" ;;
    3|4) no "$manifest_line" ;;
    *) no "tinyland.repo.json fails schema validation (run just repo-manifest-validate for details)" ;;
  esac

  role=$(jq -r '.taxonomy.primary_role // empty' tinyland.repo.json)
  if [[ "$role" == "app-stateful-spoke" ]]; then
    ok "repo manifest declares the GFTB application role"
  else
    no "repo manifest must declare app-stateful-spoke for this application (got: ${role:-missing})"
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

# 2. ci.yml pins the immutable v4 contract.
if [[ -f .github/workflows/ci.yml ]]; then
  if grep -q 'tinyland-inc/ci-templates/.github/workflows/spoke-ci-v4.yml@0067a1f0e16012ea91d0602b7d185e534774cadb' .github/workflows/ci.yml; then
    ok ".github/workflows/ci.yml pins the reviewed ci-templates v5.0.0 schema-3 commit"
  elif grep -qE 'tinyland-inc/ci-templates' .github/workflows/ci.yml; then
    no ".github/workflows/ci.yml does not pin the reviewed v4 action contract"
  else
    man "ci.yml does not reference ci-templates yet (pre-cutover OK)"
  fi
else
  no ".github/workflows/ci.yml is missing"
fi

# 3 & 4. Org ruleset + required checks
man "Org ruleset tinyland-spoke-default imported (verify: gh api repos/{owner}/{repo}/rulesets)"
man "Required status checks per §6 configured at the repo level"

# 6. No GitHub-hosted runner label anywhere in .github/workflows (TIN-3914).
# Operator ruling 2026-08-19: this org's CI runs only on the GF cache-fronted
# ARC fleet. `runs-on:` must name a `tinyland-*` capability label (served for
# Great-Falls-Tool-Bus by the `great-falls-tool-bus-nix` scale set); a
# GitHub-hosted label (`ubuntu-*`, `macos-*`, `windows-*`) is a hard fail at any
# nesting -- scalar, list item, or the `{group:, labels:}` mapping form. This
# supersedes the earlier artifact/bazel-shaped-jobs-only scope and the §6
# escape hatch, and it no longer softens to MANUAL when ci.yml is unpinned.
# Reusable workflows owned by ci-templates are out of scope here; this repo can
# only declare what it owns.
if [[ -d .github/workflows ]]; then
  offenders=""
  for f in .github/workflows/*.yml .github/workflows/*.yaml; do
    [[ -e "$f" ]] || continue
    # Emit the `runs-on:` line plus its more-indented continuation block, then
    # look for a hosted label in that block only.
    if awk '
        /^[[:space:]]*runs-on:/ {
          runs = 1
          match($0, /[^ ]/); ind = RSTART
          print
          next
        }
        runs {
          if ($0 ~ /^[[:space:]]*$/) next
          match($0, /[^ ]/)
          if (RSTART <= ind) { runs = 0; next }
          print
        }
      ' "$f" | grep -qE '(^|[^A-Za-z0-9_-])(ubuntu|macos|macOS|windows)-'; then
      offenders="$offenders $f"
    fi
  done
  if [[ -z "$offenders" ]]; then
    ok "No GitHub-hosted runs-on label in any workflow (TIN-3914)"
  else
    no "GitHub-hosted runs-on label found (TIN-3914: GFTB CI is ARC-only):$offenders"
  fi
fi

# Direct endpoint and upload authority must not live in source surfaces.
endpoint_hits=$(
  grep -rnE '(--remote_cache=|--remote_executor=|--remote_upload_local_results=true)' \
    --include='.bazelrc' --include='Justfile' --include='*.yml' --include='*.yaml' \
    --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null \
    || true
)
if [[ -n "$endpoint_hits" ]]; then
  no "Hard-coded Flywheel endpoint or cache-upload authority found in source"
else
  ok "No hard-coded Flywheel endpoint or cache-upload authority in source surfaces"
fi

# Preserve the application-specific public-source check formerly routed
# through the second conformance engine.
if [[ -x scripts/scan-internal-endpoints.sh ]] \
  && bash scripts/scan-internal-endpoints.sh >/dev/null 2>&1; then
  ok "No internal cluster endpoint or hostname in public source"
else
  no "Internal cluster endpoint or hostname found (run just scan-endpoints)"
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

# 12. AGENTS.md cites scaffold tag
if grep -qE 'site\.scaffold|scaffold (tag|version|@v[0-9])|spawned from' AGENTS.md 2>/dev/null \
   && grep -qE '\b(tag|spawned from|conforms to)\b' AGENTS.md 2>/dev/null; then
  ok "AGENTS.md cites the scaffold tag/spawning point"
else
  man "AGENTS.md cites the scaffold tag the repo conforms to (pre-D3 PR7 OK)"
fi

# 13. In-house package Bazel-only ingestion (TIN-2838): no org npm specifier in
#     package.json AND each org package present as bazel_dep + npm_link_package.
if [[ -f package.json && -f MODULE.bazel ]]; then
  set +e
  python3 scripts/check-inhouse-package-parity.py >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "In-house @tummycrypt/@tinyland packages are ingested Bazel-only (no npm specifier; bazel_dep + npm_link_package)"
  else
    no "In-house @tummycrypt/@tinyland packages violate Bazel-only ingestion (npm specifier present, or missing bazel_dep/npm_link_package)"
  fi
else
  man "In-house package Bazel-only ingestion check skipped (package.json or MODULE.bazel missing)"
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

echo
echo "--------------------------------------------------------------------------"
echo
echo "summary: ${pass} pass, ${fail} fail, ${manual} manual"
if (( fail > 0 )); then exit 1; fi
exit 0
