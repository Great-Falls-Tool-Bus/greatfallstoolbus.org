#!/usr/bin/env bash
# Contract tests for the advertised Flywheel enroll/doctor/verify path.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

pass=0
fail=0

run_case() {
  local expected="$1"
  local desc="$2"
  shift 2
  local out actual
  set +e
  out="$(env -i PATH="$PATH" "$@" bash scripts/flywheel-verify.sh 2>&1)"
  actual=$?
  set -e
  if [[ ${actual} -eq ${expected} ]]; then
    pass=$((pass + 1))
    printf 'ok   [exit %d] %s\n' "${actual}" "${desc}"
  else
    fail=$((fail + 1))
    printf 'FAIL [exit %d, want %d] %s\n' "${actual}" "${expected}" "${desc}"
    printf '       last: %s\n' "$(printf '%s\n' "${out}" | tail -1)"
  fi
}

CACHE="grpcs://bazel-cache.example.internal:9092"
EXECUTOR="grpcs://gf-reapi-cell.example.internal:8980"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
HELPER_BIN="${TMP_DIR}/bin"
mkdir -p "${HELPER_BIN}"

cat >"${HELPER_BIN}/flywheel-consumer-env" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

profile="${1:?missing profile}"
shift
cache=""
executor=""
instance=""
helper=""
token_file=""
write=""

while [[ $# -gt 0 ]]; do
  case "$1" in
  --cache-endpoint) cache="${2:-}"; shift 2 ;;
  --executor-endpoint) executor="${2:-}"; shift 2 ;;
  --instance-name) instance="${2:-}"; shift 2 ;;
  --credential-helper) helper="${2:-}"; shift 2 ;;
  --credential-helper-token-file) token_file="${2:-}"; shift 2 ;;
  --write) write="${2:-}"; shift 2 ;;
  *) echo "unexpected helper arg: $1" >&2; exit 2 ;;
  esac
done

case "${profile}" in
shared-cache-backed) mode="shared-cache-backed" ;;
executor-backed) mode="executor-backed" ;;
*) echo "unexpected helper profile: ${profile}" >&2; exit 2 ;;
esac

{
  printf 'export GF_FLYWHEEL_PROFILE_STATE=%q\n' "${profile}"
  printf 'export GF_BAZEL_SUBSTRATE_MODE=%q\n' "${mode}"
  printf 'export BAZEL_REMOTE_CACHE=%q\n' "${cache}"
  [[ -z ${executor} ]] || printf 'export BAZEL_REMOTE_EXECUTOR=%q\n' "${executor}"
  [[ -z ${instance} ]] || printf 'export BAZEL_REMOTE_INSTANCE_NAME=%q\n' "${instance}"
  [[ -z ${helper} ]] || printf 'export BAZEL_CREDENTIAL_HELPER=%q\n' "${helper}"
  [[ -z ${token_file} ]] || printf 'export GF_REAPI_CREDENTIAL_HELPER_TOKEN_FILE=%q\n' "${token_file}"
} >"${write}"
SH
chmod +x "${HELPER_BIN}/flywheel-consumer-env"

cat >"${HELPER_BIN}/capture-bazel" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"${GF_BAZEL_CAPTURE_FILE:?missing GF_BAZEL_CAPTURE_FILE}"
SH
chmod +x "${HELPER_BIN}/capture-bazel"

run_case 1 "unset profile fails closed" \
  BAZEL_REMOTE_CACHE="${CACHE}" GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed

run_case 1 "unattached profile refuses endpoint attachment" \
  GF_FLYWHEEL_PROFILE_STATE=unattached BAZEL_REMOTE_CACHE="${CACHE}"

run_case 0 "shared-cache-backed profile verifies" \
  GF_FLYWHEEL_PROFILE_STATE=shared-cache-backed \
  BAZEL_REMOTE_CACHE="${CACHE}" GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed \
  GF_BAZEL_RUNNER_LABELS=tinyland-nix

run_case 1 "shared-cache-backed profile refuses executor mode" \
  GF_FLYWHEEL_PROFILE_STATE=shared-cache-backed \
  BAZEL_REMOTE_CACHE="${CACHE}" BAZEL_REMOTE_EXECUTOR="${EXECUTOR}" \
  GF_BAZEL_SUBSTRATE_MODE=executor-backed GF_BAZEL_REAPI_PROOF_IMAGE_DIGEST=sha256:deadbeef \
  GF_BAZEL_RUNNER_LABELS=tinyland-nix

run_case 0 "local-proof profile verifies bounded port-forward" \
  GF_FLYWHEEL_PROFILE_STATE=local-proof GF_BAZEL_LOCAL_PROOF=port-forward \
  BAZEL_REMOTE_CACHE=grpc://127.0.0.1:19092 GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed

run_case 1 "local-proof profile requires explicit port-forward marker" \
  GF_FLYWHEEL_PROFILE_STATE=local-proof \
  BAZEL_REMOTE_CACHE=grpc://127.0.0.1:19092 GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed

grep -q '^flywheel-enroll\(\s\|:\)' Justfile || { echo "FAIL Justfile missing flywheel-enroll recipe"; fail=$((fail + 1)); }
grep -q '^flywheel-verify:' Justfile || { echo "FAIL Justfile missing flywheel-verify recipe"; fail=$((fail + 1)); }
grep -q 'GF_FLYWHEEL_PROFILE_STATE' scripts/flywheel-doctor.sh || { echo "FAIL doctor does not inspect profile state"; fail=$((fail + 1)); }
grep -q 'common:flywheel-executor --remote_local_fallback=false' .bazelrc.flywheel || { echo "FAIL flywheel-executor config does not disable local fallback"; fail=$((fail + 1)); }
grep -q 'common:flywheel-executor --spawn_strategy=remote' .bazelrc.flywheel || { echo "FAIL flywheel-executor config does not force remote spawn strategy"; fail=$((fail + 1)); }
grep -q -- '--remote_local_fallback=false' scripts/gloriousflywheel-bazel.sh || { echo "FAIL wrapper executor-backed mode does not disable local fallback"; fail=$((fail + 1)); }
grep -q -- '--spawn_strategy=remote' scripts/gloriousflywheel-bazel.sh || { echo "FAIL wrapper executor-backed mode does not force remote spawn strategy"; fail=$((fail + 1)); }
grep -q -- '--remote_instance_name' scripts/gloriousflywheel-bazel.sh || { echo "FAIL wrapper does not forward BAZEL_REMOTE_INSTANCE_NAME"; fail=$((fail + 1)); }
if grep -q 'ask for the Flywheel cache URL' scripts/flywheel-doctor.sh; then
  echo "FAIL doctor still advertises manual cache URL ask instead of fleet profile"
  fail=$((fail + 1))
fi

if env -i PATH="${HELPER_BIN}:${PATH}" \
  BAZEL_BIN="${HELPER_BIN}/capture-bazel" \
  GF_BAZEL_CAPTURE_FILE="${TMP_DIR}/bazel-info.args" \
  GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed \
  BAZEL_REMOTE_CACHE="${CACHE}" \
  BAZEL_REMOTE_INSTANCE_NAME=spoke-example \
  bash scripts/gloriousflywheel-bazel.sh info >/dev/null; then
  grep -q -- '--remote_instance_name=spoke-example' "${TMP_DIR}/bazel-info.args" &&
    { echo "ok   wrapper forwards instance_name for info"; pass=$((pass + 1)); } ||
    { echo "FAIL wrapper info omitted remote_instance_name"; fail=$((fail + 1)); }
else
  echo "FAIL wrapper info invocation failed"
  fail=$((fail + 1))
fi

if env -i PATH="${HELPER_BIN}:${PATH}" \
  BAZEL_BIN="${HELPER_BIN}/capture-bazel" \
  GF_BAZEL_CAPTURE_FILE="${TMP_DIR}/bazel-build.args" \
  GF_BAZEL_SUBSTRATE_MODE=executor-backed \
  BAZEL_REMOTE_CACHE="${EXECUTOR}" \
  BAZEL_REMOTE_EXECUTOR="${EXECUTOR}" \
  BAZEL_REMOTE_INSTANCE_NAME=spoke-example \
  GF_BAZEL_JOBS=4 \
  BAZEL_REMOTE_MAX_CONNECTIONS=4 \
  bash scripts/gloriousflywheel-bazel.sh build //:build >/dev/null; then
  if grep -q -- '--remote_instance_name=spoke-example' "${TMP_DIR}/bazel-build.args" &&
    grep -q -- '--jobs=4' "${TMP_DIR}/bazel-build.args" &&
    grep -q -- '--remote_max_connections=4' "${TMP_DIR}/bazel-build.args"; then
    echo "ok   wrapper forwards instance_name and executor throttles for executor-backed build"
    pass=$((pass + 1))
  else
    echo "FAIL wrapper build omitted remote_instance_name or executor throttles"
    fail=$((fail + 1))
  fi
else
  echo "FAIL wrapper executor-backed build invocation failed"
  fail=$((fail + 1))
fi

if PATH="${HELPER_BIN}:${PATH}" bash scripts/flywheel-enroll.sh \
  shared-cache-backed \
  --cache-endpoint "${CACHE}" \
  --instance-name default \
  --credential-helper bazel-cache.example.internal=/nix/store/example/bin/gf-reapi-credhelper \
  --credential-helper-token-file /run/user/1000/gloriousflywheel/gf-reapi-token.jwt \
  --write "${TMP_DIR}/enrolled.env" >/dev/null; then
  grep -q "export GF_FLYWHEEL_PROFILE_STATE=shared-cache-backed" "${TMP_DIR}/enrolled.env" &&
    grep -q "export BAZEL_REMOTE_CACHE=${CACHE}" "${TMP_DIR}/enrolled.env" &&
    grep -q "export BAZEL_CREDENTIAL_HELPER=bazel-cache.example.internal=/nix/store/example/bin/gf-reapi-credhelper" "${TMP_DIR}/enrolled.env" &&
    grep -q "export GF_REAPI_CREDENTIAL_HELPER_TOKEN_FILE=/run/user/1000/gloriousflywheel/gf-reapi-token.jwt" "${TMP_DIR}/enrolled.env" &&
    { echo "ok   flywheel-enroll preserves shared cache auth material"; pass=$((pass + 1)); } ||
    { echo "FAIL flywheel-enroll shared-cache env missing expected auth material"; fail=$((fail + 1)); }
else
  echo "FAIL flywheel-enroll shared-cache profile failed"
  fail=$((fail + 1))
fi

if PATH="${HELPER_BIN}:${PATH}" bash scripts/flywheel-enroll.sh \
  --profile executor-backed \
  --cache-endpoint "${EXECUTOR}" \
  --executor-endpoint "${EXECUTOR}" \
  --instance-name spoke-example \
  --credential-helper gf-reapi-cell.example.internal=/nix/store/example/bin/gf-reapi-credhelper \
  --credential-helper-token-file /run/user/1000/gloriousflywheel/executor.jwt \
  --write-local-env "${TMP_DIR}/legacy-enrolled.env" >/dev/null; then
  grep -q "export GF_FLYWHEEL_PROFILE_STATE=executor-backed" "${TMP_DIR}/legacy-enrolled.env" &&
    grep -q "export BAZEL_REMOTE_EXECUTOR=${EXECUTOR}" "${TMP_DIR}/legacy-enrolled.env" &&
    grep -q "export BAZEL_REMOTE_INSTANCE_NAME=spoke-example" "${TMP_DIR}/legacy-enrolled.env" &&
    grep -q "export BAZEL_CREDENTIAL_HELPER=gf-reapi-cell.example.internal=/nix/store/example/bin/gf-reapi-credhelper" "${TMP_DIR}/legacy-enrolled.env" &&
    grep -q "export GF_REAPI_CREDENTIAL_HELPER_TOKEN_FILE=/run/user/1000/gloriousflywheel/executor.jwt" "${TMP_DIR}/legacy-enrolled.env" &&
    { echo "ok   flywheel-enroll legacy flags preserve executor auth material"; pass=$((pass + 1)); } ||
    { echo "FAIL flywheel-enroll executor env missing expected auth material"; fail=$((fail + 1)); }
else
  echo "FAIL flywheel-enroll executor profile failed"
  fail=$((fail + 1))
fi

echo
echo "flywheel enrollment contract: ${pass} runtime cases passed, ${fail} failed"
if [[ ${fail} -ne 0 ]]; then
  exit 1
fi
