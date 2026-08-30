# greatfallstoolbus.org — SvelteKit static site task runner
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

# Install dependencies (frozen lockfile)
setup:
    cd {{ root }} && pnpm install --frozen-lockfile
    @echo "Setup complete. Run 'just dev' to start."

# Start the Vite dev server
dev:
    cd {{ root }} && pnpm run dev

# Start the dev server and open browser
dev-open:
    cd {{ root }} && pnpm run dev -- --open

# ─────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────

# Production static build (adapter-static -> build/). Runs the image
# pipeline first when static/photos has assets; otherwise the committed
# static/image-manifest.json fallback carries the build.
build: _optimize-images-if-photos
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
preview-only:
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
# buildx. nix/oci-image.nix stays as the nixpkgs-only fallback. The GF shared
# cache accelerates the SvelteKit build inputs; the image PUSH is never
# remote-execution eligible (`container-image-and-push` is blocked at the GF
# manifest layer — skill rule 8, docs/CI-SCHEMA.md §4). The default adapter-static
# build is untouched; only ADAPTER=node here selects adapter-node.
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
    # 1. adapter-node bundle (ADAPTER=node -> @sveltejs/adapter-node). The
    #    default adapter-static build path is never touched. build/ stays the
    #    GloriousFlywheel cache-accelerated input, imported into the image via
    #    APP_BUILD under `--impure`.
    #
    #    Build-time PUBLIC_* env: PUBLIC_ARCHIVE_LIVE=true bakes the /discuss
    #    archive go-live switch into THIS prod on-cluster image (TIN-2528 verified
    #    live). PUBLIC_* vars are inlined by Vite at build time
    #    (import.meta.env.PUBLIC_ARCHIVE_LIVE, src/lib/flags.ts), so the flag must
    #    be set on the build invocation — it cannot be flipped at container
    #    runtime. The deprecated CF Pages lane sets it in deploy-pages.yml; ADR
    #    0010 makes on-cluster the production host, so this image must carry it too
    #    to surface /discuss. Default `just build` (adapter-static) is left WITHOUT
    #    it on purpose.
    ADAPTER=node pnpm install --frozen-lockfile
    # BUG (TIN-2224 fallout): this recipe calls `pnpm run build` directly,
    # bypassing the default `build` recipe's dependency on
    # _optimize-images-if-photos. static/optimized/ is gitignored and only
    # ever populated by scripts/optimize-images.js, so the prod on-cluster
    # image shipped with zero optimized AVIF/WebP variants — 404ing the
    # homepage hero (great-falls-lewiston-1930s-xlarge.avif) and every other
    # photo's responsive renditions once adapter-node became the production
    # server. Mirror _optimize-images-if-photos's own guard here so container
    # images carry the same renditions the static build gets for free.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then \
        node scripts/optimize-images.js; \
    else \
        echo "No static/photos assets; keeping committed image-manifest fallback."; \
    fi
    # PUBLIC_BUILD_SHA carries the build commit into the client bundle (Vite
    # inlines it via import.meta.env, src/lib/build-info.ts) so the footer renders
    # a "built from <sha>" provenance link to this exact commit. Only the container
    # recipes set it — local / adapter-static builds leave it unset and the line
    # degrades to nothing.
    ADAPTER=node PUBLIC_ARCHIVE_LIVE=true PUBLIC_BUILD_SHA="${BUILD_COMMIT_SHA}" pnpm run build
    # 1b. The /bin/migrator payload (TIN-3817 S1) and the /bin/worker payload
    #     (TIN-3817 S3). Both land INSIDE build/ so they ride the same APP_BUILD
    #     import as the web server; the flake refuses to assemble an image
    #     without either rather than shipping a role that exits 70.
    just db-migrator-bundle
    just worker-bundle
    export APP_BUILD="$PWD/build"
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
container-image-build: platform-entrypoints-check
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
    # carry the same renditions the static build gets for free.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then \
        node scripts/optimize-images.js; \
    else \
        echo "No static/photos assets; keeping committed image-manifest fallback."; \
    fi
    # PUBLIC_ARCHIVE_LIVE=true so the local tarball matches the prod on-cluster
    # image (see container-image-publish); PUBLIC_* is build-time-inlined by Vite.
    # PUBLIC_BUILD_SHA bakes the build commit for the footer "built from <sha>"
    # provenance link (src/lib/build-info.ts).
    ADAPTER=node PUBLIC_ARCHIVE_LIVE=true PUBLIC_BUILD_SHA="${BUILD_COMMIT_SHA}" pnpm run build
    # The /bin/migrator (TIN-3817 S1) and /bin/worker (TIN-3817 S3) payloads;
    # see container-image-publish.
    just db-migrator-bundle
    just worker-bundle
    export APP_BUILD="$PWD/build"
    nix run --impure .#image.copyTo -- docker-archive:greatfallstoolbus-oci.tar
    echo "wrote greatfallstoolbus-oci.tar"

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
# SKIPS LOUDLY, exit 0, when no runtime DAEMON answers. The guard probes
# `<runtime> info`, not `command -v`: the docker CLI is present on the operator's
# macOS host while the daemon is not running, so a PATH-only guard reports a
# false positive and then fails deep inside the build. It FAILS HARD when a
# runtime does answer and an assertion does not hold, so these rows self-execute
# the moment a daemon exists — no further code change.
#
# WHICH IMAGE. By default this builds ContainerFile, the local docker/podman
# mirror of the image contract: it is the artifact a container runtime can
# actually execute here, and `docker build` needs no Nix remote builder. CI
# ships the nix2container artifact instead, which on a macOS host would contain
# Mach-O binaries the Linux runtime cannot exec — so to smoke the REAL published
# artifact, pass its ref:
#   GFTB_SMOKE_IMAGE=ghcr.io/great-falls-tool-bus/<repo>@sha256:… just container-image-smoke
# Prove the ASSEMBLED image: per-role --entrypoint --help, and id -u == 1001 (skips without a running daemon)
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
        echo "container-image-smoke: SKIP — no responding docker or podman daemon."
        echo "  S0's executed in-container rows (per-role --entrypoint --help, id -u == 1001)"
        echo "  stay CI-pending. The per-entrypoint CONTRACT is still proved daemonlessly by"
        echo "  'just platform-entrypoints-check', and the image CONFIG (User, Cmd) by"
        echo "  'nix build .#image'. Re-run on a host with a running container runtime."
        exit 0
    fi
    echo "container-image-smoke: using ${runtime}"

    ref="${GFTB_SMOKE_IMAGE:-}"
    if [ -z "$ref" ]; then
        ref="greatfallstoolbus.org:smoke"
        echo "container-image-smoke: building ${ref} from ContainerFile"
        "$runtime" build -f ContainerFile -t "$ref" .
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

    # ADR 0008 §3: the image runs non-root as uid/gid 1001. `id` comes from
    # busybox (ContainerFile image) or coreutils (nix images).
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
db-generate:
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
db-migrate *args:
    cd {{ root }} && pnpm exec tsx src/lib/server/db/migrate.ts {{ args }}

# Bundle the migrator for the platform image: one file, no node_modules.
# The production image carries build/ and package.json only (adapter-node
# inlines the web server's deps), so the migrator's single dependency — pg — is
# inlined the same way. The createRequire banner is required: pg is CommonJS and
# reaches node builtins through require(), which bare ESM output cannot do.
db-migrator-bundle:
    cd {{ root }} && pnpm exec esbuild src/lib/server/db/migrate.ts \
        --bundle --platform=node --format=esm --target=node22 \
        --outfile=build/migrator.mjs \
        --external:pg-native --external:cloudflare:sockets \
        --tsconfig-raw='{}' \
        --banner:js="import { createRequire as __gftbCreateRequire } from 'node:module'; const require = __gftbCreateRequire(import.meta.url);"
    @echo "wrote build/migrator.mjs (the /bin/migrator payload)"

# Bundle the outbox worker for the platform image (TIN-3817 S3): one file, no
# node_modules — same contract as db-migrator-bundle, same createRequire banner
# (pg is CommonJS), with drizzle-orm inlined alongside it.
worker-bundle:
    cd {{ root }} && pnpm exec esbuild src/lib/server/worker.ts \
        --bundle --platform=node --format=esm --target=node22 \
        --outfile=build/worker.mjs \
        --external:pg-native --external:cloudflare:sockets \
        '--alias:$lib=./src/lib' \
        --tsconfig-raw='{}' \
        --banner:js="import { createRequire as __gftbCreateRequire } from 'node:module'; const require = __gftbCreateRequire(import.meta.url);"
    @echo "wrote build/worker.mjs (the /bin/worker payload)"

# Compile the standalone payloads that the default Svelte/Vite build and
# current Bazel targets do not traverse.
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
# SKIPS LOUDLY, exit 0, when neither is available — the same guard shape as
# container-image-smoke, and for the same reason. The daemon probe is
# `<runtime> info` rather than `command -v`, because the docker CLI is present
# on the operator's macOS host while the daemon is not running.
test-integration *args:
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
        echo "test-integration: SKIP — no responding docker or podman daemon, and"
        echo "  GFTB_TEST_PG_SUPERUSER_DSN is unset."
        echo "  The RLS, advisory-lock, FORCE, and ledger-drift rows stay CI-PENDING."
        echo "  The tree-shaped half of those rows IS proved by 'just check'"
        echo "  (src/lib/server/db/{ledger,migrations,tenant}.test.ts)."
        echo "  Re-run with a container runtime, or point GFTB_TEST_PG_SUPERUSER_DSN"
        echo "  at a PostgreSQL 16 superuser connection."
        exit 0
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

    # 8. No committed seed path exists yet (grepped scripts/ and
    #    src/lib/server/**: nothing but the integration suite's in-process
    #    seedTenant/seedOutboxJob fixtures). Print the minimal tenant +
    #    keyholder grant an operator can paste, rather than invent a new
    #    committed seed mechanism this lane was not asked to own.
    seed_tenant_id="$(node -e 'console.log(crypto.randomUUID())')"
    seed_person_id="$(node -e 'console.log(crypto.randomUUID())')"

    # 9. Build (adapter-node) and launch web + worker as separate long-lived
    #    background processes. Mirrors the ADAPTER=node guard
    #    container-image-build/-publish already run before their build.
    if [ -d static/photos ] && [ -n "$(ls -A static/photos 2>/dev/null)" ]; then
        node scripts/optimize-images.js
    fi
    ADAPTER=node pnpm install --frozen-lockfile
    ADAPTER=node pnpm run build

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
    echo "  No tenant is seeded yet. To exercise the member-v0 routes as a keyholder,"
    echo "  seed a minimal tenant + keyholder grant against this preview's runtime DSN"
    echo "  and export GFTB_TENANT_ID before re-running (skip this if you already did"
    echo "  it on an earlier run — the same Postgres cluster persists across re-runs)."
    echo "  This connects password-less on purpose: trust auth on this loopback-only"
    echo "  cluster never checks it (step 4 above), so nothing credential-shaped is"
    echo "  printed here."
    echo ""
    echo "    ${pg_bindir}/psql \"${runtime_dsn_display}\" -c \"select set_config('app.tenant_id', '${seed_tenant_id}', false)\" -c \"insert into tenant (tenant_id, slug, display_name) values ('${seed_tenant_id}', 'preview-tailnet', 'Preview Tailnet Tenant')\" -c \"insert into member_role_grant (tenant_id, person_id, role, granted_by) values ('${seed_tenant_id}', '${seed_person_id}', 'keyholder', '${seed_person_id}')\""
    echo ""
    echo "    export GFTB_TENANT_ID=${seed_tenant_id}"
    echo "    just preview-tailnet   # re-run; the worker will now dispatch for this tenant"
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
typecheck:
    cd {{ root }} && pnpm run check

# ESLint flat config across the repo
lint:
    cd {{ root }} && pnpm run lint

# Prettier write
format:
    cd {{ root }} && pnpm run format

# Prettier check (no writes)
format-check:
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
test-unit:
    cd {{ root }} && pnpm run test:unit

# [OPERATOR, local-only] Regenerate src/lib/naming-consent.hashes.json from
# ~/.gftb/naming-consent.plain, keyed by ~/.gftb/naming-consent.key (created
# automatically, mode 0600, on first run) — neither file is ever committed
# or lives inside any repo. See scripts/generate-naming-consent-hashes.mjs
# for the format and the security rationale, and
# docs/runbooks/discuss-to-svx-pipeline.md for the full design this backs.
naming-consent-hashes:
    cd {{ root }} && pnpm exec tsx scripts/generate-naming-consent-hashes.mjs

# [OPERATOR, local-only] Drift gate: recomputes the committed hash list from
# ~/.gftb/naming-consent.plain + ~/.gftb/naming-consent.key and diffs it
# against the committed src/lib/naming-consent.hashes.json. Skips loudly
# (exit 0) when either operator-local file is absent — e.g. in CI, where
# this is expected and not a failure. Wired into `just check`.
naming-consent-hashes-verify:
    cd {{ root }} && pnpm exec tsx scripts/verify-naming-consent-hashes.mjs

# Stage one already-redacted keyholders@ export as a published:false
# discuss-drafts .svx. NEVER sends mail. Usage:
#   just discuss-to-svx -- --input path/to/export.json
# See docs/runbooks/discuss-to-svx-pipeline.md.
discuss-to-svx *args:
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
discuss-drafts-validate:
    cd {{ root }} && pnpm exec tsx scripts/validate-discuss-drafts.mts

# Ensure local Playwright browser cache exists; CI uses Nix Chromium instead
playwright-ensure:
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      echo "Using Nix chromium from the Playwright dev shell"; \
    else \
      pnpm exec playwright install chromium; \
    fi

# Run Playwright E2E tests
test-e2e: playwright-ensure
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      nix develop .#playwright --command pnpm run test:e2e; \
    else \
      pnpm run test:e2e; \
    fi

# Install Playwright browser binaries
playwright-install browser="chromium":
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
check: preview-tailnet-state-contract-check flywheel-enrollment-contract-check production-health-contract-check secrets-scan-dir scan-endpoints leak-scan-tree leak-scan-src lint typecheck discuss-drafts-validate naming-consent-hashes-verify skills-validate skills-check source-map-check db-check platform-bundles-check test-unit leak-scan-build
    @echo "All checks passed."

# Fail-closed state-path and non-destructive preservation contract for the operator-only tailnet preview.
preview-tailnet-state-contract-check:
    cd {{ root }} && bash scripts/preview-tailnet-state.test.sh

# CI-only exact Bazel-label proof. RUNNER_TEMP is preferred, but only when its
# physical path is outside both HOME roots and has acceptable custody. ARC may
# place RUNNER_TEMP under account HOME, so root-owned sticky /var/tmp or /tmp is
# the bounded fallback. The selected parent receives one uid-owned 0700 child,
# passed as TEST_TMPDIR and removed only by non-recursive rmdir when empty.
# Shared-cache reads are allowed; cache writes and remote execution are not.
preview-tailnet-state-contract-bazel:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    canonical_dir() {
        local input="$1"
        [[ -n "$input" && "$input" == /* && -d "$input" ]]
        (cd -P -- "$input" && pwd -P)
    }
    within() {
        local candidate="$1" parent="$2"
        [[ "$candidate" == "$parent" || "$candidate" == "$parent"/* ]]
    }
    owner_mode() {
        case "$(uname -s)" in
            Darwin) stat -f '%u %Lp' "$1" ;;
            *) stat -c '%u %a' "$1" ;;
        esac
    }
    env_home="$(canonical_dir "${HOME:?HOME is required}")"
    account_home_raw="$(python3 -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
    account_home="$(canonical_dir "$account_home_raw")"
    repo_real="$(canonical_dir "$PWD")"
    uid="$(id -u)"
    proof_parent=""
    for candidate in "${RUNNER_TEMP:-}" /var/tmp /tmp; do
        [[ -n "$candidate" && -d "$candidate" ]] || continue
        candidate_real="$(canonical_dir "$candidate")"
        [[ "$candidate_real" != / ]] || continue
        ! within "$candidate_real" "$env_home" || continue
        ! within "$candidate_real" "$account_home" || continue
        ! within "$candidate_real" "$repo_real" || continue
        [[ -w "$candidate_real" && -x "$candidate_real" ]] || continue
        read -r owner mode <<<"$(owner_mode "$candidate_real")"
        mode="${mode#0}"
        [[ "$owner" =~ ^[0-9]+$ && "$mode" =~ ^[0-7]{3,4}$ ]] || continue
        mode_value=$((8#${mode}))
        if [[ "$owner" == "$uid" ]]; then
            (( (mode_value & 0022) == 0 )) || continue
        else
            [[ "$owner" == 0 ]] || continue
            (( (mode_value & 01000) != 0 )) || continue
        fi
        proof_parent="$candidate_real"
        break
    done
    [[ -n "$proof_parent" ]] || {
        echo "preview-tailnet-state-contract-bazel: no allowed temp base outside HOME/account HOME/repository" >&2
        exit 70
    }
    proof_tmp="$(mktemp -d "${proof_parent}/gftb-preview-state-contract.XXXXXX")"
    chmod 700 "$proof_tmp"
    rc=0
    GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed \
      GF_BAZEL_REMOTE_UPLOAD=false \
      BAZEL_REMOTE_EXECUTOR= \
      bash scripts/gloriousflywheel-bazel.sh test \
        --test_tmpdir="$proof_tmp" \
        --test_env=GFTB_EXPECTED_TEST_TMP_ROOT="$proof_tmp" \
        --test_env=HOME="$env_home" \
        --nocache_test_results \
        --test_output=errors \
        //:preview_tailnet_state_contract_test || rc=$?
    rmdir -- "$proof_tmp" 2>/dev/null || true
    exit "$rc"

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
validate-static-projection snapshot spoke="" actor="" require_signature="":
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts validate "{{ snapshot }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# Copy a reviewed Tinyland static projection snapshot into this repo after validation
sync-static-projection source target spoke="" actor="" require_signature="":
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts sync "{{ source }}" "{{ target }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# Alias for static Pulse snapshot ingestion; still produces a checked-in JSON file only
pulse-ingest source target spoke="" actor="" require_signature="":
    cd {{ root }} && args=(scripts/static-projection-snapshot.mts sync "{{ source }}" "{{ target }}" --expected-source-authority tinyland.dev); \
      if [ -n "{{ spoke }}" ]; then args+=(--expected-spoke "{{ spoke }}"); fi; \
      if [ -n "{{ actor }}" ]; then args+=(--actor-document "{{ actor }}" --expected-actor-id "{{ actor }}" --expected-actor-key-id "{{ actor }}#main-key"); fi; \
      if [ "{{ require_signature }}" = "true" ]; then args+=(--require-signature); fi; \
      pnpm exec tsx "${args[@]}"

# ─────────────────────────────────────────────
# Lanes (PR-env multi-trunk; see docs/CI-SCHEMA.md)
# ─────────────────────────────────────────────

# Print resolved lanes as a table
lanes-list:
    @cd {{ root }} && jq -r '"NAME\tTRIGGER\tRUNNER\tE2E\tTHEME"' .github/lanes.json
    @cd {{ root }} && jq -r '.lanes[] | [.name, (.trigger // "pull_request"), (.runner_class // "(default)"), (.e2e // false | tostring), .theme] | @tsv' .github/lanes.json | column -t -s $'\t'

# Validate .github/lanes.json against docs/schemas/lanes.schema.json
lanes-validate:
    cd {{ root }} && python3 scripts/validate-lanes.py

# Validate tinyland.repo.json against docs/schemas/tinyland-repo-manifest.schema.json
repo-manifest-validate:
    cd {{ root }} && python3 scripts/validate-lanes.py --schema docs/schemas/tinyland-repo-manifest.schema.json --instance tinyland.repo.json

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
skills-build:
    cd {{ root }} && pnpm exec tsx scripts/build-agent-skills.mjs

# Drift guard: regenerate derived skills, then fail if the tree changed.
skills-check: skills-build
    cd {{ root }} && git diff --exit-code -- .agents/skills .claude/skills static/llms.txt

# Derive the page source map (route id -> repo-relative +page.svelte) that
# SourceLink.svelte reads to render the "View source" / "Edit this page" affordance.
source-map-build:
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

# Run the spoke conformance checklist (docs/CI-SCHEMA.md §11), then the
# GFTB-local addendum (scripts/check-conformance-local.sh) that restores the
# two local-only items the wholesale scaffold re-ingest doesn't carry.
# Both run even if the first fails, so a red ingested check never suppresses
# the local addendum's own report; the recipe fails if either script does.
conformance:
    #!/usr/bin/env bash
    set -uo pipefail
    cd {{ root }}
    rc1=0; bash scripts/check-conformance.sh || rc1=$?
    rc2=0; bash scripts/check-conformance-local.sh || rc2=$?
    [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ]

# Verify @tummycrypt/@tinyland npm package versions match MODULE.bazel.
inhouse-package-parity:
    cd {{ root }} && python3 scripts/check-inhouse-package-parity.py

# ─────────────────────────────────────────────
# Flywheel (cache-first; executor opt-in; see docs/CI-SCHEMA.md §4)
# Env contract:
#   GF_FLYWHEEL_PROFILE_STATE names the fleet enrollment state.
#   BAZEL_REMOTE_CACHE is required for Flywheel-backed Bazel work.
#   GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed selects remote cache only.
#   GF_BAZEL_SUBSTRATE_MODE=executor-backed also requires BAZEL_REMOTE_EXECUTOR.
#   GF_BAZEL_REMOTE_UPLOAD=true is only for trusted cache-writing jobs.
# ─────────────────────────────────────────────

# Advertised enrollment front door. Does not mint tokens; uses the
# GloriousFlywheel fleet profile or an ignored local fallback.
flywheel-enroll *args:
    cd {{ root }} && bash scripts/flywheel-enroll.sh {{ args }}

# Cold-landing diagnostic: explain what env an agent needs before flywheel-build/test
flywheel-doctor:
    cd {{ root }} && bash scripts/flywheel-doctor.sh

# Fail-closed enrollment verifier for agents and CI.
flywheel-verify:
    cd {{ root }} && bash scripts/flywheel-verify.sh

# Prove the advertised enroll/doctor/verify contract stays wired.
flywheel-enrollment-contract-check:
    cd {{ root }} && bash scripts/flywheel-enrollment-contract-test.sh

# Self-verify shared-cache enrollment (TIN-2119): assert this repo is genuinely
# attached to the shared Bazel cache, fail-closed. Mirrors the spoke-ci.yml
# cache_backed lane gate. Reads enrollment.substrateMode from tinyland.repo.json
# as the authoritative expected mode and feeds runner labels so hosted / repo-
# shaped fallback is rejected. CACHE-FIRST only; no executor.
cache-contract-strict:
    cd {{ root }} && \
      GF_BAZEL_SUBSTRATE_MODE="$(jq -r '.enrollment.substrateMode // "shared-cache-backed"' tinyland.repo.json)" \
      GF_BAZEL_RUNNER_LABELS="${GF_BAZEL_RUNNER_LABELS:-tinyland-nix}" \
      bash scripts/cache-attachment-contract.sh --strict

# Validate cache attachment and print Bazel info through the wrapper
flywheel-info:
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh info

# Bazel build via flywheel (defaults to static SvelteKit build target)
flywheel-build target="//:build":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh build {{ target }}

# Bazel test via flywheel
flywheel-test target="//:ci_validation_suite":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh test {{ target }}

# Bazel run via flywheel
flywheel-run target:
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh run {{ target }}

# Bazel coverage via flywheel
flywheel-coverage target="//:unit_tests":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh coverage {{ target }}

# Populate external repositories through the same cache/input-authority contract
flywheel-fetch target="//...":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh fetch {{ target }}

# Remote lint + typecheck + format as CACHE-FIRST, READ-ONLY Bazel tests
# (TIN-2226). Routes eslint / prettier / svelte-check through the
# GloriousFlywheel wrapper with --config=ci-cached: cache-first, read-only (no
# cache-WRITE, TIN-1147), shared-cache-backed only — it never selects an
# executor (TIN-1997 Option D), so it is safe everywhere including off-cluster.
# The endpoint stays env authority (BAZEL_REMOTE_CACHE); this recipe bakes none.
# Off-cluster (no BAZEL_REMOTE_CACHE) the wrapper fails fast and honestly instead
# of doing heavy local work or claiming RBE. Cache hits are NOT executor proof.
#
# Cache-first read-only remote lint + typecheck + format (eslint/prettier/svelte-check).
flywheel-check *targets="//:eslint_test //:prettier_check_test //:svelte_check_test":
    cd {{ root }} && \
      GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed \
      GF_BAZEL_REMOTE_UPLOAD=false \
      BAZEL_REMOTE_EXECUTOR= \
      bash scripts/gloriousflywheel-bazel.sh test --config=ci-cached {{ targets }}

# Executor canary — OPT-IN, CLUSTER-ONLY (TIN-2226). Forces a REAL remote
# execution on --config=flywheel-executor and FAILS-CLOSED unless it can prove
# nonzero remotely-executed processes plus a CAS/cache round-trip. It REFUSES on
# ubuntu-latest and any hosted / bare-self-hosted / non-cluster runner because
# cache hits are NOT executor proof. Off-cluster (no BAZEL_REMOTE_EXECUTOR or no
# tinyland cluster runner-class label) it refuses up front — it never silently
# "passes". Requires real executor enrollment: BAZEL_REMOTE_EXECUTOR + matching
# BAZEL_REMOTE_CACHE + a tinyland capability-class label in GF_BAZEL_RUNNER_LABELS.
#
# Opt-in, cluster-only executor canary; fails-closed off-cluster / on ubuntu-latest.
flywheel-runner-selftest target="//:eslint_test":
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}

    refuse()     { echo "flywheel-runner-selftest: REFUSE — $1" >&2; exit 3; }
    fail_proof() { echo "flywheel-runner-selftest: FAIL — $1"   >&2; exit 4; }

    # 1. Hosted-runner guard. The canary must never pass on ubuntu-latest.
    if [[ "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]]; then
      refuse "running on a GitHub-hosted runner (RUNNER_ENVIRONMENT=github-hosted); executor proof is impossible here."
    fi
    labels="${GF_BAZEL_RUNNER_LABELS:-}"
    is_cluster=0
    for l in ${labels//,/ }; do
      case "$l" in
        tinyland-nix|tinyland-nix-heavy|tinyland-nix-kvm|tinyland-nix-gpu|tinyland-docker|tinyland-dind)
          is_cluster=1 ;;
        ubuntu-*|ubuntu|windows-*|windows|macos-*|macos)
          refuse "hosted runner label '$l' (e.g. ubuntu-latest). Cache hits are not executor proof." ;;
        self-hosted)
          refuse "bare 'self-hosted' label carries no cluster capability class." ;;
      esac
    done
    if [[ "$is_cluster" -ne 1 ]]; then
      refuse "no tinyland cluster capability-class label in GF_BAZEL_RUNNER_LABELS='${labels:-<unset>}' (need tinyland-nix[-heavy|-kvm|-gpu] / tinyland-docker / tinyland-dind)."
    fi

    # 2. Executor enrollment guard — fail-closed off-cluster.
    [[ -n "${BAZEL_REMOTE_EXECUTOR:-}" ]] || refuse "BAZEL_REMOTE_EXECUTOR is unset; the executor self-test cannot run off-cluster."
    export GF_BAZEL_SUBSTRATE_MODE=executor-backed
    export GF_BAZEL_REMOTE_UPLOAD=false

    # 3. Deep fail-closed gate: full executor contract (cluster runner class,
    #    matching cache==executor, REAPI proof image digest). Read-only — runs
    #    no Bazel actions; just asserts the substrate contract holds.
    GF_BAZEL_SUBSTRATE_MODE=executor-backed bash scripts/cache-attachment-contract.sh --strict

    # 4. Bounded declared-output canary: force a remote spawn and capture the
    #    execution log as a declared artifact.
    log="$(mktemp "${TMPDIR:-/tmp}/flywheel-runner-selftest.XXXXXX.json")"
    trap 'rm -f "$log"' EXIT
    bash scripts/gloriousflywheel-bazel.sh test --config=flywheel-executor \
      --execution_log_json_file="$log" \
      --remote_max_connections="${BAZEL_REMOTE_MAX_CONNECTIONS:-8}" \
      "{{ target }}"

    # 5. Proof: nonzero REMOTELY-executed processes + a CAS/cache round-trip.
    #    A cache hit has runner "remote cache hit" and is excluded on purpose —
    #    cache hits are NOT executor proof.
    command -v jq >/dev/null 2>&1 || fail_proof "jq is required to verify the execution log."
    remote_exec="$(jq -rs '[.[] | select(.runner == "remote")] | length' "$log" 2>/dev/null || echo 0)"
    cache_get="$(jq -rs '[.[] | select(.remoteCacheHit == true)] | length' "$log" 2>/dev/null || echo 0)"
    total="$(jq -rs 'length' "$log" 2>/dev/null || echo 0)"
    echo "flywheel-runner-selftest: remote_exec=${remote_exec} cache_get=${cache_get} spawns=${total}"
    if [[ "${total:-0}" -lt 1 ]]; then
      fail_proof "empty execution log; no CAS/cache round-trip observed."
    fi
    if [[ "${remote_exec:-0}" -lt 1 ]]; then
      fail_proof "0 remotely-executed processes (cache_get=${cache_get}). Cache hits are not executor proof."
    fi
    echo "flywheel-runner-selftest: PASS — ${remote_exec} remote-executed process(es), ${cache_get} cache GET hit(s)."

# Remote dev server — v1.1+ stub (see ci-templates/docs/roadmap.md)
dev-remote lane="default":
    @echo "dev-remote is a v1.1+ stub. Dev servers are explicitly blocked from REAPI"
    @echo "(GloriousFlywheel/config/rbe-target-eligibility.json), so a cluster-side"
    @echo "pnpm dev tunnel requires the lane-preview-tunnel composite action which"
    @echo "ships in ci-templates v1.1+. Track at: tinyland-inc/ci-templates/docs/roadmap.md"
    @exit 2

# Set CI_TEMPLATES_DIR=../ci-templates to rehearse against a local checkout
# before a release tag exists.
# Sync vendored .bazelrc.flywheel from a pinned ci-templates release.
sync-flywheel-bazelrc tag="v2.9.0":
    #!/usr/bin/env bash
    set -euo pipefail

    tag="{{ tag }}"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT

    if [[ -n "${CI_TEMPLATES_DIR:-}" ]]; then
      src="${CI_TEMPLATES_DIR%/}/bazelrc/flywheel.bazelrc"
      if [[ ! -f "$src" ]]; then
        echo "CI_TEMPLATES_DIR does not contain bazelrc/flywheel.bazelrc: $src" >&2
        exit 1
      fi
      cp "$src" "$tmp"
      source_label="$src"
    else
      if [[ "$tag" == v1.* ]]; then
        echo "Refusing to sync v1.x Flywheel bazelrc fragments; use v2.0.0 or newer." >&2
        exit 2
      fi
      if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9._-]+)?$ || "$tag" =~ ^[0-9a-f]{40}$ ]]; then
        echo "tag must be a vMAJOR.MINOR.PATCH release or a full 40-character SHA; got $tag" >&2
        exit 2
      fi

      gh api \
        -H "Accept: application/vnd.github.raw" \
        "/repos/tinyland-inc/ci-templates/contents/bazelrc/flywheel.bazelrc?ref=${tag}" \
        > "$tmp"
      source_label="tinyland-inc/ci-templates@${tag}:bazelrc/flywheel.bazelrc"
    fi

    if grep -Eq -- '--remote_cache=|--remote_executor=|--remote_upload_local_results=true|grpcs?://' "$tmp"; then
      echo "Refusing endpointful or upload-authorizing Flywheel bazelrc from $source_label" >&2
      exit 1
    fi

    if cmp -s "$tmp" .bazelrc.flywheel; then
      echo ".bazelrc.flywheel already matches $source_label"
    else
      install -m 0644 "$tmp" .bazelrc.flywheel
      echo "synced .bazelrc.flywheel from $source_label"
    fi

# ─────────────────────────────────────────────
# Tofu (spoke infrastructure; see tofu/README.md and docs/CI-SCHEMA.md §8)
# ─────────────────────────────────────────────

# Initialize the OpenTofu backend + download modules. Backend creds via AWS_* env.
tofu-init:
    cd {{ root }}/tofu && tofu init -upgrade

# Generate a plan
tofu-plan:
    cd {{ root }}/tofu && tofu plan -out=tfplan

# Apply the previously-generated plan
tofu-apply:
    cd {{ root }}/tofu && tofu apply tfplan

# Format-check (read-only)
tofu-fmt-check:
    cd {{ root }}/tofu && tofu fmt -check -diff

# Validate without contacting the backend. If an upstream module tag is
# unavailable or private to the current environment, keep fmt-check as
# the local gate and let cluster CI prove full module resolution.
tofu-validate:
    @cd {{ root }}/tofu && tofu fmt -check -diff && \
      if tofu init -backend=false -input=false >/dev/null 2>&1; then \
        tofu validate; \
      else \
        echo "[tofu-validate] module fetch failed; fmt-check passed"; \
      fi

# ─────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────

# Sync SvelteKit types
sync:
    cd {{ root }} && pnpm exec svelte-kit sync

# Build with bundle analyzer (emits .bundle-stats/stats.html treemap)
analyze:
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

# Install git hooks (no-op if scripts/hooks/pre-commit absent)
install-hooks:
    @if [ -f {{ root }}/scripts/hooks/pre-commit ]; then \
      ln -sf ../../scripts/hooks/pre-commit {{ root }}/.git/hooks/pre-commit && echo "Git hooks installed."; \
    else \
      echo "No scripts/hooks/pre-commit yet — skipping."; \
    fi

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
