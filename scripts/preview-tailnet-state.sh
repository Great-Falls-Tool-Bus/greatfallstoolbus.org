#!/usr/bin/env bash
set -euo pipefail

fail() {
    printf 'preview-tailnet-state: %s\n' "$1" >&2
    exit 70
}

canonical_dir() {
    local input="${1:-}" label="${2:-path}" physical
    [[ -n "$input" && "$input" == /* && "$input" != *$'\n'* ]] || fail "${label} must be one absolute path"
    [[ -d "$input" ]] || fail "${label} is not an existing directory: ${input}"
    physical="$(cd -P -- "$input" 2>/dev/null && pwd -P)" || fail "cannot resolve ${label}: ${input}"
    [[ -n "$physical" && "$physical" == /* && "$physical" != *$'\n'* ]] || fail "${label} did not resolve safely"
    printf '%s\n' "$physical"
}

path_is_within() {
    local candidate="$1" parent="$2"
    [[ "$parent" == / ]] && return 0
    case "$candidate" in
        "$parent" | "$parent"/*) return 0 ;;
        *) return 1 ;;
    esac
}

owner_mode() {
    case "$(uname -s)" in
        Darwin) stat -f '%u %Lp' "$1" ;;
        *) stat -c '%u %a' "$1" ;;
    esac
}

marker_body() {
    printf 'schema=1\nrepo=%s\nuid=%s' "$1" "$2"
}

state_path() {
    local root_real home_real account_home_raw account_home_real base_real uid facts owner mode mode_value state
    root_real="$(canonical_dir "$1" 'repository root')"
    [[ -n "${HOME:-}" ]] || fail 'HOME is unset; cannot prove state is outside it'
    home_real="$(canonical_dir "$HOME" HOME)"
    account_home_raw="$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')" || fail 'cannot resolve account HOME'
    account_home_real="$(canonical_dir "$account_home_raw" 'account HOME')"
    base_real="$(canonical_dir "${TMPDIR:-/tmp}" 'temporary base')"
    uid="$(id -u)" || fail 'cannot resolve invoking uid'
    [[ "$uid" =~ ^[0-9]+$ ]] || fail 'invoking uid is not numeric'

    [[ "$base_real" != / ]] || fail 'temporary base resolved to filesystem root'
    ! path_is_within "$base_real" "$home_real" || fail "temporary base is HOME or inside it: ${base_real}"
    ! path_is_within "$base_real" "$account_home_real" || fail "temporary base is account HOME or inside it: ${base_real}"
    ! path_is_within "$base_real" "$root_real" || fail "temporary base is the repository or inside it: ${base_real}"
    [[ -w "$base_real" && -x "$base_real" ]] || fail "temporary base is not writable/searchable: ${base_real}"

    facts="$(owner_mode "$base_real")" || fail "cannot inspect temporary-base custody: ${base_real}"
    read -r owner mode <<<"$facts"
    mode="${mode#0}"
    if [[ "$owner" != "$uid" ]]; then
        [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "temporary-base mode is not octal: ${mode}"
        mode_value=$((8#${mode}))
        (( (mode_value & 01000) != 0 )) || fail "temporary base is neither uid-owned nor sticky: ${base_real}"
    fi

    state="${base_real}/gftb-preview-tailnet"
    [[ -n "$state" && "$state" != / && "$state" != "$home_real" && "$state" != "$root_real" ]] || fail 'state path crossed a protected root'
    [[ -n "$state" && "$state" != / && "$state" != "$home_real" && "$state" != "$account_home_real" && "$state" != "$root_real" ]] || fail 'state path crossed a protected root'
    [[ "${state%/*}" == "$base_real" ]] || fail 'state path escaped the canonical temporary base'
    printf '%s\n' "$state"
}

validate_children() {
    local state="$1" child name
    shopt -s nullglob dotglob
    for child in "$state"/*; do
        name="${child##*/}"
        [[ ! -L "$child" ]] || fail "state child is a symlink: ${name}"
        case "$name" in
            .gftb-preview-tailnet-owner-v1 | postgres.log | web.log | worker.log | web.pid | worker.pid)
                [[ -f "$child" ]] || fail "state child is not a regular file: ${name}"
                ;;
            pgdata)
                [[ -d "$child" ]] || fail 'pgdata is not a directory'
                ;;
            *) fail "unexpected top-level state child: ${name}" ;;
        esac
    done
}

validate_state() {
    local root_real uid expected state state_real facts owner mode marker marker_facts marker_owner marker_mode want got
    root_real="$(canonical_dir "$1" 'repository root')"
    uid="$(id -u)" || fail 'cannot resolve invoking uid'
    expected="$(state_path "$root_real")"
    state="${2:-}"

    [[ -n "$state" && "$state" == "$expected" ]] || fail "candidate is not the exact state path: ${state:-<empty>}"
    [[ ! -L "$state" ]] || fail "state directory is a symlink: ${state}"
    [[ -d "$state" ]] || fail "state directory is absent or not a directory: ${state}"
    state_real="$(cd -P -- "$state" 2>/dev/null && pwd -P)" || fail "cannot resolve state directory: ${state}"
    [[ "$state_real" == "$expected" && "${state_real%/*}" == "${expected%/*}" ]] || fail 'state directory escaped the canonical temp base'

    facts="$(owner_mode "$state")" || fail 'cannot inspect state-directory custody'
    read -r owner mode <<<"$facts"
    mode="${mode#0}"
    [[ "$owner" == "$uid" && "$mode" == 700 ]] || fail "state directory must be uid ${uid}, mode 0700 (got uid ${owner}, mode ${mode})"

    marker="${state}/.gftb-preview-tailnet-owner-v1"
    [[ ! -L "$marker" && -f "$marker" ]] || fail 'custody marker is missing, non-regular, or a symlink'
    marker_facts="$(owner_mode "$marker")" || fail 'cannot inspect custody-marker metadata'
    read -r marker_owner marker_mode <<<"$marker_facts"
    marker_mode="${marker_mode#0}"
    [[ "$marker_owner" == "$uid" && "$marker_mode" == 600 ]] || fail "marker must be uid ${uid}, mode 0600 (got uid ${marker_owner}, mode ${marker_mode})"
    want="$(marker_body "$root_real" "$uid")"
    got="$(cat "$marker")" || fail 'cannot read custody marker'
    [[ "$got" == "$want" ]] || fail 'custody marker does not bind this repository path and uid'
    validate_children "$state"
}

prepare_state() {
    local root_real uid state marker body
    root_real="$(canonical_dir "$1" 'repository root')"
    uid="$(id -u)" || fail 'cannot resolve invoking uid'
    state="$(state_path "$root_real")"
    marker="${state}/.gftb-preview-tailnet-owner-v1"

    [[ ! -L "$state" ]] || fail "state directory is a symlink: ${state}"
    if [[ ! -e "$state" ]]; then
        body="$(marker_body "$root_real" "$uid")"
        (
            umask 077
            mkdir -- "$state" &&
                chmod 700 "$state" &&
                printf '%s\n' "$body" >"$marker" &&
                chmod 600 "$marker"
        ) || fail "cannot create private marked state directory: ${state}"
    fi
    validate_state "$root_real" "$state"
    printf '%s\n' "$state"
}

cleanup_state() {
    local root_real expected state pgdata name child marker
    root_real="$(canonical_dir "$1" 'repository root')"
    expected="$(state_path "$root_real")"
    state="${2:-}"
    [[ -n "$state" && "$state" == "$expected" ]] || fail "cleanup candidate is not the exact state path: ${state:-<empty>}"
    [[ -e "$state" || -L "$state" ]] || return 0
    validate_state "$root_real" "$state"

    pgdata="${state}/pgdata"
    [[ "$pgdata" == "${expected}/pgdata" ]] || fail 'pgdata target escaped the exact state directory'
    if [[ -e "$pgdata" || -L "$pgdata" ]]; then
        [[ ! -L "$pgdata" && -d "$pgdata" ]] || fail 'pgdata target is not a plain directory'
        rm -rf -- "$pgdata" || fail 'cannot remove validated pgdata child'
    fi

    for name in postgres.log web.log worker.log web.pid worker.pid; do
        child="${state}/${name}"
        if [[ -e "$child" || -L "$child" ]]; then
            [[ ! -L "$child" && -f "$child" ]] || fail "fixed child changed type: ${name}"
            rm -f -- "$child" || fail "cannot remove fixed child: ${name}"
        fi
    done

    marker="${state}/.gftb-preview-tailnet-owner-v1"
    [[ ! -L "$marker" && -f "$marker" ]] || fail 'custody marker changed before final cleanup'
    rm -f -- "$marker" || fail 'cannot remove custody marker'
    rmdir -- "$state" || fail 'state directory was not empty after exact-child cleanup'
}

command="${1:-}"
case "$command" in
    path)
        [[ "$#" -eq 2 ]] || fail 'usage: preview-tailnet-state.sh path REPO_ROOT'
        state_path "$2"
        ;;
    prepare)
        [[ "$#" -eq 2 ]] || fail 'usage: preview-tailnet-state.sh prepare REPO_ROOT'
        prepare_state "$2"
        ;;
    validate)
        [[ "$#" -eq 3 ]] || fail 'usage: preview-tailnet-state.sh validate REPO_ROOT STATE_DIR'
        validate_state "$2" "$3"
        ;;
    cleanup)
        [[ "$#" -eq 3 ]] || fail 'usage: preview-tailnet-state.sh cleanup REPO_ROOT STATE_DIR'
        cleanup_state "$2" "$3"
        ;;
    *) fail 'usage: preview-tailnet-state.sh {path|prepare|validate|cleanup} ...' ;;
esac
