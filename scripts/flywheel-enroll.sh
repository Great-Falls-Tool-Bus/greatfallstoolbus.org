#!/usr/bin/env bash
# Advertised enrollment front door for GloriousFlywheel-backed Bazel work.
#
# The preferred path is fleet-managed profile distribution from
# GloriousFlywheel. This script does not mint tokens and does not persist bearer
# credentials. It can materialize an ignored .env.flywheel.local fallback only
# from explicitly supplied endpoint data or the current shell.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/flywheel-enroll.sh [profile] [options]

Options:
  profile                       shared-cache-backed, executor-backed,
                                cluster-cache, cluster-executor,
                                port-forward-cache, port-forward-executor,
                                or unattached.
                                Defaults to tinyland.repo.json
                                enrollment.substrateMode, then
                                shared-cache-backed.
  --profile <name>              Compatibility alias for positional profile.
  --cache-endpoint <url>        Cache endpoint for fallback materialization.
  --executor-endpoint <url>     Executor endpoint for executor-backed fallback.
  --instance-name <value>       REAPI instance name for routable front doors.
  --credential-helper <value>   Bazel credential helper scope/path.
  --credential-helper-token-file <path>
                                Token file consumed by the credential helper.
  --remote-header <value>       Optional Bazel remote header.
  --remote-cache-header <val>   Optional cache-only remote header.
  --remote-exec-header <val>    Optional executor-only remote header.
  --platform <name>             GloriousFlywheel executor platform identity.
  --write <path>                Write an ignored local env file.
  --write-local-env <path>      Write an ignored local env file. Recommended:
                                .env.flywheel.local.
  -h, --help                    Show this help.

Preferred enrollment:
  Install/refresh the GloriousFlywheel Home Manager or NixOS profile. It exports
  GF_FLYWHEEL_PROFILE_STATE plus endpoint metadata for this org.

Fallback enrollment:
  If the GloriousFlywheel profile tools package is on PATH, this script can call
  flywheel-consumer-env to write ignored local fallback material. It does not
  create credentials or tokens.
EOF
}

profile=""
cache_endpoint="${BAZEL_REMOTE_CACHE:-}"
executor_endpoint="${BAZEL_REMOTE_EXECUTOR:-}"
write_path=""
consumer_env_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
  --profile)
    profile="${2:-}"
    shift 2
    ;;
  --cache-endpoint)
    cache_endpoint="${2:-}"
    consumer_env_args+=("--cache-endpoint" "${cache_endpoint}")
    shift 2
    ;;
  --executor-endpoint)
    executor_endpoint="${2:-}"
    consumer_env_args+=("--executor-endpoint" "${executor_endpoint}")
    shift 2
    ;;
  --instance-name | --credential-helper | --credential-helper-token-file | --remote-header | --remote-cache-header | --remote-exec-header | --platform)
    consumer_env_args+=("$1" "${2:-}")
    shift 2
    ;;
  --write)
    write_path="${2:-}"
    consumer_env_args+=("--write" "${write_path}")
    shift 2
    ;;
  --write-local-env)
    write_path="${2:-}"
    consumer_env_args+=("--write" "${write_path}")
    shift 2
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    if [[ -z ${profile} && $1 != --* ]]; then
      profile="$1"
      shift
    else
      echo "ERROR: unknown option: $1" >&2
      usage
      exit 2
    fi
    ;;
  esac
done

if [[ -z ${profile} && -f tinyland.repo.json && $(command -v jq || true) ]]; then
  profile="$(jq -r '.enrollment.substrateMode // empty' tinyland.repo.json)"
fi
profile="${profile:-shared-cache-backed}"

case "${profile}" in
unattached | shared-cache-backed | executor-backed | cluster-cache | cluster-executor | port-forward-cache | port-forward-executor) ;;
*)
  echo "ERROR: unsupported profile: ${profile}" >&2
  usage
  exit 2
  ;;
esac

cat <<EOF
GloriousFlywheel enrollment
===========================
Repo:                  $(jq -r '.repo.github // .repo.name // "unknown"' tinyland.repo.json 2>/dev/null || echo "unknown")
Requested profile:     ${profile}
Current profile state: ${GF_FLYWHEEL_PROFILE_STATE:-unset}
Current Bazel mode:    ${GF_BAZEL_SUBSTRATE_MODE:-unset}
Cache endpoint:        ${cache_endpoint:-unset}
Executor endpoint:     ${executor_endpoint:-unset}

Canonical path:
  1. Operator installs the GloriousFlywheel Home Manager or NixOS profile for
     this org/user/runner class.
  2. Re-enter the shell so GF_FLYWHEEL_PROFILE_STATE and endpoint metadata are
     exported.
  3. Run: just flywheel-verify

Boundary:
  This command does not mint tokens, store bearer credentials, or create a new
  cache/executor substrate. Token exchange and enforcing front doors are owned
  by GloriousFlywheel.
EOF

if [[ -z ${write_path} ]]; then
  echo
  echo "No local env file requested. To create an ignored fallback:"
  echo "  just flywheel-enroll --write-local-env .env.flywheel.local --cache-endpoint <url>"
  echo "  just flywheel-enroll ${profile} --write .env.flywheel.local --cache-endpoint <url>"
  exit 0
fi

if ! command -v flywheel-consumer-env >/dev/null 2>&1; then
  echo "ERROR: flywheel-consumer-env is not on PATH." >&2
  echo "Install the GloriousFlywheel profile tools package, or source an operator-provided profile." >&2
  exit 1
fi

flywheel-consumer-env "${profile}" "${consumer_env_args[@]}"

echo
echo "Wrote ${write_path}. It is ignored by .gitignore; review before sourcing."
echo "Next: source ${write_path} && just flywheel-verify"
