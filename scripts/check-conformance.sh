#!/usr/bin/env bash
# Check spoke conformance with docs/CI-SCHEMA.md §11 checklist.
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

echo "Conformance check (see docs/CI-SCHEMA.md §11)"
echo

# 0. repo manifest exists and validates against the repo taxonomy schema
# matching its schema_version (1 -> v1 schema, 2 -> v2 schema).
if [[ -f tinyland.repo.json ]]; then
  manifest_schema=docs/schemas/tinyland-repo-manifest.schema.json
  if [[ "$(jq -r '.schema_version // 1' tinyland.repo.json)" == "2" ]]; then
    manifest_schema=docs/schemas/tinyland-repo-manifest.v2.schema.json
  fi
  set +e
  python3 scripts/validate-lanes.py \
    --schema "$manifest_schema" \
    --instance tinyland.repo.json >/dev/null 2>&1
  rc=$?
  set -e
  case $rc in
    0) ok "tinyland.repo.json validates against ${manifest_schema##*/}" ;;
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
man "Required status checks per §6 configured at the repo level"

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

# 10. Optional artifact-repository metadata shape
if [[ -f .github/lanes.json ]]; then
  img=$(jq -r '.spoke.image_repository // empty' .github/lanes.json)
  if [[ -z "$img" ]]; then
    ok "spoke.image_repository unset (optional artifact metadata not declared)"
  elif echo "$img" | grep -qE '^ghcr\.io/[a-z0-9._-]+/[a-z0-9._-]+$'; then
    ok "spoke.image_repository metadata matches ghcr.io/<owner>/<repo>"
  else
    no "spoke.image_repository does not match ghcr.io/<owner>/<repo>: $img"
  fi
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

# 16. Substrate-boundary conformance (TIN-2423 / TIN-3066): the scaffold has
# no direct Blahaj application/PR receiver reach.
if [[ -f scripts/validate-substrate-boundary.py ]]; then
  set +e
  python3 scripts/validate-substrate-boundary.py >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "substrate-boundary validation passed (zero direct application/PR receiver reach)"
  else
    no "substrate-boundary validation failed (run scripts/validate-substrate-boundary.py for details)"
  fi
else
  no "scripts/validate-substrate-boundary.py is missing"
fi

# 17. Production-convergence contract (TIN-489 / TIN-3065): main is the only
# durable branch, no checked-in receipts, no SHA literals in binding documents
# outside the receipt claim, and any declared converge carrier must exist and
# reference a checked-in workflow-state toggle document.
if [[ -f scripts/test-production-convergence-contract.py ]]; then
  set +e
  python3 scripts/test-production-convergence-contract.py >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "production-convergence contract holds (run just production-convergence-contract for details)"
  else
    no "production-convergence contract violated (run just production-convergence-contract for details)"
  fi
else
  no "scripts/test-production-convergence-contract.py is missing"
fi

# 17b. Published converge-agent carrier module contract (TIN-2030): module-source
# laws (kill switch proven by EXECUTING the gate against enabled:true/false
# fixtures, digest-not-tag, template-mode derivation, edge-probe custody) plus
# N-tenant isolation laws. The module directory is .bazelignore'd from the
# root graph on purpose (nested Bazel module published to the registry), so
# the root Bazel lanes never run its test — this item and the ci.yml
# carrier-module-contract job are its standing gates.
if [[ -f modules/converge_agent/tests/test_converge_agent_contract.py ]]; then
  set +e
  python3 modules/converge_agent/tests/test_converge_agent_contract.py >/dev/null 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    ok "converge-agent carrier module contract holds (run just converge-agent-module-contract for details)"
  else
    no "converge-agent carrier module contract violated (run just converge-agent-module-contract for details)"
  fi
else
  no "modules/converge_agent/tests/test_converge_agent_contract.py is missing"
fi

echo
echo "--------------------------------------------------------------------------"
# 18. Anti-dogfooding + packaging tag-shape scan (TIN-2672 phase 1, P4 of the
# maximize-Bazel-SSOT roadmap). WARN only: never touches pass/fail/manual and
# never affects this script's exit code. The two anti-patterns detected are:
#   (1) an in-house @tummycrypt/@tinyland package.json dep declared as
#       workspace:* or a vendored tarball/producer-tree path instead of a
#       bazel-registry-pinned exact npm version;
#   (2) a pkg_tar/container packaging Bazel target whose tags mix or omit
#       pieces of the two disjoint packaging classes (deployment-bundle-
#       packaging+flywheel-eligible OR container-image-and-push+
#       gloriousflywheel-cache-only+no-remote-exec, never mixed).
# A later PR flips this to a hard-fail conformance item once the fleet has had
# a chance to react to the drift it surfaces.
if [[ -f scripts/check-bazel-ssot-report-only.py ]]; then
  python3 scripts/check-bazel-ssot-report-only.py || true
else
  echo "  ⚠ REPORT-ONLY: scripts/check-bazel-ssot-report-only.py is missing (skipping scan)"
fi

echo
echo "summary: ${pass} pass, ${fail} fail, ${manual} manual"
if (( fail > 0 )); then exit 1; fi
exit 0
