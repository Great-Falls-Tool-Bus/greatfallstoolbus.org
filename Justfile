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

# Run Vitest unit tests
test-unit:
    cd {{ root }} && pnpm run test:unit

# Validate the .svx tool-inventory tree (src/content/tools/**) frontmatter
tools-validate:
    cd {{ root }} && pnpm exec tsx scripts/validate-tools.mts

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

# Run secrets scan + lint + typecheck + tool-inventory + unit (pre-commit gate)
check: flywheel-enrollment-contract-check secrets-scan-dir lint typecheck tools-validate skills-validate skills-check test-unit
    @echo "All checks passed."

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

# House-style drift audit: layer 1 (existing checks) + layer 3 (boundary audit). Layer 2 (tag diff) is manual; see the skill body.
scaffold-doctor:
    @cd {{ root }} && echo "=== Layer 1: existing checks ===" && \
      just conformance && \
      just repo-manifest-validate && \
      just lanes-validate && \
      just inhouse-package-parity && \
      just scan-endpoints && \
      just secrets-scan-dir && \
      just bazel-graph && \
      echo "" && echo "=== Layer 3: authority-boundary audit ===" && \
      bash scripts/scaffold-doctor-boundary.sh

# Dry-run construct the Blahaj provision payload for a PR
lane-dispatch pr filter="all":
    cd {{ root }} && python3 scripts/lane-dispatch.py --pr {{ pr }} --filter "{{ filter }}"

# Dry-run construct the Blahaj destroy payload for a PR (set REAP_CONFIRM=1 + pass --dispatch to actually send)
lane-reap pr:
    @cd {{ root }} && read -p "Construct reap payload for PR #{{ pr }}? [y/N] " ans; [ "$ans" = "y" ] || { echo "aborted."; exit 1; }
    cd {{ root }} && python3 scripts/lane-dispatch.py --pr {{ pr }} --reap
    @echo "(dry-run; set REAP_CONFIRM=1 and pass --dispatch to actually send)"

# Run the spoke conformance checklist (docs/CI-SCHEMA.md §12)
conformance:
    cd {{ root }} && bash scripts/check-conformance.sh

# Verify @tummycrypt/@tinyland npm package versions match MODULE.bazel.
inhouse-package-parity:
    cd {{ root }} && python3 scripts/check-inhouse-package-parity.py

# ─────────────────────────────────────────────
# Flywheel (cache-first; executor opt-in; see docs/CI-SCHEMA.md §5)
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
# Tofu (spoke infrastructure; see tofu/README.md and docs/CI-SCHEMA.md §7)
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
