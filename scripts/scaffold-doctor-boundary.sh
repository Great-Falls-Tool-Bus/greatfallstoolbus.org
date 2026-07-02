#!/usr/bin/env bash
# Authority-boundary audit for a Tinyland static spoke (or scaffold).
#
# Surfaces violations of the rules that should NEVER drift in a spoke:
#  - .bazelrc.flywheel has no remote_cache= or remote_executor= lines.
#  - flake.nix has no hard-coded secrets or token paths.
#  - .github/workflows/*.yml do not invoke Cloudflare API mutations directly.
#  - package.json does not range-pin in-house @tummycrypt/* or @tinyland/*.
#  - tofu/backend.tf uses S3-compatible state (no rustfs).
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

# .bazelrc.flywheel must be endpoint-free
if [ -f .bazelrc.flywheel ]; then
  if grep -E '^[^#]*--remote_cache=' .bazelrc.flywheel >/dev/null 2>&1; then
    check_fail ".bazelrc.flywheel hard-codes remote_cache (must come from env)"
  elif grep -E '^[^#]*--remote_executor=' .bazelrc.flywheel >/dev/null 2>&1; then
    check_fail ".bazelrc.flywheel hard-codes remote_executor (must come from env)"
  else
    check_pass ".bazelrc.flywheel is endpoint-free"
  fi
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
if compgen -G ".github/workflows/*.yml" >/dev/null; then
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

# tofu state backend must not be rustfs
if [ -f tofu/backend.tf ]; then
  if grep -Eiv '^\s*#' tofu/backend.tf | grep -Ei '(rustfs://|backend\s+"rustfs"|endpoint\s*=\s*"[^"]*rustfs)' >/dev/null 2>&1; then
    check_fail "tofu/backend.tf uses rustfs — forbidden until TIN-1147 proves repair"
  else
    check_pass "tofu/backend.tf does not use rustfs"
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
  sk="$(python3 -c "import json; pkg=json.load(open('package.json')); print((pkg.get('dependencies') or {}).get('@skeletonlabs/skeleton',''))")"
  if [ -n "$sk" ] && [ "$sk" != "4.15.2" ]; then
    check_warn "@skeletonlabs/skeleton=$sk (scaffold canonical: 4.15.2)"
  elif [ -n "$sk" ]; then
    check_pass "@skeletonlabs/skeleton pinned at 4.15.2"
  fi
fi

echo ""
echo "SUMMARY: $fail_count FAIL, $warn_count WARN"

exit $((fail_count > 0))
