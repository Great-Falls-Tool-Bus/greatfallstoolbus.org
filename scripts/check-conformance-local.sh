#!/usr/bin/env bash
# GFTB-local conformance addendum, run AFTER the ingested
# scripts/check-conformance.sh (see the `conformance` Justfile recipe).
#
# Why this file exists rather than hand-patching check-conformance.sh: that
# script is a byte-identical re-ingest from tinyland-inc/site.scaffold
# (see AGENTS.md's Conformance section and the PR that added this file) --
# the whole point of a re-ingest is that it can be diffed against the
# upstream source with zero drift. Patching it directly would silently
# re-fork it, which is the exact failure mode (D19-D22) the re-ingest exists
# to close. Local, GFTB-specific checks that have no scaffold equivalent
# live here instead, additive and clearly attributed.
#
# Two items restored here, both real regressions the wholesale re-ingest
# introduced (see AGENTS.md's Conformance section for the full account):
#
#   1. Internal-endpoint / hostname leak scan. The pre-ingest local
#      check-conformance.sh ran this as checklist item 16; the vanilla
#      scaffold has no equivalent item at all, so re-ingesting silently
#      dropped it from the checklist with zero red signal. The underlying
#      scanner (scripts/scan-internal-endpoints.sh) was never touched and
#      is unconditionally wired into `just check` (see Justfile's `check`
#      recipe) and `just scaffold-doctor`'s layer 1 -- this item exists so
#      `just conformance` alone also reports it, matching the pre-ingest
#      checklist's shape.
#   2. app-stateful-spoke role recognition. The ingested check-conformance.sh
#      role gate (docs/CI-SCHEMA.md's `## 1. Scope and ownership` shape)
#      only recognizes static-spoke/static-spoke-scaffold, because vanilla
#      site.scaffold is a static-spoke template and does not model this
#      role at all. This repo's own tinyland.repo.json declares
#      app-stateful-spoke (TIN-3815, ratified) with owns_runtime_backend
#      true and owns_gitops_apply/owns_cloudflare_mutation false -- the
#      pre-ingest local script validated exactly that shape; this item
#      restores it.
#
# Usage: scripts/check-conformance-local.sh [--strict]
#   --strict  treat MANUAL items as failures (matches check-conformance.sh)

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

STRICT=0
if [[ "${1:-}" == "--strict" ]]; then STRICT=1; fi

pass=0
fail=0

ok() { printf "  ✓ %s\n" "$1"; pass=$((pass+1)); }
no() { printf "  ✗ %s\n" "$1"; fail=$((fail+1)); }

echo
echo "GFTB-local conformance addendum (see scripts/check-conformance-local.sh)"
echo

# 1. Internal-endpoint / hostname leak scan (restores the pre-ingest item 16).
if [[ -f scripts/scan-internal-endpoints.sh ]] && bash scripts/scan-internal-endpoints.sh >/dev/null 2>&1; then
  ok "no internal cluster endpoints/hostnames in tree (public-safe scan; local addendum)"
else
  no "internal cluster endpoint/hostname leak — run just scan-endpoints (local addendum)"
fi

# 2. app-stateful-spoke role recognition (the ingested role gate only
#    accepts static-spoke/static-spoke-scaffold; this repo is app-stateful-spoke).
if [[ -f tinyland.repo.json ]]; then
  role=$(jq -r '.taxonomy.primary_role // empty' tinyland.repo.json)
  case "$role" in
    static-spoke | static-spoke-scaffold)
      ok "repo manifest declares a static-spoke-compatible role (local addendum; ingested gate already covers this)"
      ;;
    app-stateful-spoke)
      owns_backend=$(jq -r '.boundaries.owns_runtime_backend // false' tinyland.repo.json)
      owns_gitops=$(jq -r '.boundaries.owns_gitops_apply // false' tinyland.repo.json)
      owns_cf=$(jq -r '.boundaries.owns_cloudflare_mutation // false' tinyland.repo.json)
      if [[ "$owns_backend" == "true" && "$owns_gitops" == "false" && "$owns_cf" == "false" ]]; then
        ok "repo manifest declares app-stateful-spoke owning its runtime backend, apply authority left external (local addendum, TIN-3815)"
      else
        no "app-stateful-spoke must set owns_runtime_backend=true and leave owns_gitops_apply/owns_cloudflare_mutation false (local addendum)"
      fi
      ;;
    *)
      no "repo manifest declares an unsupported role (got: ${role:-missing}); expected static-spoke, static-spoke-scaffold, or app-stateful-spoke (local addendum)"
      ;;
  esac
else
  no "tinyland.repo.json is missing (local addendum)"
fi

echo
echo "conformance-local: ${pass} pass, ${fail} fail"
if (( fail > 0 )); then exit 1; fi
exit 0
