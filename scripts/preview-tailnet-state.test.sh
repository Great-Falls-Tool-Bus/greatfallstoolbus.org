#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
helper="${1:-${script_dir}/preview-tailnet-state.sh}"
justfile="${2:-${script_dir}/../Justfile}"
passes=0
fail() { printf 'preview-tailnet-state.test: FAIL: %s\n' "$1" >&2; exit 1; }
pass() { passes=$((passes + 1)); printf 'ok %d - %s\n' "$passes" "$1"; }
expect_fail() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then fail "${label}: command unexpectedly succeeded"; fi
    pass "$label"
}
expect_eq() {
    local label="$1" want="$2" got="$3"
    [[ "$got" == "$want" ]] || fail "${label}: want '${want}', got '${got}'"
    pass "$label"
}
assert_exists() {
    local label="$1" path="$2"
    [[ -e "$path" ]] || fail "${label}: missing ${path}"
    pass "$label"
}

if grep -Eq '(^|[[:space:]])(rm|unlink|rmdir|find|xargs)([[:space:]]|$)' "$helper"; then
    fail 'state helper contains a filesystem deletion primitive'
fi
pass 'state helper contains no filesystem deletion primitive'

down_source="$(awk '
    /^preview-tailnet-down:/ { capture=1 }
    capture { print }
    capture && /^# Validation$/ { exit }
' "$justfile")"
[[ -n "$down_source" ]] || fail 'could not locate preview-tailnet-down source'
if grep -Eq 'rm[[:space:]]+-[^[:space:]]*r|find([^[:space:]]|[[:space:]])*-delete|xargs[^\n]*rm' <<<"$down_source"; then
    fail 'preview-tailnet-down contains a recursive deletion primitive'
fi
[[ "$down_source" == *'preview-tailnet-state.sh cleanup "$root_dir" "$state_dir"'* ]] ||
    fail 'preview-tailnet-down no longer delegates state preservation to the custody helper'
pass 'preview-tailnet-down delegates to non-destructive cleanup and contains no recursive delete'

scratch_parent="${TEST_TMPDIR:-${TMPDIR:-/tmp}}"
scratch_parent="$(cd -P -- "$scratch_parent" && pwd -P)"
if [[ -n "${GFTB_EXPECTED_TEST_TMP_ROOT:-}" ]]; then
    expected_test_tmp_root="$(cd -P -- "$GFTB_EXPECTED_TEST_TMP_ROOT" && pwd -P)"
    case "$scratch_parent" in
        "$expected_test_tmp_root" | "$expected_test_tmp_root"/*) ;;
        *) fail "Bazel TEST_TMPDIR escaped the remote recipe's private root: ${scratch_parent}" ;;
    esac
    original_home="$(cd -P -- "${HOME:?HOME is required}" && pwd -P)"
    original_account_home="$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
    original_account_home="$(cd -P -- "$original_account_home" && pwd -P)"
    case "$scratch_parent" in
        "$original_home" | "$original_home"/*) fail 'Bazel TEST_TMPDIR is inside exported HOME' ;;
    esac
    case "$scratch_parent" in
        "$original_account_home" | "$original_account_home"/*) fail 'Bazel TEST_TMPDIR is inside account HOME' ;;
    esac
    pass 'Bazel TEST_TMPDIR is confined to the remote recipe root outside both HOME roots'
fi
test_root="$(mktemp -d "${scratch_parent}/gftb-preview-state-test.XXXXXX")"
chmod 700 "$test_root"
repo_root="${test_root}/repo"
fake_home="${test_root}/home"
base_real="${test_root}/base-real"
base_link="${test_root}/base-link"
insecure_base="${test_root}/insecure-base"
sticky_base="${test_root}/sticky-base"
outside="${test_root}/outside"
mkdir -m 700 "$repo_root" "$fake_home" "$base_real" "$insecure_base" "$sticky_base" "$outside"
chmod 0777 "$insecure_base"
chmod 1777 "$sticky_base"
ln -s "$base_real" "$base_link"
printf 'outside-sentinel\n' >"${outside}/sentinel"
export HOME="$fake_home"
export TMPDIR="$base_link"
uid="$(id -u)"
state="${base_real}/gftb-preview-tailnet"
marker="${state}/.gftb-preview-tailnet-owner-v1"

expect_fail 'refuses uid-owned mode 0777 temporary base' env TMPDIR="$insecure_base" bash "$helper" path "$repo_root"
if [[ "$uid" != 0 ]]; then
    expect_fail 'refuses non-root sticky temporary base' env TMPDIR="$sticky_base" bash "$helper" path "$repo_root"
fi

expect_eq 'canonicalizes temp base before appending fixed child' "$state" "$(bash "$helper" path "$repo_root")"
expect_eq 'creates only the computed state directory' "$state" "$(bash "$helper" prepare "$repo_root")"
case "$(uname -s)" in
    Darwin) state_mode="$(stat -f '%Lp' "$state")" ;;
    *) state_mode="$(stat -c '%a' "$state")" ;;
esac
expect_eq 'state directory is mode 0700' 700 "${state_mode#0}"
canonical_repo="$(cd -P "$repo_root" && pwd -P)"
expected_marker="$(printf 'schema=1\nrepo=%s\nuid=%s' "$canonical_repo" "$uid")"
expect_eq 'marker binds canonical repo path and uid' "$expected_marker" "$(cat "$marker")"

touch "${fake_home}/sentinel"
expect_fail 'refuses filesystem root as cleanup candidate' bash "$helper" cleanup "$repo_root" /
expect_fail 'refuses HOME as cleanup candidate' bash "$helper" cleanup "$repo_root" "$fake_home"
expect_fail 'refuses candidate outside canonical temp base' bash "$helper" cleanup "$repo_root" "$outside"
assert_exists 'HOME sentinel survives rejected candidates' "${fake_home}/sentinel"
assert_exists 'outside sentinel survives rejected candidates' "${outside}/sentinel"

mkdir -m 700 "${fake_home}/tmp"
expect_fail 'refuses temp base inside HOME' env TMPDIR="${fake_home}/tmp" bash "$helper" path "$repo_root"
account_home="$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
expect_fail 'forged HOME cannot hide the account HOME boundary' env HOME="$fake_home" TMPDIR="$account_home" bash "$helper" path "$repo_root"
mkdir -m 700 "${repo_root}/tmp"
expect_fail 'refuses temp base inside repository' env TMPDIR="${repo_root}/tmp" bash "$helper" path "$repo_root"
expect_fail 'refuses filesystem root as temp base' env TMPDIR=/ bash "$helper" path "$repo_root"

chmod 755 "$state"
expect_fail 'refuses state directory not mode 0700' bash "$helper" validate "$repo_root" "$state"
chmod 700 "$state"
chmod 0644 "$marker"
expect_fail 'refuses marker mode 0644' bash "$helper" validate "$repo_root" "$state"
chmod 0600 "$marker"
printf 'schema=1\nrepo=%s\nuid=not-current\n' "$canonical_repo" >"$marker"
expect_fail 'refuses marker not bound to invoking uid' bash "$helper" validate "$repo_root" "$state"
printf '%s\n' "$expected_marker" >"$marker"
chmod 600 "$marker"

rm -f -- "$marker"
ln -s "${outside}/sentinel" "$marker"
expect_fail 'refuses symlinked custody marker' bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'outside sentinel survives marker-symlink rejection' "${outside}/sentinel"
rm -f -- "$marker"
printf '%s\n' "$expected_marker" >"$marker"
chmod 600 "$marker"

ln -s "$outside" "${state}/pgdata"
expect_fail 'refuses symlinked pgdata child' bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'outside sentinel survives pgdata-symlink rejection' "${outside}/sentinel"
rm -f -- "${state}/pgdata"

printf 'unexpected\n' >"${state}/unexpected"
expect_fail 'refuses unknown top-level child' bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'outside sentinel survives unknown-child rejection' "${outside}/sentinel"
rm -f -- "${state}/unexpected"

ln -s "${outside}/sentinel" "${state}/web.log"
expect_fail 'refuses symlinked fixed child' bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'outside sentinel survives child-symlink rejection' "${outside}/sentinel"
rm -f -- "${state}/web.log"

mkdir -m 700 "${state}/pgdata"
printf 'nested\n' >"${state}/pgdata/nested"
for child in postgres.log web.log worker.log web.pid worker.pid; do printf 'known\n' >"${state}/${child}"; done
bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'cleanup preserves the private state directory' "$state"
assert_exists 'cleanup preserves custody marker' "$marker"
assert_exists 'cleanup preserves pgdata directory' "${state}/pgdata"
assert_exists 'cleanup preserves nested pgdata sentinel' "${state}/pgdata/nested"
for child in postgres.log web.log worker.log web.pid worker.pid; do
    assert_exists "cleanup preserves ${child}" "${state}/${child}"
done
assert_exists 'outside sentinel survives non-destructive cleanup' "${outside}/sentinel"

for child in postgres.log web.log worker.log web.pid worker.pid; do rm -f -- "${state}/${child}"; done
rm -f -- "${state}/pgdata/nested" "$marker"
rmdir -- "${state}/pgdata" "$state"
ln -s "$outside" "$state"
expect_fail 'refuses replacement symlink in place of state directory' bash "$helper" cleanup "$repo_root" "$state"
assert_exists 'outside sentinel survives state replacement' "${outside}/sentinel"
rm -f -- "$state"

rm -f -- "${fake_home}/sentinel" "${outside}/sentinel" "$base_link"
rmdir -- "${fake_home}/tmp" "${repo_root}/tmp" "$outside" "$sticky_base" "$insecure_base" "$base_real" "$fake_home" "$repo_root" "$test_root"
printf 'preview-tailnet-state.test: %d checks passed\n' "$passes"
