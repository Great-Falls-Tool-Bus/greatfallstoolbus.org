#!/usr/bin/env bash
# Cold-landing diagnostic for GloriousFlywheel-backed Bazel work.
#
# An agent or fresh dev that runs `just flywheel-build` without setup hits a
# fast-fail in scripts/gloriousflywheel-bazel.sh. This script answers the
# question "what's missing, and where do I get it?" before the agent has to
# read the wrapper source.
#
# Exit 0 if ready. Exit 1 with actionable guidance if not. Exit 2 if the
# environment is set but reachability fails.

set -euo pipefail

ok() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; }
miss() { printf '  \033[31mMISS\033[0m %s\n' "$1"; }
hint() { printf '       %s\n' "$1"; }

echo ""
echo "GloriousFlywheel cold-landing diagnostic"
echo "========================================"
echo ""

missing=0

# 1. bazelisk on PATH
if command -v bazelisk >/dev/null 2>&1; then
  ok "bazelisk on PATH ($(bazelisk --version 2>&1 | head -n1))"
else
  miss "bazelisk not on PATH"
  hint "Enter the nix dev shell first: \`direnv allow\` or \`nix develop\`."
  missing=$((missing + 1))
fi

# 2. Fleet profile state
profile_state="${GF_FLYWHEEL_PROFILE_STATE:-}"
case "${profile_state}" in
  shared-cache-backed)
    ok "GF_FLYWHEEL_PROFILE_STATE = shared-cache-backed"
    ;;
  executor-backed)
    ok "GF_FLYWHEEL_PROFILE_STATE = executor-backed"
    ;;
  local-proof)
    if [ "${GF_BAZEL_LOCAL_PROOF:-}" = "port-forward" ]; then
      ok "GF_FLYWHEEL_PROFILE_STATE = local-proof (port-forward)"
    else
      miss "GF_FLYWHEEL_PROFILE_STATE = local-proof but GF_BAZEL_LOCAL_PROOF is not port-forward"
      hint "Local proof is bounded operator evidence only. Set GF_BAZEL_LOCAL_PROOF=port-forward when using a local tunnel."
      missing=$((missing + 1))
    fi
    ;;
  unattached)
    miss "GF_FLYWHEEL_PROFILE_STATE = unattached"
    hint "Install or refresh the GloriousFlywheel fleet profile, then re-enter the shell."
    hint "Fallback: run \`just flywheel-enroll --help\` for ignored .env.flywheel.local materialization."
    missing=$((missing + 1))
    ;;
  "")
    miss "GF_FLYWHEEL_PROFILE_STATE is unset"
    hint "Run \`just flywheel-enroll\` to inspect the advertised enrollment path."
    hint "Preferred source: GloriousFlywheel Home Manager/NixOS profile distribution."
    missing=$((missing + 1))
    ;;
  *)
    miss "GF_FLYWHEEL_PROFILE_STATE = ${profile_state} is not recognized"
    hint "Expected: unattached | shared-cache-backed | executor-backed | local-proof"
    missing=$((missing + 1))
    ;;
esac

# 3. BAZEL_REMOTE_CACHE
if [ -n "${BAZEL_REMOTE_CACHE:-}" ]; then
  case "${BAZEL_REMOTE_CACHE}" in
    grpc://*|grpcs://*|http://*|https://*)
      ok "BAZEL_REMOTE_CACHE = ${BAZEL_REMOTE_CACHE}"
      ;;
    *)
      miss "BAZEL_REMOTE_CACHE is set but doesn't start with grpc://, grpcs://, http://, or https://"
      hint "Current value: ${BAZEL_REMOTE_CACHE}"
      missing=$((missing + 1))
      ;;
  esac
else
  miss "BAZEL_REMOTE_CACHE is unset"
  hint "Attach through the fleet profile. On-cluster runners and managed developer shells should receive it from GloriousFlywheel."
  hint "Ignored fallback: \`just flywheel-enroll --write-local-env .env.flywheel.local --cache-endpoint <url>\`."
  missing=$((missing + 1))
fi

# 4. GF_BAZEL_SUBSTRATE_MODE
mode="${GF_BAZEL_SUBSTRATE_MODE:-}"
case "${mode}" in
  shared-cache-backed)
    ok "GF_BAZEL_SUBSTRATE_MODE = shared-cache-backed (cache only)"
    ;;
  executor-backed)
    if [ -n "${BAZEL_REMOTE_EXECUTOR:-}" ]; then
      ok "GF_BAZEL_SUBSTRATE_MODE = executor-backed; BAZEL_REMOTE_EXECUTOR = ${BAZEL_REMOTE_EXECUTOR}"
    else
      miss "GF_BAZEL_SUBSTRATE_MODE = executor-backed but BAZEL_REMOTE_EXECUTOR is unset"
      hint "Either set BAZEL_REMOTE_EXECUTOR, or downgrade to shared-cache-backed."
      missing=$((missing + 1))
    fi
    ;;
  "")
    miss "GF_BAZEL_SUBSTRATE_MODE is unset"
    hint "It should come from the same fleet profile as GF_FLYWHEEL_PROFILE_STATE."
    hint "Use shared-cache-backed for cache-only work; executor-backed only for proved target classes on cluster runners."
    missing=$((missing + 1))
    ;;
  *)
    miss "GF_BAZEL_SUBSTRATE_MODE = ${mode} is not a recognized value"
    hint "Expected: shared-cache-backed | executor-backed"
    missing=$((missing + 1))
    ;;
esac

# 5. Profile/mode consistency
case "${profile_state}:${mode}" in
  shared-cache-backed:shared-cache-backed | executor-backed:executor-backed | local-proof:shared-cache-backed | local-proof:executor-backed | unattached: | :*)
    ;;
  unattached:*)
    miss "Profile state is unattached but GF_BAZEL_SUBSTRATE_MODE is ${mode}"
    hint "Unattached profiles must not select a Bazel substrate mode."
    missing=$((missing + 1))
    ;;
  shared-cache-backed:*)
    miss "Profile state shared-cache-backed disagrees with GF_BAZEL_SUBSTRATE_MODE=${mode:-unset}"
    missing=$((missing + 1))
    ;;
  executor-backed:*)
    miss "Profile state executor-backed disagrees with GF_BAZEL_SUBSTRATE_MODE=${mode:-unset}"
    missing=$((missing + 1))
    ;;
esac

if [ "${profile_state}" = "unattached" ] && { [ -n "${BAZEL_REMOTE_CACHE:-}" ] || [ -n "${BAZEL_REMOTE_EXECUTOR:-}" ]; }; then
  miss "Unattached profile must not set cache or executor endpoints"
  missing=$((missing + 1))
fi

# 6. Upload posture
upload="${GF_BAZEL_REMOTE_UPLOAD:-}"
case "${upload}" in
  "" | false)
    ok "GF_BAZEL_REMOTE_UPLOAD = false (read-only; correct for PRs)"
    ;;
  true)
    warn "GF_BAZEL_REMOTE_UPLOAD = true (only set this on trusted default-branch / operator lanes)"
    ;;
  *)
    warn "GF_BAZEL_REMOTE_UPLOAD = ${upload} (expected true|false)"
    ;;
esac

# 7. .bazelrc.flywheel sanity
if [ -f .bazelrc.flywheel ]; then
  if grep -qE '^[^#]*--(remote_cache|remote_executor)=' .bazelrc.flywheel; then
    miss ".bazelrc.flywheel hard-codes a remote endpoint (must come from env, not rc files)"
    missing=$((missing + 1))
  else
    ok ".bazelrc.flywheel is endpoint-free"
  fi
else
  warn ".bazelrc.flywheel missing — wrapper requires it for safe-behavior flags"
fi

# 8. Reachability probe (best-effort; only when cache URL is well-formed)
if [ -n "${BAZEL_REMOTE_CACHE:-}" ] && command -v nc >/dev/null 2>&1; then
  hostport="$(echo "${BAZEL_REMOTE_CACHE}" | sed -E 's|^[a-z]+://||; s|/.*$||')"
  host="${hostport%:*}"
  port="${hostport##*:}"
  if [ -n "${host}" ] && [ -n "${port}" ] && [ "${host}" != "${port}" ]; then
    if nc -z -w 2 "${host}" "${port}" 2>/dev/null; then
      ok "Reachability: ${host}:${port} responds"
    else
      warn "Reachability: ${host}:${port} did NOT respond within 2s (off-cluster? VPN?)"
    fi
  fi
fi

echo ""
if [ "${missing}" -eq 0 ]; then
  echo "Result: READY. Run \`just flywheel-info\` to verify cache attachment."
  exit 0
fi

echo "Result: ${missing} blocker(s). Fix them and re-run \`just flywheel-doctor\`."
echo "Reference: docs/CI-SCHEMA.md §5, AGENTS.md 'Flywheel Binding'."
exit 1
