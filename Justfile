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
# Node-compatible layout required by pnpm/Vite/check and image entrypoints.
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
# shape Bazel submits through v4 and the OCI publisher embeds.
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
# On-cluster container image (nix2container, TIN-2543)
# ─────────────────────────────────────────────
# GFTB's ARC pool advertises only the shared `tinyland-nix` GloriousFlywheel
# runner — there is NO `tinyland-dind`/buildx runner in this org. So the
# adapter-node OCI image is built DAEMONLESS via nix2container (nlewo/nix2container,
# GloriousFlywheel core's own image mechanism; primary path is flake `.#image`,
# see flake.nix) and pushed through the n2c-patched skopeo. No Docker daemon, no
# buildx. The GF shared
# cache accelerates the SvelteKit build inputs; the image PUSH is never
# remote-execution eligible (`container-image-and-push` is blocked at the GF
# manifest layer — skill rule 8, docs/CI-SCHEMA.md §4).
#
# IMAGE CONTRACT (TIN-3815 S0): the image carries ONE dispatcher
# (scripts/platform-entrypoint.mjs) installed under three stable process names —
# `web`, `worker`, `migrator`. `platform-entrypoints-check` below runs each of
# them as a prerequisite of both image recipes, so an image is never produced or
# pushed whose entrypoints do not answer.

# Build the adapter-node OCI image with nix2container and push it to GHCR (used by
# .github/workflows/container-ghcr.yml on tinyland-nix via the nix-job action).
# Required env (supplied by CI, never committed): GHCR_USER, GHCR_TOKEN.
# Optional env: IMAGE_REF (default ghcr.io/great-falls-tool-bus/greatfallstoolbus.org),
# BUILD_COMMIT_SHA, BUILD_COMMIT_REF, BUILD_DATE; IMAGE_DIGEST_FILE (when set,
# skopeo writes the immutable destination manifest digest there during publish).
container-image-publish: platform-entrypoints-check
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    : "${GHCR_USER:?GHCR_USER is required (ambient github.actor in CI)}"
    : "${GHCR_TOKEN:?GHCR_TOKEN is required (ambient GITHUB_TOKEN in CI)}"
    # GHCR requires a lowercase image ref; the org owner is Great-Falls-Tool-Bus.
    # The flake reads IMAGE_REF (getEnv, --impure) and derives the image name from
    # it, so copyToRegistry pushes to docker://${IMAGE_REF}:sha-${sha}.
    export IMAGE_REF="$(printf '%s' "${IMAGE_REF:-ghcr.io/great-falls-tool-bus/greatfallstoolbus.org}" | tr '[:upper:]' '[:lower:]')"
    export BUILD_COMMIT_SHA="${BUILD_COMMIT_SHA:-$(git rev-parse HEAD)}"
    export BUILD_COMMIT_REF="${BUILD_COMMIT_REF:-unknown}"
    export BUILD_DATE="${BUILD_DATE:-1970-01-01T00:00:00Z}"
    tag="sha-${BUILD_COMMIT_SHA}"
    # 1. Production adapter-node bundle. build/ is the same product-shaped
    #    output as //:build and is imported into the image via APP_BUILD.
    #
    pnpm install --frozen-lockfile
    just _house-hydrate
    # BUG (TIN-2224 fallout): this recipe calls `pnpm run build` directly,
    # bypassing the default `build` recipe's dependency on
    # _optimize-images-if-photos. static/optimized/ is gitignored and only
    # ever populated by scripts/optimize-images.js, so the prod on-cluster
    # image shipped with zero optimized AVIF/WebP variants — 404ing the
    # homepage hero (great-falls-lewiston-1930s-xlarge.avif) and every other
    # photo's responsive renditions once adapter-node became the production
    # server. Mirror _optimize-images-if-photos's own guard here so container
    # images carry the same renditions the registered product build prepares.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then \
        node scripts/optimize-images.js; \
    else \
        echo "No static/photos assets; keeping committed image-manifest fallback."; \
    fi
    # PUBLIC_BUILD_SHA carries the build commit into the client bundle (Vite
    # inlines it via import.meta.env, src/lib/build-info.ts) so the footer renders
    # a "built from <sha>" provenance link to this exact commit. Only the container
    # publisher sets it; developer builds leave it unset and the line degrades
    # to nothing.
    PUBLIC_BUILD_SHA="${BUILD_COMMIT_SHA}" pnpm run build
    # 1b. The /bin/migrator payload (TIN-3817 S1) and the /bin/worker payload
    #     (TIN-3817 S3). Both land INSIDE build/ so they ride the same APP_BUILD
    #     import as the web server; the flake refuses to assemble an image
    #     without either rather than shipping a role that exits 70.
    just db-migrator-bundle
    just worker-bundle
    export APP_BUILD="$PWD/build"
    export APP_NODE_MODULES="$PWD/node_modules"
    nix run --impure .#runtime-closure-proof
    # 2. Build the nix2container image and push it to GHCR through the n2c-patched
    #    skopeo. copyToRegistry derives docker://${IMAGE_REF}:${tag} from the image
    #    name/tag; --dest-creds carries the ambient GITHUB_TOKEN (no new secret).
    #    Image assembly/push is NOT executor-eligible (skill rule 8).
    digestfile_args=()
    if [[ -n "${IMAGE_DIGEST_FILE:-}" ]]; then
        digestfile_args=(--digestfile "${IMAGE_DIGEST_FILE}")
    fi
    nix run --impure .#image.copyToRegistry -- --dest-creds "${GHCR_USER}:${GHCR_TOKEN}" "${digestfile_args[@]}"
    echo "pushed ${IMAGE_REF}:${tag}"

# Local daemonless image build (no push): writes a docker-archive tarball you
# can load with `skopeo copy docker-archive:greatfallstoolbus-oci.tar docker-daemon:...`
# (or `docker load < greatfallstoolbus-oci.tar`). macOS builds a host-arch image
# only; the Linux OCI is validated on the tinyland-nix runner.
container-image-build: platform-entrypoints-check _house-hydrate
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    export IMAGE_REF="$(printf '%s' "${IMAGE_REF:-ghcr.io/great-falls-tool-bus/greatfallstoolbus.org}" | tr '[:upper:]' '[:lower:]')"
    export BUILD_COMMIT_SHA="${BUILD_COMMIT_SHA:-$(git rev-parse HEAD)}"
    export BUILD_COMMIT_REF="${BUILD_COMMIT_REF:-$(git rev-parse --abbrev-ref HEAD)}"
    export BUILD_DATE="${BUILD_DATE:-1970-01-01T00:00:00Z}"
    # BUG (TIN-2224 fallout): this recipe calls `pnpm run build` directly,
    # bypassing the default `build` recipe's dependency on
    # _optimize-images-if-photos. static/optimized/ is gitignored and only
    # ever populated by scripts/optimize-images.js, so this local tarball
    # (and the prod on-cluster image it mirrors) shipped with zero optimized
    # AVIF/WebP variants — 404ing the homepage hero
    # (great-falls-lewiston-1930s-xlarge.avif) and every other photo's
    # responsive renditions once adapter-node became the production server.
    # Mirror _optimize-images-if-photos's own guard here so container images
    # carry the same renditions the registered product build prepares.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then \
        node scripts/optimize-images.js; \
    else \
        echo "No static/photos assets; keeping committed image-manifest fallback."; \
    fi
    # PUBLIC_BUILD_SHA bakes the build commit for the footer "built from <sha>"
    # provenance link (src/lib/build-info.ts).
    PUBLIC_BUILD_SHA="${BUILD_COMMIT_SHA}" pnpm run build
    # The /bin/migrator (TIN-3817 S1) and /bin/worker (TIN-3817 S3) payloads;
    # see container-image-publish.
    just db-migrator-bundle
    just worker-bundle
    export APP_BUILD="$PWD/build"
    export APP_NODE_MODULES="$PWD/node_modules"
    nix run --impure .#runtime-closure-proof
    nix run --impure .#image.copyTo -- docker-archive:greatfallstoolbus-oci.tar
    echo "wrote greatfallstoolbus-oci.tar"

# Build the exact adapter-node application layer, import its Bazel-hydrated
# runtime closure through flake.nix, start the custom server, and fetch root.
# This is build/read-only proof: it never assembles, pushes, deploys, or applies.
container-image-runtime-proof: platform-entrypoints-check _house-hydrate
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    source_sha="$(git rev-parse HEAD)"
    PUBLIC_BUILD_SHA="$source_sha" pnpm run build
    just db-migrator-bundle
    just worker-bundle
    export APP_BUILD="$PWD/build"
    export APP_NODE_MODULES="$PWD/node_modules"
    nix run --impure .#runtime-closure-proof

# Per-entrypoint proof (TIN-3815 S0). Runs the EXACT derivations the OCI image
# installs at /bin/web, /bin/worker, and /bin/migrator, so the three stable
# process names are proved to answer without a Docker/podman daemon, a cluster,
# or a registry. `--help` must exit 0 for every role — including the roles S1 and
# S3 have not implemented yet, which otherwise fail closed.
# Prove the image's web/worker/migrator entrypoints answer (no container daemon needed)
platform-entrypoints-check:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    for role in web worker migrator; do
        echo "── nix run .#${role} -- --help"
        nix run ".#${role}" -- --help
    done
    echo "platform entrypoints OK: web, worker, migrator"

# The EXECUTED half of S0's acceptance rows: `docker run --entrypoint <role> …
# --help` exits 0 for each of web/worker/migrator, and in-container `id -u` is
# 1001. platform-entrypoints-check proves the DERIVATIONS and `nix build .#image`
# proves the image CONFIG; only this recipe proves the ASSEMBLED, RUNNING image,
# so it needs a live container runtime.
#
# FAILS CLOSED when no runtime daemon answers. The guard probes
# `<runtime> info`, not `command -v`: the docker CLI is present on the operator's
# macOS host while the daemon is not running, so a PATH-only guard reports a
# false positive and then fails deep inside the build. It FAILS HARD when a
# runtime does answer and an assertion does not hold, so these rows self-execute
# the moment a daemon exists — no further code change.
#
# WHICH IMAGE. The smoke accepts only the immutable published artifact; it does
# not build a second local image implementation.
#   GFTB_SMOKE_IMAGE=ghcr.io/great-falls-tool-bus/<repo>@sha256:… just container-image-smoke
# Prove the ASSEMBLED image: per-role --entrypoint --help, and id -u == 1001.
container-image-smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}

    runtime=""
    for candidate in docker podman; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" info >/dev/null 2>&1; then
            runtime="$candidate"; break
        fi
    done
    if [ -z "$runtime" ]; then
        echo "container-image-smoke: FAIL — no responding docker or podman daemon." >&2
        exit 1
    fi
    echo "container-image-smoke: using ${runtime}"

    ref="${GFTB_SMOKE_IMAGE:?GFTB_SMOKE_IMAGE must name an immutable published image}"
    if [[ ! "$ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
        echo "container-image-smoke: FAIL — GFTB_SMOKE_IMAGE must be an immutable @sha256 reference." >&2
        exit 1
    fi
    echo "container-image-smoke: image ${ref}"

    failed=0
    for role in web worker migrator; do
        if "$runtime" run --rm --entrypoint "$role" "$ref" --help >/dev/null; then
            echo "  ✓ --entrypoint ${role} --help exited 0"
        else
            echo "  ✗ --entrypoint ${role} --help did not exit 0" >&2
            failed=1
        fi
    done

    # TIN-3817 S1: `migrator` is a real applier now, so prove it answers with the
    # code the pre-rollout Job keys on. No DATABASE_URL is supplied, so 78
    # (database unreachable/unconfigured) is the CORRECT answer — 0 would mean a
    # Job reported success without migrating, and 70 would mean the bundle never
    # made it into the image.
    set +e
    "$runtime" run --rm --entrypoint migrator "$ref" >/dev/null 2>&1
    migrator_code=$?
    set -e
    if [ "$migrator_code" = "78" ]; then
        echo "  ✓ migrator without a DSN exits 78 (declared unavailable, not silently healthy)"
    else
        echo "  ✗ migrator without a DSN exited ${migrator_code}, expected 78" >&2
        [ "$migrator_code" = "70" ] && echo "    70 means build/migrator.mjs is absent from the image." >&2
        failed=1
    fi

    # TIN-3817 S3: `worker` is the real outbox dispatcher now — same proof shape
    # as the migrator row above. No DATABASE_URL is supplied, so 78 is the
    # CORRECT answer: 0 would mean a Deployment reported healthy while doing
    # nothing, and 70 would mean build/worker.mjs never made it into the image.
    # `--once` so this row can never enter the polling loop and hang the job if
    # a future image change ever bakes in a DATABASE_URL (PR #173 review NIT-2).
    set +e
    "$runtime" run --rm --entrypoint worker "$ref" --once >/dev/null 2>&1
    worker_code=$?
    set -e
    if [ "$worker_code" = "78" ]; then
        echo "  ✓ worker without a DSN exits 78 (declared unavailable, not silently healthy)"
    else
        echo "  ✗ worker without a DSN exited ${worker_code}, expected 78" >&2
        [ "$worker_code" = "70" ] && echo "    70 means build/worker.mjs is absent from the image." >&2
        failed=1
    fi

    # ADR 0008 §3: the nix2container image runs non-root as uid/gid 1001;
    # coreutils supplies `id` in the sole published implementation.
    uid="$("$runtime" run --rm --entrypoint id "$ref" -u | tr -d '\r\n')"
    gid="$("$runtime" run --rm --entrypoint id "$ref" -g | tr -d '\r\n')"
    if [ "$uid" = "1001" ] && [ "$gid" = "1001" ]; then
        echo "  ✓ in-container id -u/-g == 1001/1001"
    else
        echo "  ✗ in-container id -u/-g == ${uid}/${gid}, expected 1001/1001" >&2
        failed=1
    fi

    if [ "$failed" -ne 0 ]; then
        echo "container-image-smoke: FAIL" >&2
        exit 1
    fi
    echo "container-image-smoke: OK — web, worker, migrator answer; image is non-root 1001:1001"

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
# Preview (tailnet; INTERIM lane — the ratified target is
# staging.greatfallstoolbus.org promote-on-PR once the infra apply sitting
# lands. See docs/preview-tailnet.md.)
# ─────────────────────────────────────────────

# Both recipes below kill by PROCESS GROUP, not by a bare pidfile pid.
# `pnpm exec tsx <file> &` is a 4-deep chain (nix pnpm -> pnpm shim -> tsx
# cli -> the real node process); `$!` alone names only the top wrapper, so
# killing just that pid leaves the other three reparented to PID 1, still
# running — proven against an earlier revision of this lane by adversarial
# review (PR #192, an isolated repro of this exact launch/kill construct).
# `set -m` (job control) makes each `cmd &` below its own new process-group
# leader, so `kill -- -PGID` reaches the whole chain. `kill_lane_group`
# validates the pidfile's pgid against an expected command-line SHAPE
# (`command_matches`) before trusting it — a stale or planted pidfile should
# not steer a `kill -9` at an unrelated process — and backstops with
# `pgrep -f` on the same marker regardless of pidfile state, so a survivor
# from a prior unclean exit is still caught. `pgrep -f` alone is a
# substring match, so the backstop validates EVERY candidate it finds
# through that same `command_matches` check before killing it — a
# marker-only backstop would `kill -9` an unrelated process that merely
# mentions the marker (e.g. `tail -f server.js`), proven by adversarial
# review.
#
# Re-runnable: kills the previous run's web/worker process groups first
# (validated + backstopped, not a bare pidfile trust), then restarts
# Postgres against the SAME on-disk cluster (not re-initdb'd), so a tenant
# seeded on a previous run survives a re-run after a code change.
# `just preview-tailnet-down` stops the lane but retains its private cluster for reuse.
#
# One-command tailnet preview (Postgres + migrations + web + worker) fronted by tailscale serve — HTTPS only, never funnel.
preview-tailnet:
    #!/usr/bin/env bash
    set -euo pipefail
    set -m
    cd {{ root }}
    root_dir="$PWD"

    # Establish uid/mode/marker custody before using any state child.
    state_dir="$(bash scripts/preview-tailnet-state.sh prepare "$root_dir")"
    pgdata="$state_dir/pgdata"
    pg_port=55446
    web_port=8443
    db_name=gftb_preview
    web_marker="${root_dir}/server.js"
    worker_marker="--worker-id gftb-preview-tailnet"

    # Structural command validator: does PID's ACTUAL command line look like
    # something this recipe launched, not merely a process whose argv happens
    # to contain the marker substring? `pgrep -f` alone cannot tell
    # `node .../server.js` apart from an innocent `tail -f .../server.js` —
    # proven by adversarial review, which got an innocent tail process
    # kill -9'd by the backstop below. Used by BOTH the pidfile-trust path
    # and the pgrep backstop, so neither can be tricked by a process that
    # merely mentions the marker.
    command_matches() {
        local pid="$1" kind="$2"
        local cmd
        cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
        case "$kind" in
            web)
                [[ "$cmd" == "node "* ]] && [[ "$cmd" == *"$web_marker"* ]]
                ;;
            worker)
                [[ "$cmd" == *tsx* ]] && [[ "$cmd" == *worker.ts* ]] && [[ "$cmd" == *"$worker_marker"* ]]
                ;;
            *)
                return 1
                ;;
        esac
    }

    # Process-group kill: validate the pidfile's pgid still runs the
    # expected command before trusting it, kill the whole group, then
    # backstop with pgrep — validating EACH candidate the same way before
    # killing it, so a process that merely mentions the marker is spared.
    kill_lane_group() {
        local name="$1" marker="$2"
        local pidfile="$state_dir/$name.pid"
        if [ -f "$pidfile" ]; then
            local pgid
            pgid="$(cat "$pidfile" 2>/dev/null || true)"
            if [[ "$pgid" =~ ^[0-9]+$ ]] && command_matches "$pgid" "$name"; then
                echo "preview-tailnet: stopping stale ${name} (pgid ${pgid})"
                kill -TERM -- "-${pgid}" 2>/dev/null || true
                for _ in 1 2 3 4 5; do
                    kill -0 -- "-${pgid}" 2>/dev/null || break
                    sleep 1
                done
                kill -KILL -- "-${pgid}" 2>/dev/null || true
            fi
            rm -f "$pidfile"
        fi
        local survivors pid
        survivors="$(pgrep -f -- "$marker" 2>/dev/null || true)"
        for pid in $survivors; do
            if command_matches "$pid" "$name"; then
                echo "preview-tailnet: killing backstop survivor for ${name}: pid ${pid}"
                kill -KILL "$pid" 2>/dev/null || true
            else
                echo "preview-tailnet: pgrep matched pid ${pid} on the ${name} marker, but its command doesn't look like ours — leaving it alone" >&2
            fi
        done
    }

    # 1. Kill stale web/worker from a previous run — the re-runnable contract.
    kill_lane_group web "$web_marker"
    kill_lane_group worker "$worker_marker"

    # 2. Resolve a PostgreSQL 16 toolchain. This repo's flake devShell does
    #    not carry `postgresql` — `just test-integration` reaches for a
    #    testcontainer or an operator-named server instead (see
    #    src/lib/server/db/integration-support.ts) — and an operator-local
    #    preview has neither. Borrow the same `nix-shell -p postgresql_16`
    #    convenience already used ad hoc for local DB work on this project.
    #    `tail -n 1`: some shells print a devShell banner ahead of the real
    #    answer on `nix-shell` startup; only the last line is the path.
    #    `2>&1` (not `2>/dev/null`) + `|| true`: under `set -e`, a failing
    #    command substitution aborts the assignment itself before the
    #    friendly error below can ever run — capture stderr into the same
    #    line instead of discarding it, so a real nix failure is diagnosable.
    pg_bindir="$(nix-shell -p postgresql_16 --run 'dirname "$(command -v pg_ctl)"' 2>&1 | tail -n 1)" || true
    if [ ! -x "${pg_bindir}/pg_ctl" ]; then
        echo "preview-tailnet: could not resolve postgresql_16 via 'nix-shell -p postgresql_16'." >&2
        echo "  nix-shell said: ${pg_bindir}" >&2
        exit 1
    fi

    # 3. Refuse to clobber an unrelated pre-existing tailscale-serve mapping
    #    on this exact port before doing anything else: a stranger's handler
    #    on :8443 would otherwise be silently overwritten on up and deleted
    #    on down. Checks for ANY handler on the port — not just a `/`-scoped
    #    `Proxy` shape — so a `Text` or path-scoped handler is caught too,
    #    not just the exact shape this lane itself writes.
    web_serve_verdict="$(tailscale serve status --json 2>/dev/null | jq -r --arg port "$web_port" --arg target "http://127.0.0.1:${web_port}" '
        ((.Web // {}) | to_entries[] | select(.key | endswith(":" + $port)) | .value.Handlers) as $h
        | if ($h == null or ($h | length) == 0) then "none"
          elif ($h == {"/": {"Proxy": $target}}) then "ours"
          else "foreign"
          end
    ' 2>/dev/null | head -n 1)"
    if [ "${web_serve_verdict:-none}" = "foreign" ]; then
        echo "preview-tailnet: tailscale serve already has an unrelated handler on :${web_port} — refusing to clobber it." >&2
        echo "  Inspect with 'tailscale serve status', clear it yourself, or free the port and re-run." >&2
        exit 1
    fi

    # 4. Start (or reuse) the private operator-local cluster. Loopback-only listen address
    #    and trust auth: the only network exposure of this whole lane is
    #    tailscale-serve HTTPS — Postgres itself never leaves 127.0.0.1. Note
    #    trust auth also means the role passwords below buy no LOCAL
    #    isolation (any local user can connect as postgres and bypass RLS
    #    entirely) — the role split's real job is only to make the app
    #    processes run as gftb_app so RLS actually applies to them.
    if [ ! -d "$pgdata" ]; then
        echo "preview-tailnet: initializing private PostgreSQL cluster at ${pgdata}"
        "${pg_bindir}/initdb" --pgdata="$pgdata" --username=postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
    fi
    if "${pg_bindir}/pg_ctl" status -D "$pgdata" >/dev/null 2>&1; then
        "${pg_bindir}/pg_ctl" stop -D "$pgdata" -m fast -w >/dev/null 2>&1 || true
    fi
    "${pg_bindir}/pg_ctl" start -D "$pgdata" -w -l "$state_dir/postgres.log" \
        -o "-p ${pg_port} -h 127.0.0.1 -c listen_addresses=127.0.0.1"

    superuser_dsn="postgresql://postgres@127.0.0.1:${pg_port}/postgres"
    if ! "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$superuser_dsn" -tAc \
        "select 1 from pg_database where datname = '${db_name}'" | grep -q 1; then
        "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$superuser_dsn" -c "create database \"${db_name}\""
    fi
    db_superuser_dsn="postgresql://postgres@127.0.0.1:${pg_port}/${db_name}"

    # 5. Build the migrator/runtime role split exactly as
    #    src/lib/server/db/integration-support.ts's `prepareDatabase` +
    #    `credentialRuntimeRole` do for the integration suite's "external
    #    server" fixture path: a superuser bypasses RLS unconditionally, so
    #    web/worker must run as the DML-only `gftb_app` role for this preview
    #    to prove anything about the RLS the S1/S2 migrations ship. Passwords
    #    are generated fresh per run and never written to a committed file —
    #    but see step 4's trust-auth note above: they buy no LOCAL secrecy on
    #    this cluster either way.
    migrator_pw="$(openssl rand -hex 24)"
    app_pw="$(openssl rand -hex 24)"
    # create-or-alter rather than a `do $$ ... $$` PL/pgSQL block: simpler to
    # keep correct across a re-run against the SAME persisted cluster, and
    # avoids Justfile heredoc/escaping pitfalls entirely.
    "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" \
        -c "create role gftb_migrator login nosuperuser nobypassrls createrole password '${migrator_pw}'" \
        >/dev/null 2>&1 || \
        "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" \
            -c "alter role gftb_migrator login password '${migrator_pw}' nosuperuser nobypassrls createrole"
    "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" \
        -c "grant create on database \"${db_name}\" to gftb_migrator" \
        -c "alter schema public owner to gftb_migrator"
    migrator_dsn="postgresql://gftb_migrator:${migrator_pw}@127.0.0.1:${pg_port}/${db_name}"

    # 6. Apply the checked-in migrations through the SAME applier
    #    `just db-migrate` runs (src/lib/server/db/migrate.ts): advisory
    #    lock, immutable ledger, forward-only. A no-op is a success, so this
    #    is safe on every re-run.
    echo "preview-tailnet: applying migrations"
    DATABASE_URL="$migrator_dsn" just db-migrate

    # 7. Credential the runtime role the way great-falls-tool-bus-infra does
    #    after the migrator has run —
    #    drizzle/0002_rls_force_and_runtime_grants.sql creates it NOLOGIN;
    #    only infra (and here, this recipe) grants it a login.
    "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" -c \
        "alter role gftb_app login password '${app_pw}'"
    runtime_dsn="postgresql://gftb_app:${app_pw}@127.0.0.1:${pg_port}/${db_name}"
    # No-password form for anything PRINTED below: trust auth (step 4) never
    # checks it anyway, so this connects identically without ever echoing a
    # credential-shaped string to the terminal/scrollback.
    runtime_dsn_display="postgresql://gftb_app@127.0.0.1:${pg_port}/${db_name}"

    # 8. Seeding is a committed recipe now: `just preview-seed` (below)
    #    creates-or-finds the minimal tenant + keyholder grant against this
    #    cluster's runtime role and prints the GFTB_TENANT_ID export line.
    #    Referenced in the up-report below rather than run inline here: only
    #    the operator's shell can export GFTB_TENANT_ID for the worker, so
    #    the export-and-re-run step cannot be folded into this recipe.

    # 9. Build and launch web + worker as separate long-lived background
    #    processes using the same adapter-node product shape as production.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then
        node scripts/optimize-images.js
    fi
    pnpm install --frozen-lockfile
    just _house-hydrate
    pnpm run build

    tailnet_dns="$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"
    if [ -z "$tailnet_dns" ] || [ "$tailnet_dns" = "null" ]; then
        echo "preview-tailnet: could not resolve this device's tailnet DNS name (tailscale status --json)." >&2
        echo "  Is tailscale up? Run 'tailscale status' to check." >&2
        exit 1
    fi
    origin="https://${tailnet_dns}:${web_port}"

    # `set -m` (top of this recipe) makes each of these its own new
    # process-group leader: $! is both the pid and the pgid, and
    # kill_lane_group above/preview-tailnet-down below can kill the whole
    # chain via `kill -- -PGID` instead of only the top wrapper (B1).
    # `${web_marker}` (an absolute path) rather than a cwd-relative
    # `server.js`, so the launched process's own argv carries something a
    # `pgrep -f` backstop can match on. `${worker_marker}` is a real,
    # already-supported `--worker-id <name>` flag (src/lib/server/worker.ts)
    # doing double duty as that same backstop signature for the worker.
    echo "preview-tailnet: starting web on 127.0.0.1:${web_port} (origin ${origin})"
    HOST=127.0.0.1 PORT="${web_port}" ORIGIN="${origin}" DATABASE_URL="${runtime_dsn}" \
        nohup node "${web_marker}" >"$state_dir/web.log" 2>&1 &
    echo $! > "$state_dir/web.pid"

    echo "preview-tailnet: starting worker (outbox dispatcher)"
    DATABASE_URL="${runtime_dsn}" GFTB_TENANT_ID="${GFTB_TENANT_ID:-}" \
        nohup pnpm exec tsx src/lib/server/worker.ts ${worker_marker} \
        >"$state_dir/worker.log" 2>&1 &
    echo $! > "$state_dir/worker.pid"

    web_pid="$(cat "$state_dir/web.pid")"
    worker_pid="$(cat "$state_dir/worker.pid")"
    sleep 2
    if kill -0 "$web_pid" 2>/dev/null; then
        echo "preview-tailnet: web is running (pgid ${web_pid})"
    else
        echo "preview-tailnet: web exited immediately — see ${state_dir}/web.log" >&2
        exit 1
    fi
    # tsx transpiles worker.ts (many imports) before its own fail-closed
    # "no tenant" check can even run, so detecting an EARLY exit needs a
    # bounded poll rather than one fixed sleep: a healthy worker just runs
    # out this (short, bounded) clock and is reported running below.
    worker_state="running"
    for _ in 1 2 3 4 5; do
        if ! kill -0 "$worker_pid" 2>/dev/null; then
            worker_state="not running — see ${state_dir}/worker.log (expected until a tenant is seeded and GFTB_TENANT_ID is exported; see below)"
            break
        fi
        sleep 1
    done

    # 10. Publish. `serve`, never `funnel` — tailnet identity is the whole
    #     access-control story for this lane.
    echo "preview-tailnet: publishing via tailscale serve (HTTPS only, never funnel)"
    tailscale serve --bg --https="${web_port}" "http://127.0.0.1:${web_port}"

    echo ""
    echo "preview-tailnet: up."
    echo "  Web:      ${origin}/  (tailnet identity required; no other network exposure)"
    echo "  Worker:   ${worker_state}"
    echo "  Postgres: 127.0.0.1:${pg_port}/${db_name} (private state retained by 'just preview-tailnet-down' for reuse)"
    echo "  Logs:     ${state_dir}/{web,worker,postgres}.log"
    echo "  Down:     just preview-tailnet-down"
    echo ""
    echo "  If the worker is not running, no tenant is seeded (or GFTB_TENANT_ID is"
    echo "  not exported). To exercise the member-v0 routes as a keyholder, run the"
    echo "  committed idempotent seed — safe to re-run; it reuses a tenant seeded on"
    echo "  an earlier run, because the same Postgres cluster persists across runs:"
    echo ""
    echo "    just preview-seed"
    echo ""
    echo "  then export GFTB_TENANT_ID exactly as the seed prints and re-run"
    echo "  'just preview-tailnet' — the worker will then dispatch for that tenant."
    echo ""

# Committed, idempotent seed for the tailnet preview lane — the recipe that
# replaced the manual psql paste `preview-tailnet`'s first-run report used to
# print (see docs/preview-tailnet.md). Creates the minimal tenant (slug
# 'preview-tailnet') plus one live keyholder grant if absent, reuses them if
# present, and prints the GFTB_TENANT_ID export line the worker needs.
# Safe to run twice:
#   tenant — resolved by slug first (as postgres: FORCE RLS hides a
#            previously seeded tenant from gftb_app until app.tenant_id
#            already equals the answer, so the runtime role cannot do this
#            lookup), then inserted `on conflict do nothing` under the
#            resolved-or-minted id.
#   grant  — inserted only `where not exists` a live keyholder for the
#            tenant, so a re-run (or a cluster seeded by the old manual
#            paste) adds nothing and never mints a second keyholder.
# Writes go through the SAME runtime role the manual paste used (gftb_app,
# with app.tenant_id set), so seeding keeps proving the RLS WITH CHECK path
# rather than bypassing it; only the read-only slug lookup runs as postgres.
# Both DSNs are password-less on purpose: trust auth on this loopback-only
# cluster never checks one (see `preview-tailnet` step 4), so nothing
# credential-shaped is printed or stored.
#
# Idempotently seed the preview's minimal tenant + keyholder grant; prints the GFTB_TENANT_ID export line.
preview-seed:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}

    pg_port=55446
    db_name=gftb_preview
    seed_slug="preview-tailnet"
    seed_display_name="Preview Tailnet Tenant"

    # Same postgresql_16 resolution as `preview-tailnet` — see its step 2
    # comment for the `tail -n 1` / stderr-capture rationale.
    pg_bindir="$(nix-shell -p postgresql_16 --run 'dirname "$(command -v pg_ctl)"' 2>&1 | tail -n 1)" || true
    if [ ! -x "${pg_bindir}/psql" ]; then
        echo "preview-seed: could not resolve postgresql_16 via 'nix-shell -p postgresql_16'." >&2
        echo "  nix-shell said: ${pg_bindir}" >&2
        exit 1
    fi

    db_superuser_dsn="postgresql://postgres@127.0.0.1:${pg_port}/${db_name}"
    runtime_dsn="postgresql://gftb_app@127.0.0.1:${pg_port}/${db_name}"

    if ! "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" -tAc 'select 1' >/dev/null 2>&1; then
        echo "preview-seed: cannot reach the preview cluster at 127.0.0.1:${pg_port}/${db_name}." >&2
        echo "  Run 'just preview-tailnet' first — it initializes, migrates, and starts it." >&2
        exit 1
    fi

    # Resolve-or-mint the tenant id (superuser read; see header comment).
    tenant_id="$("${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$db_superuser_dsn" -tAc \
        "select tenant_id from tenant where slug = '${seed_slug}'")"
    if [ -n "$tenant_id" ]; then
        echo "preview-seed: tenant '${seed_slug}' already exists (${tenant_id}) — reusing it"
    else
        tenant_id="$(node -e 'console.log(crypto.randomUUID())')"
        echo "preview-seed: creating tenant '${seed_slug}' (${tenant_id})"
    fi
    person_id="$(node -e 'console.log(crypto.randomUUID())')"

    # All writes as gftb_app in ONE psql session: set_config(..., false) is
    # session-scoped, so it covers both inserts' RLS USING/WITH CHECK.
    "${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$runtime_dsn" \
        -c "select set_config('app.tenant_id', '${tenant_id}', false)" \
        -c "insert into tenant (tenant_id, slug, display_name) values ('${tenant_id}', '${seed_slug}', '${seed_display_name}') on conflict do nothing" \
        -c "insert into member_role_grant (tenant_id, person_id, role, granted_by) select '${tenant_id}', '${person_id}', 'keyholder', '${person_id}' where not exists (select 1 from member_role_grant where tenant_id = '${tenant_id}' and role = 'keyholder' and revoked_at is null)" \
        >/dev/null

    # Report the live keyholder actually in place (a pre-existing grant wins
    # over the person_id minted above). Read as gftb_app too — this one IS
    # visible to the runtime role once app.tenant_id is set.
    keyholder="$("${pg_bindir}/psql" -X -q -v ON_ERROR_STOP=1 "$runtime_dsn" -tA \
        -c "select set_config('app.tenant_id', '${tenant_id}', false)" \
        -c "select person_id from member_role_grant where tenant_id = '${tenant_id}' and role = 'keyholder' and revoked_at is null limit 1" \
        | tail -n 1)"

    echo ""
    echo "preview-seed: done — tenant '${seed_slug}' has a live keyholder grant (person ${keyholder})."
    echo "  Export the tenant id, then (re-)run the preview so the worker dispatches for it:"
    echo ""
    echo "    export GFTB_TENANT_ID=${tenant_id}"
    echo "    just preview-tailnet"
    echo ""

# Attempt to stop web/worker by whole process group (validated + pgrep-backstopped —
# same `kill_lane_group` shape as `preview-tailnet`'s own stale-kill step;
# see that recipe's header comment for why a bare pidfile pid cannot be
# trusted here). Attempts to remove the tailscale serve mapping (scoped
# `--https=8443 off`, never a blanket `tailscale serve reset`;
# `preview-tailnet` itself already refuses to start on top of an unrelated
# pre-existing handler on this port, so the attempt never targets a mapping
# the lane didn't create). Attempts a clean Postgres stop and preserves the validated private
# state directory, marker, logs, and pgdata for a later reuse.
#
# Attempt to stop the tailnet preview while retaining its validated private state for reuse.
preview-tailnet-down:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    root_dir="$PWD"

    # Validate state custody before process, tailscale, Postgres, or filesystem teardown.
    state_dir="$(bash scripts/preview-tailnet-state.sh path "$root_dir")"
    if [ -e "$state_dir" ] || [ -L "$state_dir" ]; then
        bash scripts/preview-tailnet-state.sh validate "$root_dir" "$state_dir"
    fi
    pgdata="$state_dir/pgdata"
    web_port=8443
    web_marker="${root_dir}/server.js"
    worker_marker="--worker-id gftb-preview-tailnet"

    # See `preview-tailnet`'s own copy of `command_matches` for why this
    # exists: `pgrep -f` alone cannot tell `node .../server.js` apart from
    # an innocent `tail -f .../server.js` — proven by adversarial review,
    # which got an innocent tail process kill -9'd by an earlier revision of
    # the backstop below. Used by BOTH the pidfile-trust path and the pgrep
    # backstop, so neither can be tricked by a process that merely mentions
    # the marker.
    command_matches() {
        local pid="$1" kind="$2"
        local cmd
        cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
        case "$kind" in
            web)
                [[ "$cmd" == "node "* ]] && [[ "$cmd" == *"$web_marker"* ]]
                ;;
            worker)
                [[ "$cmd" == *tsx* ]] && [[ "$cmd" == *worker.ts* ]] && [[ "$cmd" == *"$worker_marker"* ]]
                ;;
            *)
                return 1
                ;;
        esac
    }

    kill_lane_group() {
        local name="$1" marker="$2"
        local pidfile="$state_dir/$name.pid"
        if [ -f "$pidfile" ]; then
            local pgid
            pgid="$(cat "$pidfile" 2>/dev/null || true)"
            if [[ "$pgid" =~ ^[0-9]+$ ]] && command_matches "$pgid" "$name"; then
                echo "preview-tailnet-down: stopping ${name} (pgid ${pgid})"
                kill -TERM -- "-${pgid}" 2>/dev/null || true
                for _ in 1 2 3 4 5; do
                    kill -0 -- "-${pgid}" 2>/dev/null || break
                    sleep 1
                done
                kill -KILL -- "-${pgid}" 2>/dev/null || true
            fi
            rm -f "$pidfile"
        fi
        local survivors pid
        survivors="$(pgrep -f -- "$marker" 2>/dev/null || true)"
        for pid in $survivors; do
            if command_matches "$pid" "$name"; then
                echo "preview-tailnet-down: killing backstop survivor for ${name}: pid ${pid}"
                kill -KILL "$pid" 2>/dev/null || true
            else
                echo "preview-tailnet-down: pgrep matched pid ${pid} on the ${name} marker, but its command doesn't look like ours — leaving it alone" >&2
            fi
        done
    }

    kill_lane_group web "$web_marker"
    kill_lane_group worker "$worker_marker"

    echo "preview-tailnet-down: attempting to remove tailscale serve mapping (https=${web_port})"
    tailscale serve --https="${web_port}" off 2>/dev/null || true

    # A failed nix-shell resolution must not hide the stop failure. `|| true`
    # neutralizes `set -e` on the assignment the same way `preview-tailnet`
    # does, and `2>&1` (not `2>/dev/null`) keeps the real nix error visible.
    # State remains private and marked either way; this recipe never deletes it.
    if [ -d "$pgdata" ]; then
        pg_bindir="$(nix-shell -p postgresql_16 --run 'dirname "$(command -v pg_ctl)"' 2>&1 | tail -n 1)" || true
        if [ -x "${pg_bindir}/pg_ctl" ] && "${pg_bindir}/pg_ctl" status -D "$pgdata" >/dev/null 2>&1; then
            "${pg_bindir}/pg_ctl" stop -D "$pgdata" -m fast -w >/dev/null 2>&1 || true
        elif [ ! -x "${pg_bindir}/pg_ctl" ]; then
            echo "preview-tailnet-down: could not resolve postgresql_16 to stop Postgres cleanly (nix-shell said: ${pg_bindir}) — retaining the cluster's private on-disk state." >&2
        fi
    fi

    bash scripts/preview-tailnet-state.sh cleanup "$root_dir" "$state_dir"
    echo "preview-tailnet-down: done — web/worker process-group stops attempted, tailscale serve mapping removal attempted, Postgres stop attempted; ${state_dir} retained for reuse."

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
check: preview-tailnet-state-contract-check production-health-contract-check secrets-scan-dir scan-endpoints leak-scan-tree leak-scan-src inhouse-package-parity lint typecheck discuss-drafts-validate naming-consent-hashes-verify skills-validate skills-check source-map-check db-check platform-bundles-check test-unit leak-scan-build
    @echo "All checks passed."

# Fail-closed state-path and non-destructive preservation contract for the operator-only tailnet preview.
preview-tailnet-state-contract-check:
    cd {{ root }} && bash scripts/preview-tailnet-state.test.sh

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
