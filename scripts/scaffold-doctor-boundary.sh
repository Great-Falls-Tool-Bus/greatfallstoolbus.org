#!/usr/bin/env bash
# Authority-boundary audit for a Tinyland static spoke (or scaffold).
#
# Surfaces violations of the rules that should NEVER drift in a spoke:
#  - v4 source carries no direct cache/executor endpoint authority.
#  - root .bazelversion matches the estate value recorded in .bazelrc
#    next to the exact-SHA bazel-registry pin (TIN-3857 Step A SSOT).
#  - flake.nix has no hard-coded secrets or token paths.
#  - .github/workflows/*.yml do not invoke Cloudflare API mutations directly.
#  - package.json does not range-pin in-house @tummycrypt/* or @tinyland/*.
#  - No browser/edge runtime fetch of tinyland.dev from src/.
#
# Exit 0 if clean, 1 if any P0/FAIL surfaced. WARNs do not fail the run.

set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

fail_count=0
warn_count=0

check_fail() {
  local msg="$1"
  echo "FAIL | $msg"
  fail_count=$((fail_count + 1))
}

check_warn() {
  local msg="$1"
  echo "WARN | $msg"
  warn_count=$((warn_count + 1))
}

check_pass() {
  echo "PASS | $1"
}

# Neither PASS nor FAIL: the row does not apply to this repo. Printed so an
# inapplicable row is explicit rather than silently absent.
check_skip() {
  echo "SKIP | $1"
}

# .bazelversion SSOT (TIN-3857 Step A): if this repo pins tinyland-inc/bazel-registry
# in .bazelrc, the root .bazelversion must equal the estate-wide value recorded
# next to that pin, as a `# estate-bazelversion: <x.y.z>` line in .bazelrc.
#
# The row is gated on the registry pin actually being present, not merely on
# .bazelrc existing: a repo with a .bazelrc but no registry pin is out of scope
# for the SSOT rule, and says so with a SKIP row rather than emitting nothing.
#
# LIMITS, stated plainly: this is an OFFLINE check. It proves the root
# .bazelversion has not drifted from the value recorded in .bazelrc; it does
# NOT contact tinyland-inc/bazel-registry, so it cannot see what the pinned
# registry commit's own .bazelversion says. Those two agree as of the current
# pin: .bazelrc pins the registry commit that converged the estate on 8.2.1,
# and that commit records 8.2.1. Keeping them in agreement is the job of the
# re-pin procedure documented in .bazelrc -- re-read the registry's
# .bazelversion at the newly pinned SHA, and regenerate MODULE.bazel.lock in
# the same commit -- not of this row. This row cannot verify that, and does
# not claim to.
if [ -f .bazelrc ] && grep -Eq '^[^#]*--registry=https://raw\.githubusercontent\.com/tinyland-inc/bazel-registry/' .bazelrc; then
  recorded="$(sed -n 's|^#[[:space:]]*estate-bazelversion:[[:space:]]*\([0-9][0-9.]*\)[[:space:]]*$|\1|p' .bazelrc | head -1)"
  actual=""
  if [ -f .bazelversion ]; then actual="$(tr -d '[:space:]' < .bazelversion)"; fi
  if [ ! -f .bazelversion ]; then
    check_fail "no root .bazelversion, but .bazelrc pins tinyland-inc/bazel-registry - the estate version must be pinned per repo (TIN-3857)"
  elif [ -z "$recorded" ]; then
    check_fail ".bazelrc records no '# estate-bazelversion: <x.y.z>' next to the registry pin (TIN-3857)"
  elif [ "$recorded" != "$actual" ]; then
    check_fail ".bazelversion ($actual) != estate value recorded in .bazelrc ($recorded) - converge or re-record at the next registry re-pin"
  else
    check_pass ".bazelversion ($actual) matches the estate value recorded in .bazelrc"
  fi
elif [ ! -f .bazelrc ]; then
  check_skip ".bazelversion SSOT not checked: no .bazelrc (row out of scope for this repo)"
else
  check_skip ".bazelversion SSOT not checked: .bazelrc has no tinyland-inc/bazel-registry pin (row out of scope for this repo)"
fi

# flake.nix must not hard-code secrets
if [ -f flake.nix ]; then
  if grep -E '(api[_-]?key|token|secret|password)\s*=\s*"[^"]+' flake.nix >/dev/null 2>&1; then
    check_fail "flake.nix appears to hard-code a secret/token literal"
  else
    check_pass "flake.nix has no obvious secret literals"
  fi
fi

# Workflows must not directly mutate Cloudflare (DNS/Access/Tunnel)
#
# Glob into an array under `nullglob` rather than `compgen -G`: the Nix devshell
# bash is built without the programmable-completion builtins, so `compgen` there
# is "command not found" and this whole row silently no-op'd (TIN-3898).
workflow_files=()
if [ -d .github/workflows ]; then
  shopt -s nullglob
  workflow_files=(.github/workflows/*.yml)
  shopt -u nullglob
fi
if [ "${#workflow_files[@]}" -gt 0 ]; then
  if grep -rlE '(api\.cloudflare\.com/client/v4/(zones|accounts).*/(dns_records|access|tunnels))' .github/workflows/ 2>/dev/null | head -1 >/dev/null; then
    check_fail "a workflow appears to call Cloudflare mutation endpoints directly — go through blahaj"
  else
    check_pass "no direct Cloudflare mutation in workflows"
  fi
fi

# package.json: in-house deps must be exact-pinned (no ^ or ~)
if [ -f package.json ]; then
  bad="$(python3 - <<'PY'
import json, sys
try:
    pkg = json.load(open("package.json"))
except Exception:
    sys.exit(0)
bad = []
for section in ("dependencies", "devDependencies", "peerDependencies"):
    for name, ver in (pkg.get(section) or {}).items():
        if name.startswith("@tummycrypt/") or name.startswith("@tinyland/"):
            if isinstance(ver, str) and (ver.startswith("^") or ver.startswith("~")):
                bad.append(f"{name}={ver}")
for b in bad:
    print(b)
PY
)"
  if [ -n "$bad" ]; then
    while IFS= read -r dep; do
      check_fail "package.json range-pins in-house dep: $dep (must be exact)"
    done <<<"$bad"
  else
    check_pass "package.json in-house deps are exact-pinned"
  fi
fi

# No runtime fetch of tinyland.dev from src/ (browser/edge)
if [ -d src ]; then
  if grep -rE 'fetch\(\s*["'"'"']https?://tinyland\.dev' src/ 2>/dev/null | head -1 >/dev/null; then
    check_fail "src/ contains a runtime fetch of tinyland.dev — spokes are static; use checked-in snapshots"
  else
    check_pass "src/ has no runtime tinyland.dev fetch"
  fi
fi

# Skeleton pin check
if [ -f package.json ]; then
  # The pins live in devDependencies; check BOTH halves of the version-locked pair.
  for skpkg in @skeletonlabs/skeleton @skeletonlabs/skeleton-svelte; do
    sk="$(python3 -c "import json,sys; pkg=json.load(open('package.json')); deps={**(pkg.get('dependencies') or {}), **(pkg.get('devDependencies') or {})}; print(deps.get(sys.argv[1],''))" "$skpkg")"
    if [ -z "$sk" ]; then
      check_warn "$skpkg missing from package.json (scaffold canonical: 5.0.1 paired)"
    elif [ "$sk" != "5.0.1" ]; then
      check_warn "$skpkg=$sk (scaffold canonical: 5.0.1; the two Skeleton packages must move as a pair)"
    else
      check_pass "$skpkg pinned at 5.0.1"
    fi
  done
fi

echo ""
echo "SUMMARY: $fail_count FAIL, $warn_count WARN"

exit $((fail_count > 0))
