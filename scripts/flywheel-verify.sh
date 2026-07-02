#!/usr/bin/env bash
# Fail-closed enrollment verifier for the advertised GloriousFlywheel path.
#
# This does not run Bazel and does not mint credentials. It validates that the
# current shell has a fleet-managed Flywheel profile state consistent with the
# cache/executor environment before an agent attempts `just flywheel-build`.

set -euo pipefail

failures=0

ok() {
  printf 'OK   %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1" >&2
  failures=$((failures + 1))
}

valid_endpoint() {
  local name="$1"
  local value="$2"

  if [[ -z ${value} ]]; then
    fail "${name} is required"
    return
  fi
  if [[ ${value} == *'${'* ]] || [[ ${value} == *'}'* ]]; then
    fail "${name} contains a literal shell placeholder"
    return
  fi
  if [[ ! ${value} =~ ^(grpc|grpcs|http|https):// ]]; then
    fail "${name} must start with grpc://, grpcs://, http://, or https://"
    return
  fi
  ok "${name} is set"
}

profile_state="${GF_FLYWHEEL_PROFILE_STATE:-}"
mode="${GF_BAZEL_SUBSTRATE_MODE:-}"
cache="${BAZEL_REMOTE_CACHE:-}"
executor="${BAZEL_REMOTE_EXECUTOR:-}"

case "${profile_state}" in
shared-cache-backed)
  ok "profile state shared-cache-backed"
  [[ ${mode} == "shared-cache-backed" ]] || fail "shared-cache-backed profile requires GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed"
  valid_endpoint "BAZEL_REMOTE_CACHE" "${cache}"
  [[ -z ${executor} ]] || fail "shared-cache-backed profile must not set BAZEL_REMOTE_EXECUTOR"
  ;;
executor-backed)
  ok "profile state executor-backed"
  [[ ${mode} == "executor-backed" ]] || fail "executor-backed profile requires GF_BAZEL_SUBSTRATE_MODE=executor-backed"
  valid_endpoint "BAZEL_REMOTE_CACHE" "${cache}"
  valid_endpoint "BAZEL_REMOTE_EXECUTOR" "${executor}"
  ;;
local-proof)
  ok "profile state local-proof"
  [[ ${GF_BAZEL_LOCAL_PROOF:-} == "port-forward" ]] || fail "local-proof requires GF_BAZEL_LOCAL_PROOF=port-forward"
  case "${mode}" in
  shared-cache-backed | executor-backed) ok "local-proof substrate mode ${mode}" ;;
  *) fail "local-proof requires GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed or executor-backed" ;;
  esac
  valid_endpoint "BAZEL_REMOTE_CACHE" "${cache}"
  if [[ ${mode} == "executor-backed" ]]; then
    valid_endpoint "BAZEL_REMOTE_EXECUTOR" "${executor}"
  fi
  ;;
unattached)
  fail "profile state unattached; install/refresh the GloriousFlywheel fleet profile before Flywheel Bazel work"
  [[ -z ${cache} ]] || fail "unattached profile must not set BAZEL_REMOTE_CACHE"
  [[ -z ${executor} ]] || fail "unattached profile must not set BAZEL_REMOTE_EXECUTOR"
  ;;
"")
  fail "GF_FLYWHEEL_PROFILE_STATE is unset; run just flywheel-enroll or install the GloriousFlywheel fleet profile"
  ;;
*)
  fail "GF_FLYWHEEL_PROFILE_STATE=${profile_state} is not recognized"
  ;;
esac

case "${GF_BAZEL_REMOTE_UPLOAD:-false}" in
true)
  printf 'WARN GF_BAZEL_REMOTE_UPLOAD=true is trusted-lane only\n' >&2
  ;;
false | "") ;;
*)
  fail "GF_BAZEL_REMOTE_UPLOAD must be true or false"
  ;;
esac

if [[ -f scripts/cache-attachment-contract.sh && ${profile_state} != "local-proof" && ${profile_state} != "unattached" && -n ${profile_state} ]]; then
  if ! bash scripts/cache-attachment-contract.sh --strict >/dev/null; then
    fail "cache attachment contract failed; run just cache-contract-strict for details"
  else
    ok "cache attachment contract passed"
  fi
fi

if [[ ${failures} -ne 0 ]]; then
  printf '\nFlywheel enrollment verify failed with %d blocker(s).\n' "${failures}" >&2
  printf 'Run `just flywheel-doctor` for guidance.\n' >&2
  exit 1
fi

printf '\nFlywheel enrollment verify passed.\n'
