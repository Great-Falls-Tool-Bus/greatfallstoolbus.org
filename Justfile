# greatfallstoolbus.org — app-stateful SvelteKit product task runner
# Prerequisites: just, direnv (loads Nix devShell), Nix with flakes
# Quick Start: direnv allow && just setup && just dev
#
# See AGENTS.md.

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()

# List available commands
_default:
    @just --list --unsorted

# ─────────────────────────────────────────────
# Development
# ─────────────────────────────────────────────

# Install third-party dependencies, then materialize the Bazel-only house packages.
setup:
    cd {{ root }} && pnpm install --frozen-lockfile
    @just _house-hydrate
    @echo "Setup complete. Run 'just dev' to start."

# TIN-2881: materialize the six first-party Bzlmod :pkg targets into the
# Node-compatible layout required by pnpm/Vite/check and the Bazel product build.
# package.json and pnpm-lock.yaml cannot supply these packages. The stamp binds
# the complete checked-in resolution carrier plus the exact bytes of all six
# current Bazel outputs. Existing or stale package paths are refused; this
# recipe never recursively deletes a package tree.
_house-hydrate:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    repo_root="$(git rev-parse --show-toplevel)"
    physical_root="$(pwd -P)"
    physical_repo_root="$(cd "$repo_root" && pwd -P)"
    if [[ "$physical_root" != "$physical_repo_root" ]] || [[ "$PWD" != "{{ root }}" ]]; then
      echo "[house-hydrate] refusing outside the exact repository root." >&2
      exit 1
    fi

    node_modules_root="$PWD/node_modules"
    package_root="$node_modules_root/@tummycrypt"
    if [[ ! -d "$node_modules_root" ]] || [[ -L "$node_modules_root" ]]; then
      echo "[house-hydrate] node_modules must be a real directory; run 'just setup' from a clean tree." >&2
      exit 1
    fi
    if [[ "$(cd "$node_modules_root" && pwd -P)" != "$physical_root/node_modules" ]]; then
      echo "[house-hydrate] node_modules escaped the repository." >&2
      exit 1
    fi

    pkgs=(tinyland-auth tinyland-auth-pg tinyland-color-utils tinyvectors vite-plugin-a11y vite-plugin-skeleton-colors)
    graph_inputs=(.bazelrc MODULE.bazel MODULE.bazel.lock BUILD.bazel)
    for graph_input in "${graph_inputs[@]}"; do
      [[ -f "$graph_input" && ! -L "$graph_input" ]] || {
        echo "[house-hydrate] missing or symlinked graph input: $graph_input" >&2
        exit 1
      }
    done

    graph_key_now() {
      git hash-object "${graph_inputs[@]}" | tr '\n' ':'
    }

    # Hash every dereferenced file by stable relative path and exact bytes. The
    # Bazel :pkg outputs may themselves be symlink forests; _house-hydrate copies
    # with -L, so source and target manifests deliberately compare dereferenced
    # content rather than symlink metadata.
    tree_manifest() {
      local directory="$1"
      (
        cd "$directory"
        find -L . -type f -print0 |
          LC_ALL=C sort -z |
          while IFS= read -r -d '' file; do
            printf '%s\0' "${file#./}"
            git -C "$physical_root" hash-object --no-filters "$directory/$file"
          done
      ) | git -C "$physical_root" hash-object --stdin
    }

    package_set_manifest() {
      local base="$1"
      local manifest_lines=""
      local p package_path package_digest
      for p in "${pkgs[@]}"; do
        package_path="$base/$p"
        if [[ ! -d "$package_path" ]] || [[ ! -f "$package_path/package.json" ]]; then
          echo "[house-hydrate] package set is incomplete: $package_path" >&2
          return 1
        fi
        package_digest="$(tree_manifest "$package_path")"
        manifest_lines+="$p:$package_digest"$'\n'
      done
      printf '%s' "$manifest_lines" | git -C "$physical_root" hash-object --stdin
    }

    target_package_set_manifest() {
      local p target
      for p in "${pkgs[@]}"; do
        target="$package_root/$p"
        if [[ ! -d "$target" ]] || [[ -L "$target" ]] ||
           [[ -n "$(find "$target" -type l -print -quit)" ]]; then
          echo "[house-hydrate] target package is missing, symlinked, or contains a symlink: $target" >&2
          return 1
        fi
      done
      package_set_manifest "$package_root"
    }

    package_root_entries_exact() {
      local entry entry_name
      local entries
      shopt -s nullglob dotglob
      entries=("$package_root"/*)
      shopt -u nullglob dotglob
      for entry in "${entries[@]}"; do
        entry_name="${entry##*/}"
        case "$entry_name" in
          .gftb-bazel-hydrated|tinyland-auth|tinyland-auth-pg|tinyland-color-utils|tinyvectors|vite-plugin-a11y|vite-plugin-skeleton-colors) ;;
          *)
            echo "[house-hydrate] refusing unexpected first-party path: $entry" >&2
            return 1
            ;;
        esac
      done
    }

    package_root_was_present=0
    if [[ -e "$package_root" || -L "$package_root" ]]; then
      if [[ ! -d "$package_root" ]] || [[ -L "$package_root" ]] ||
         [[ "$(cd "$package_root" && pwd -P)" != "$physical_root/node_modules/@tummycrypt" ]]; then
        echo "[house-hydrate] refusing an unmanaged or escaped package root: $package_root" >&2
        exit 1
      fi
      package_root_was_present=1
    fi

    graph_key_before="$(graph_key_now)"
    # Honor a policy-supplied Bazel root and otherwise use the ambient one. A
    # second private root duplicates the install/output bases and breaks seats
    # whose policy already fixes the root.
    root_args=()
    if [[ -n "${BAZEL_OUTPUT_USER_ROOT:-}" ]]; then
      root_args+=("--output_user_root=${BAZEL_OUTPUT_USER_ROOT}")
    fi
    targets=()
    for p in "${pkgs[@]}"; do targets+=("//:node_modules/@tummycrypt/$p"); done
    bazelisk ${root_args[@]+"${root_args[@]}"} build "${targets[@]}"

    # A long Bazel build must not create a stale attestation: re-read all four
    # graph inputs before trusting any output or publishing the stamp.
    graph_key_after="$(graph_key_now)"
    if [[ "$graph_key_after" != "$graph_key_before" ]]; then
      echo "[house-hydrate] graph inputs changed during the Bazel build; refusing stale outputs." >&2
      exit 1
    fi

    if [[ ! -d "$node_modules_root" ]] || [[ -L "$node_modules_root" ]] ||
       [[ "$(cd "$node_modules_root" && pwd -P)" != "$physical_root/node_modules" ]]; then
      echo "[house-hydrate] node_modules custody changed during the Bazel build." >&2
      exit 1
    fi

    source_root="$PWD/bazel-bin/node_modules/@tummycrypt"
    source_manifest_before="$(package_set_manifest "$source_root")"

    if [[ "$package_root_was_present" == "1" ]]; then
      if [[ ! -d "$package_root" ]] || [[ -L "$package_root" ]] ||
         [[ "$(cd "$package_root" && pwd -P)" != "$physical_root/node_modules/@tummycrypt" ]]; then
        echo "[house-hydrate] package-root custody changed during the Bazel build." >&2
        exit 1
      fi
      package_root_entries_exact
      target_manifest="$(target_package_set_manifest)"
      source_manifest_after="$(package_set_manifest "$source_root")"
      graph_key_final="$(graph_key_now)"
      stamp="$package_root/.gftb-bazel-hydrated"
      stamp_payload="$(printf 'version=2\ngraph=%s\npackages=%s' "$graph_key_final" "$source_manifest_after")"

      if [[ "$graph_key_final" == "$graph_key_before" ]] &&
         [[ "$source_manifest_before" == "$source_manifest_after" ]] &&
         [[ "$target_manifest" == "$source_manifest_after" ]] &&
         [[ -f "$stamp" ]] && [[ ! -L "$stamp" ]] &&
         [[ "$(cat "$stamp")" == "$stamp_payload" ]]; then
        echo "[house-hydrate] six Bazel-linked @tummycrypt/* packages match the graph and exact output bytes."
        exit 0
      fi
      echo "[house-hydrate] refusing stale, modified, or unmanaged first-party paths; no recursive cleanup is permitted." >&2
      echo "[house-hydrate] node_modules is disposable: run 'just clean-all', then 'just setup'." >&2
      exit 1
    fi

    if [[ -e "$package_root" || -L "$package_root" ]]; then
      echo "[house-hydrate] package root appeared during the Bazel build; refusing." >&2
      exit 1
    fi
    mkdir -- "$package_root"
    if [[ -L "$package_root" ]] ||
       [[ "$(cd "$package_root" && pwd -P)" != "$physical_root/node_modules/@tummycrypt" ]]; then
      echo "[house-hydrate] package root escaped during creation." >&2
      exit 1
    fi

    for p in "${pkgs[@]}"; do
      case "$p" in
        tinyland-auth|tinyland-auth-pg|tinyland-color-utils|tinyvectors|vite-plugin-a11y|vite-plugin-skeleton-colors) ;;
        *)
          echo "[house-hydrate] refusing non-allowlisted package name: $p" >&2
          exit 1
          ;;
      esac
      source_path="$source_root/$p"
      target="$package_root/$p"
      [[ -d "$source_path" ]] || {
        echo "[house-hydrate] Bazel package output missing: $source_path" >&2
        exit 1
      }
      if [[ -e "$target" || -L "$target" ]]; then
        echo "[house-hydrate] package target appeared during materialization: $target" >&2
        exit 1
      fi
      mkdir -- "$target"
      if [[ -L "$target" ]] ||
         [[ "$(cd "$target" && pwd -P)" != "$physical_root/node_modules/@tummycrypt/$p" ]]; then
        echo "[house-hydrate] package target escaped during creation: $target" >&2
        exit 1
      fi
      cp -RL "$source_path/." "$target/"
      chmod -R u+w "$target"
      [[ -f "$target/package.json" ]] || {
        echo "[house-hydrate] materialized package lacks package.json: $target" >&2
        exit 1
      }
    done

    package_root_entries_exact
    target_manifest="$(target_package_set_manifest)"
    source_manifest_after="$(package_set_manifest "$source_root")"
    graph_key_final="$(graph_key_now)"
    if [[ "$graph_key_final" != "$graph_key_before" ]] ||
       [[ "$source_manifest_before" != "$source_manifest_after" ]] ||
       [[ "$target_manifest" != "$source_manifest_after" ]]; then
      echo "[house-hydrate] graph or package bytes changed during materialization; refusing to publish a stamp." >&2
      exit 1
    fi

    stamp="$package_root/.gftb-bazel-hydrated"
    stamp_payload="$(printf 'version=2\ngraph=%s\npackages=%s' "$graph_key_final" "$source_manifest_after")"
    stamp_tmp="$(mktemp "$package_root/.gftb-bazel-hydrated.XXXXXXXX")"
    printf '%s\n' "$stamp_payload" > "$stamp_tmp"
    mv "$stamp_tmp" "$stamp"
    echo "[house-hydrate] graph-linked and byte-attested ${#pkgs[@]} @tummycrypt/* packages into node_modules."

# Start the Vite dev server
dev: _house-hydrate
    cd {{ root }} && pnpm run dev

# Start the dev server and open browser
dev-open: _house-hydrate
    cd {{ root }} && pnpm run dev -- --open

# ─────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────

# Production adapter-node build (build/index.js). This is the same product
# shape Bazel exports through v4 in `//:deployment_bundle`.
build: _house-hydrate _optimize-images-if-photos
    cd {{ root }} && pnpm run build

# Chain optimize-images into the build path only when there is something to
# process. No-op safe with zero photos so fresh spokes build clean.
_optimize-images-if-photos:
    cd {{ root }} && if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then \
        node scripts/optimize-images.js; \
    else \
        echo "No static/photos assets; keeping committed image-manifest fallback."; \
    fi

# Clean then build
rebuild: clean build

# Preview the built site
preview: build
    cd {{ root }} && pnpm run preview

# Preview without rebuilding
preview-only: _house-hydrate
    cd {{ root }} && pnpm run preview

# Remove build artifacts
clean:
    rm -rf {{ root }}/build {{ root }}/.svelte-kit

# Deep clean including node_modules
clean-all: clean
    rm -rf {{ root }}/node_modules


# ─────────────────────────────────────────────
# Database (Member v0; TIN-3817 slice S1)
# ─────────────────────────────────────────────
# Migrations are GENERATED into the repo and applied by a first-party migrator.
# `drizzle-kit push` is forbidden by TIN-3817 and `drizzle-kit migrate` is
# unused, because it takes no advisory lock and does not fail closed on a
# changed historical hash — both of which spec §6 requires. The applier is
# src/lib/server/db/migrate.ts, and it is the same code the image runs at
# /bin/migrator.
#
# No credential appears in any recipe below. DATABASE_URL is a runtime NAME
# supplied by great-falls-tool-bus-infra; this repository is public.

# Regenerate the checked-in migration SQL and its source-level hash manifest.
db-generate: _house-hydrate
    cd {{ root }} && pnpm exec drizzle-kit generate
    cd {{ root }} && pnpm exec tsx src/lib/server/db/ledger-manifest.ts write drizzle

# Drift guard: regenerate, refuse if the tree moved, verify hashes, ban `push`.
db-check: db-generate
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}

    # 1. The generated SQL is IN THE CHANGE UNDER REVIEW. If regenerating
    #    modified a tracked file or produced an untracked one, the schema and the
    #    migrations had drifted apart and the migration was never reviewed.
    #
    #    Staged-but-uncommitted counts as reviewed: `git diff` compares the tree
    #    against the index, so `git add`ing a freshly generated migration is the
    #    documented way to satisfy this. `git status --porcelain` would instead
    #    report every staged addition as drift and fail on the very commit that
    #    introduces the migrations.
    untracked="$(git ls-files --others --exclude-standard -- drizzle)"
    if ! git diff --quiet -- drizzle || [ -n "$untracked" ]; then
        echo "db-check: FAIL — drizzle/ changed under just db-generate:" >&2
        git --no-pager diff --stat -- drizzle >&2 || true
        [ -n "$untracked" ] && printf '  untracked: %s\n' $untracked >&2
        echo "  Stage the regenerated migration (git add drizzle), or revert the schema change." >&2
        exit 1
    fi

    # 2. drizzle-kit's own journal/snapshot consistency check.
    pnpm exec drizzle-kit check

    # 3. Source-level half of the immutable hash ledger: an edit to an
    #    already-committed migration fails HERE, in review, rather than at 03:00
    #    in a pre-rollout Job.
    pnpm exec tsx src/lib/server/db/ledger-manifest.ts verify drizzle

    # 4. `push` is banned (TIN-3817). Comments are stripped first so the prose
    #    explaining the ban is not mistaken for the ban being violated.
    if { sed 's/#.*//' Justfile; jq -r '.scripts // {} | to_entries[] | .value' package.json; } \
        | grep -qE 'drizzle-kit[[:space:]]+push|drizzle[[:space:]]+push'; then
        echo "db-check: FAIL — a recipe or script reaches for drizzle-kit's 'push'." >&2
        echo "  TIN-3817 forbids it: it mutates a live database with no ledger entry." >&2
        exit 1
    fi

    echo "db-check: OK — generated SQL committed, hashes match, push absent."

# Apply the checked-in migrations against $DATABASE_URL (the real migrator).
db-migrate *args: _house-hydrate
    cd {{ root }} && pnpm exec tsx src/lib/server/db/migrate.ts {{ args }}

# Bundle the migrator as one process payload. The image also carries the frozen
# runtime node_modules closure for adapter-node, but this standalone entrypoint
# keeps pg inlined so its execution does not depend on Node resolution layout.
# The createRequire banner is required because pg is CommonJS and reaches node
# builtins through require(), which bare ESM output cannot do.
db-migrator-bundle: _house-hydrate
    cd {{ root }} && pnpm exec esbuild src/lib/server/db/migrate.ts \
        --bundle --platform=node --format=esm --target=node24 \
        --outfile=build/migrator.mjs \
        --external:pg-native --external:cloudflare:sockets \
        --tsconfig-raw='{}' \
        --banner:js="import { createRequire as __gftbCreateRequire } from 'node:module'; const require = __gftbCreateRequire(import.meta.url);"
    @echo "wrote build/migrator.mjs (the /bin/migrator payload)"

# Bundle the outbox worker for the platform image (TIN-3817 S3): one file, no
# node_modules — same contract as db-migrator-bundle, same createRequire banner
# (pg is CommonJS), with drizzle-orm inlined alongside it.
worker-bundle: _house-hydrate
    cd {{ root }} && pnpm exec esbuild src/lib/server/worker.ts \
        --bundle --platform=node --format=esm --target=node24 \
        --outfile=build/worker.mjs \
        --external:pg-native --external:cloudflare:sockets \
        '--alias:$lib=./src/lib' \
        --tsconfig-raw='{}' \
        --banner:js="import { createRequire as __gftbCreateRequire } from 'node:module'; const require = __gftbCreateRequire(import.meta.url);"
    @echo "wrote build/worker.mjs (the /bin/worker payload)"

# Developer mirror for the standalone payloads that //:migrator_bundle and
# //:worker_bundle produce inside //:deployment_bundle.
platform-bundles-check: db-migrator-bundle worker-bundle
    @echo "platform bundles OK: migrator, worker"

# PostgreSQL suite: RLS, FORCE, advisory lock, ledger drift, runtime-role grants.
#
# Prefers a postgres:16.15 testcontainer, which is the exact version TIN-3817
# acceptance row 1 narrows CNPG to. Falls back to an already-running server when
# GFTB_TEST_PG_SUPERUSER_DSN names one — a NAME, supplied by the operator; the
# value never enters this repository. That fallback exists because this org's
# ARC pool advertises only `tinyland-nix` and has no dind runner, so a
# container-only suite would never execute anywhere. It proves the SQL, the
# policies, and the lock; it does NOT prove the 16.15 pin.
#
# FAILS CLOSED when neither is available. The daemon probe is
# `<runtime> info` rather than `command -v`, because the docker CLI is present
# on the operator's macOS host while the daemon is not running.
test-integration *args: _house-hydrate
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}

    if [ -n "${GFTB_TEST_PG_SUPERUSER_DSN:-}" ]; then
        echo "test-integration: using the server named by GFTB_TEST_PG_SUPERUSER_DSN"
        echo "  (a throwaway database per fixture; the postgres:16.15 pin is NOT proved by this path)"
        exec pnpm exec vitest run --config vitest.integration.config.ts {{ args }}
    fi

    runtime=""
    for candidate in docker podman; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" info >/dev/null 2>&1; then
            runtime="$candidate"; break
        fi
    done
    if [ -z "$runtime" ]; then
        echo "test-integration: FAIL — no responding docker or podman daemon and GFTB_TEST_PG_SUPERUSER_DSN is unset." >&2
        exit 1
    fi
    echo "test-integration: using ${runtime} + postgres:16.15"
    pnpm exec vitest run --config vitest.integration.config.ts {{ args }}

# One in-process, assertion-bearing Member v0 launch rehearsal. Bazel target
# //:first_membership_rehearsal_test is manual/local/no-cache and never
# Flywheel/RBE eligible. Unlike the general integration suite, this proof
# FAILS when PostgreSQL is unavailable: exit zero means it actually ran.
rehearsal-first-membership:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    if [ -z "${GFTB_TEST_PG_SUPERUSER_DSN:-}" ]; then
        runtime=""
        for candidate in docker podman; do
            if command -v "$candidate" >/dev/null 2>&1 && "$candidate" info >/dev/null 2>&1; then
                runtime="$candidate"; break
            fi
        done
        if [ -z "$runtime" ]; then
            echo "rehearsal-first-membership: ERROR — no responding docker or podman daemon, and" >&2
            echo "  GFTB_TEST_PG_SUPERUSER_DSN is unset. This proof did not run." >&2
            echo "  Re-run with a container runtime, or point GFTB_TEST_PG_SUPERUSER_DSN" >&2
            echo "  at a PostgreSQL 16 superuser connection." >&2
            exit 1
        fi
    fi
    bazel_args=(
        test
        //:first_membership_rehearsal_test
        --test_output=streamed
        --nocache_test_results
    )
    for env_name in GFTB_TEST_PG_SUPERUSER_DSN DOCKER_HOST TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE TESTCONTAINERS_HOST_OVERRIDE; do
        if [ -n "${!env_name:-}" ]; then
            bazel_args+=("--test_env=${env_name}")
        fi
    done
    bazelisk "${bazel_args[@]}"

# ─────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────

# svelte-check + tsc (delegates to package.json `check`)
typecheck: _house-hydrate
    cd {{ root }} && pnpm run check

# ESLint flat config across the repo
lint: _house-hydrate
    cd {{ root }} && pnpm run lint

# Prettier write
format: _house-hydrate
    cd {{ root }} && pnpm run format

# Prettier check (no writes)
format-check: _house-hydrate
    cd {{ root }} && pnpm run format:check

# Gitleaks scan of working tree files
secrets-scan-dir:
    cd {{ root }} && gitleaks dir --config .gitleaks.toml --redact --verbose .

# Gitleaks scan of git history
secrets-scan:
    cd {{ root }} && gitleaks git --config .gitleaks.toml --redact --verbose .

# Public-safe: scan the tracked tree for leaked internal cluster endpoints/hostnames
# (catches what gitleaks' token-shape rules miss; also asserts tofu/ slug-correctness)
scan-endpoints:
    cd {{ root }} && bash scripts/scan-internal-endpoints.sh

# ─────────────────────────────────────────────
# Consent / leak scan (ported from gftb-site, TIN-ungrounded: durable fix
# named by PR #193's R2 delta-verify after the PR #190/#187 consent
# incidents; see scripts/lib/leak-scan.mjs's header for the full citation).
# Two thin runners share the ONE rules implementation in
# scripts/lib/leak-scan.mjs — see that file and scripts/check-tracked-tree.mjs
# for what is and is not scanned, and why.
# ─────────────────────────────────────────────

# Scan an already-materialized build directory (default `build/`) for secrets,
# kubeconfig fragments, cluster hostnames, private names, and unreviewed
# outbound hosts/mailboxes. FAILS CLOSED on a missing/empty directory or a
# file extension the scanner has no verdict for — see
# scripts/check-build-output.mjs. Set GFTB_LEAK_SCAN_DENY (never committed) to
# add real private literals an operator wants enforced without ever appearing
# in this repository.
leak-scan build_dir="build":
    cd {{ root }} && node scripts/check-build-output.mjs {{ build_dir }}

# Build first, then scan the FRESH artefact — never trust a stale build/ left
# on disk from an earlier run. This is the recipe `just check` calls.
leak-scan-build: build
    cd {{ root }} && just leak-scan build

# Same rules, scoped to this repo's published-PROSE surface (docs/, static/,
# and the top-level README/AGENTS/CLAUDE/NOTICE/LICENSE files) rather than a
# build artefact. NOT a gftb-site straight port — that repo only ever scans
# build/ output; this repo is an app-stateful-spoke where most of src/** never
# reaches a client bundle, yet every tracked file is still visible on the
# public GitHub repo regardless of whether SvelteKit ever routes it. See
# scripts/check-tracked-tree.mjs's header for the full scoping rationale
# (including why src/** application source is deliberately out of scope).
leak-scan-tree:
    cd {{ root }} && node scripts/check-tracked-tree.mjs

# Narrow identity/consent subset (private-personal-name, private-list-archive,
# the mailbox allowlist check) over src/** application source and its test
# fixtures. NOT the full rule set — that produces ~70 findings, nearly all
# fixture noise (measured; see scripts/leak-scan-src.mjs's header). This is
# the recipe that closes the historical gap `leak-scan-tree` alone leaves:
# 3 of this repo's 5 consent redaction commits lived in src/**.
leak-scan-src:
    cd {{ root }} && node scripts/leak-scan-src.mjs

# Run Vitest unit tests
test-unit: _house-hydrate
    cd {{ root }} && pnpm run test:unit

# [OPERATOR, local-only] Regenerate src/lib/naming-consent.hashes.json from
# ~/.gftb/naming-consent.plain, keyed by ~/.gftb/naming-consent.key (created
# automatically, mode 0600, on first run) — neither file is ever committed
# or lives inside any repo. See scripts/generate-naming-consent-hashes.mjs
# for the format and the security rationale, and
# docs/runbooks/discuss-to-svx-pipeline.md for the full design this backs.
naming-consent-hashes: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/generate-naming-consent-hashes.mjs

# [OPERATOR, local-only] Drift gate: recomputes the committed hash list from
# ~/.gftb/naming-consent.plain + ~/.gftb/naming-consent.key and diffs it
# against the committed src/lib/naming-consent.hashes.json. Skips loudly
# (exit 0) when either operator-local file is absent — e.g. in CI, where
# this is expected and not a failure. Wired into `just check`.
naming-consent-hashes-verify: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/verify-naming-consent-hashes.mjs

# Stage one already-redacted keyholders@ export as a published:false
# discuss-drafts .svx. NEVER sends mail. Usage:
#   just discuss-to-svx -- --input path/to/export.json
# See docs/runbooks/discuss-to-svx-pipeline.md.
discuss-to-svx *args: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/discuss-to-svx.mjs {{ args }}

# Independently re-validate every staged draft under src/content/discuss-drafts/**
# (naming-consent + address/phone gates against raw text AND filename, schema,
# pending-notice comment, plus an unconditional hash-list shape-check). When
# ~/.gftb/naming-consent.key is absent (expected in CI), the identity check
# only skips loudly if src/content/discuss-drafts/** is UNCHANGED relative to
# the base ref — if it changed, this fails closed instead (see
# src/lib/discuss-drafts-ci-scope.ts and the runbook's "CI scope" section).
# Every other check in this recipe always runs and always enforces. Wired
# into `just check`.
discuss-drafts-validate: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/validate-discuss-drafts.mts

# [OPERATOR, local-only] Reconcile ONE staged draft after manually posting it
# to discuss@ (runbook step 7): flips published:true, injects the public
# HyperKitty thread deep link as archiveUrl, removes the pending-notice
# comment, and re-runs the full draft validation in-process before writing
# anything. NEVER sends mail, NEVER touches the network (the URL is verified
# textually against the public discuss@ thread family). Requires
# ~/.gftb/naming-consent.key, like discuss-to-svx. Usage:
#   just discuss-reconcile -- --slug <slug> --archive-url <public thread URL>
# See docs/runbooks/discuss-to-svx-pipeline.md step 7.
discuss-reconcile *args: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/discuss-reconcile.mts {{ args }}

# Ensure local Playwright browser cache exists; CI uses Nix Chromium instead
playwright-ensure: _house-hydrate
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      echo "Using Nix chromium from the Playwright dev shell"; \
    else \
      pnpm exec playwright install chromium; \
    fi

# Run Playwright E2E tests
test-e2e: _house-hydrate playwright-ensure
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      nix develop .#playwright --command pnpm run test:e2e; \
    else \
      pnpm run test:e2e; \
    fi

# Install Playwright browser binaries
playwright-install browser="chromium": _house-hydrate
    cd {{ root }} && pnpm exec playwright install {{ browser }}

# Run all tests (unit + e2e)
test: test-unit test-e2e

# Generate local SBOM artifacts under ignored build/sbom/
sbom out_dir="build/sbom":
    cd {{ root }} && mkdir -p "{{ out_dir }}" && version="$(jq -r '.version' package.json)" && \
      syft scan dir:. \
        --source-name greatfallstoolbus.org \
        --source-version "$version" \
        --exclude './.git/**' \
        --exclude './.direnv/**' \
        --exclude './node_modules/**' \
        --exclude './build/**' \
        --exclude './.svelte-kit/**' \
        --exclude './bazel-*' \
        -o cyclonedx-json="{{ out_dir }}/greatfallstoolbus.org.cyclonedx.json" \
        -o spdx-json="{{ out_dir }}/greatfallstoolbus.org.spdx.json"

# Run the complete pre-commit validation gate. leak-scan-tree and
# leak-scan-src run early (cheap, git-ls-files-scoped, alongside the other
# public-safety scans); leak-scan-build runs last (it pays for a full
# `just build`, ~4 minutes — the only step this gate added that was not
# already part of `check`'s cost) so a cheaper failure surfaces first.
check: production-health-contract-check secrets-scan-dir scan-endpoints leak-scan-tree leak-scan-src inhouse-package-parity lint typecheck discuss-drafts-validate naming-consent-hashes-verify skills-validate skills-check source-map-check db-check platform-bundles-check test-unit leak-scan-build
    @echo "All checks passed."

# Probe the declared production hostnames at the public Cloudflare Access edge.
production-health-probe:
    cd {{ root }} && bash scripts/production-health-probe.sh

# Deterministic parser and failure-diagnostic coverage for the scheduled probe.
production-health-contract-check:
    cd {{ root }} && bash scripts/production-health-probe.test.sh

# Run full CI pipeline locally
ci: check build test-e2e
    @echo "Full CI suite passed."

# Quick CI (skip e2e + build)
ci-quick: check
    @echo "Quick CI suite passed."

# ─────────────────────────────────────────────
# Static projections
# ─────────────────────────────────────────────

# Validate a checked-in Tinyland static projection snapshot
validate-static-projection snapshot spoke="" actor="" require_signature="": _house-hydrate
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts validate "{{ snapshot }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# Copy a reviewed Tinyland static projection snapshot into this repo after validation
sync-static-projection source target spoke="" actor="" require_signature="": _house-hydrate
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts sync "{{ source }}" "{{ target }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# Alias for static Pulse snapshot ingestion; still produces a checked-in JSON file only
pulse-ingest source target spoke="" actor="" require_signature="": _house-hydrate
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts sync "{{ source }}" "{{ target }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# ─────────────────────────────────────────────
# v4 Bazel action plan (see docs/CI-SCHEMA.md)
# ─────────────────────────────────────────────

# Print every action exactly as the v4 workflow executes it.
lanes-list: lanes-validate
    @cd {{ root }} && jq -r '"NAME\tCOMMAND\tTARGETS", (.actions | to_entries[] | [.key, .value.command, (.value.targets | join(" "))] | @tsv)' .github/lanes.json | column -t -s $'\t'

# Validate .github/lanes.json against docs/schemas/lanes.schema.json
lanes-validate:
    cd {{ root }} && python3 scripts/validate-lanes.py

# Validate the v4-only repository manifest against schema version 2.
repo-manifest-validate:
    cd {{ root }} && python3 scripts/validate_repo_manifest.py --manifest tinyland.repo.json

# ─────────────────────────────────────────────
# Agent skills (cold-landing orientation; see plugins/scaffold-core/)
# ─────────────────────────────────────────────

# Cold-landing orientation: classify this repo's role and surface the skills that apply.
whoami:
    cd {{ root }} && python3 scripts/whoami.py

# List the agent skills published by this repo (canonical at .agents/skills/*).
skills-list:
    @cd {{ root }} && for s in .agents/skills/*/SKILL.md; do \
      name=$(awk '/^name:/ {print $2; exit}' "$s"); \
      desc=$(awk '/^description:/ {sub(/^description:[[:space:]]*/, ""); print; exit}' "$s"); \
      printf "%-32s %s\n" "$name" "$desc" | cut -c1-200; \
    done

# Validate every SKILL.md frontmatter has required fields (name, description).
skills-validate:
    cd {{ root }} && python3 scripts/validate-skills.py

# Derive the mail lace-up skills + llms.txt mail section from src/lib/data/mail-clients.ts.
skills-build: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/build-agent-skills.mjs

# Drift guard: regenerate derived skills, then fail if the tree changed.
skills-check: skills-build
    cd {{ root }} && git diff --exit-code -- .agents/skills .claude/skills static/llms.txt

# Derive the page source map (route id -> repo-relative +page.svelte).
# NOTE (2026-09-03): the consumer, SourceLink.svelte, was removed in 23d9513 and
# no page reads this map today; the generator and source-map-check gate keep
# running while a restore-or-retire decision (D-06) is pending.
source-map-build: _house-hydrate
    cd {{ root }} && pnpm exec tsx scripts/build-source-map.mjs

# Drift guard: regenerate the source map, then fail if the generated file changed.
source-map-check: source-map-build
    cd {{ root }} && git diff --exit-code -- src/lib/generated/source-map.json

# House-style drift audit: layer 1 (existing checks) + layer 3 (boundary audit). Layer 2 (tag diff) is manual; see the skill body.
# `just conformance` runs LAST in this chain, deliberately: it is the one check
# most likely to carry a known, already-reported red row (see AGENTS.md's
# Conformance section), and a red conformance must not suppress the other six
# checks -- especially scan-endpoints and secrets-scan-dir, the public-safety
# scans -- which is exactly what an early `&&`-chain position did before.
scaffold-doctor:
    @cd {{ root }} && echo "=== Layer 1: existing checks ===" && \
      just repo-manifest-validate && \
      just lanes-validate && \
      just inhouse-package-parity && \
      just scan-endpoints && \
      just secrets-scan-dir && \
      just bazel-graph && \
      echo "" && echo "=== Layer 3: authority-boundary audit ===" && \
      bash scripts/scaffold-doctor-boundary.sh && \
      echo "" && echo "=== Conformance (run last; see AGENTS.md if red) ===" && \
      just conformance

# Run the application conformance checklist (docs/CI-SCHEMA.md).
conformance: _house-hydrate
    cd {{ root }} && bash scripts/check-conformance.sh

# Verify first-party packages enter only through Bzlmod and every product
# action carries their public :pkg links.
inhouse-package-parity: _house-hydrate
    cd {{ root }} && node scripts/check-inhouse-package-parity.mjs

# GloriousFlywheel v4 is invoked only by the immutable ci-templates workflow
# against .github/lanes.json. Missing overlay/catalog/client authority is a
# refusal; this repo deliberately exposes no v3 profile, cache-only, endpoint,
# local-execution, or hosted-runner fallback recipe.

# ─────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────

# Sync SvelteKit types
sync: _house-hydrate
    cd {{ root }} && pnpm exec svelte-kit sync

# Build with bundle analyzer (emits .bundle-stats/stats.html treemap)
analyze: _house-hydrate
    cd {{ root }} && ANALYZE=1 pnpm run build

# Optimize static images: sharp -> webp/avif responsive widths, svgo -> SVG,
# plus a manifest at static/image-manifest.json with intrinsic width/height
# per entry (CLS sizing for Picture.svelte). Renditions land in
# static/optimized/ (gitignored). See scripts/optimize-images.js (TIN-2224).
optimize-images:
    cd {{ root }} && node scripts/optimize-images.js

# Bazel mod graph smoke (registry-resolution proof)
bazel-graph:
    cd {{ root }} && bazelisk --output_user_root="${BAZEL_OUTPUT_USER_ROOT:-${TMPDIR:-/tmp}/site-scaffold-bazel-user-root}" mod graph

# Bazel query smoke (BUILD target shape proof; not cache/RBE validation)
bazel-query target="//:ci_validation_suite":
    cd {{ root }} && bazelisk --output_user_root="${BAZEL_OUTPUT_USER_ROOT:-${TMPDIR:-/tmp}/site-scaffold-bazel-user-root}" query "{{ target }}"

# Generate changelog (git-cliff)
changelog:
    git-cliff --output CHANGELOG.md

# Preview changelog without writing
changelog-preview:
    git-cliff --unreleased

# Show environment info
info:
    @echo "Site:    greatfallstoolbus.org"
    @echo "Repo:    tinyland-inc/greatfallstoolbus.org"
    @echo "Node:    $(node --version 2>/dev/null || echo 'not available')"
    @echo "pnpm:    $(pnpm --version 2>/dev/null || echo 'not available')"
    @echo "Just:    $(just --version 2>/dev/null || echo 'not available')"
    @echo "Bazel:   $(if command -v bazelisk >/dev/null 2>&1; then bazelisk --version 2>&1 | head -n1; else echo 'not available'; fi)"
    @echo "Root:    {{ root }}"

# View the GitHub repo (opens in browser)
gh-repo:
    gh repo view tinyland-inc/greatfallstoolbus.org --web
