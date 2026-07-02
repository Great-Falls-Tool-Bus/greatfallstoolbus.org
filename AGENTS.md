# Agent Notes — greatfallstoolbus.org

This file is the working contract for coding agents and LLMs operating in any
sister site spawned from this scaffold.

## GFTB Specifics

This spoke is the **Great Falls Tool Bus** public monorepo (see
`docs/decisions/0001-gftb-mvp-decisions.md` — the binding decision packet,
Linear TIN-2360). Non-negotiables beyond the scaffold contract: this repo holds
**zero secrets and zero cluster endpoints, ever** (public repo; sops+age
material lives blahaj-side under `tenants/great-falls-tool-bus/`); IaC here is
declare-only intent — apply authority is blahaj (mail/list/Anubis/DNS) and
`great-falls-tool-bus-infra` (runners, TIN-2299); never scaffold a runner or
bake a cache/executor endpoint; the five sewing-cell ASINs stay opaque until
operator-mediated resolution (never invent product names); all money-donation
copy stays recipient-neutral with no tax-deductibility claims until decision
row (h) is signed.

## Repo Role

This repo is **a static brand/project site under the Tinyland enterprise** —
one of many static projection consumers of the `tinyland.dev` authority
monolith. It is **not** an application backend. It does not own user data,
auth, payments, or business logic. Public content may later flow in through
reviewed static snapshots or runtime broker-display routes from `tinyland.dev`.

## Taxonomy Boundary

- Cross-repo repo-shape truth lives in
  `docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`.
- Static-spoke rules in this repo apply to scaffolded static projection
  consumers. Do not apply them wholesale to `tinyland.dev`, which is the
  mothership/content authority, or to MassageIthaca-shaped app repos that own
  runtime behavior.
- Org-wide rules still apply everywhere: clear `AGENTS.md`, reproducible
  Just/Nix entrypoints where commands exist, secrets scanning, GitHub-first CI,
  and no hidden prompt-only requirements.
- The desired convergence is a GloriousFlywheel-powered, Blahaj-routed GitOps
  path where repo shape is declarative and lane/reaper/public-preview plumbing
  is not duplicated per repo.

## Authoritative Entrypoints

- **DX/AX**: `Justfile` is the single source of truth for every operation.
  Always invoke through `just <recipe>`. Do not call `pnpm` / `vite` /
  `bazelisk` directly outside the Justfile unless adding a new recipe.
- **Shell**: `nix develop` (auto-loaded by `direnv`) — never assume host
  toolchain. CI runs `nix develop --command just <recipe>`.
- **Build**: `just build` produces a static `build/` (adapter-static).
- **Check**: `just check` runs sync + svelte-check.
- **SBOM**: `just sbom` generates local CycloneDX JSON and SPDX JSON artifacts
  under ignored `build/sbom/`.
- **Secrets scan**: `just secrets-scan-dir` scans the working tree;
  `just secrets-scan` scans git history. Both use `.gitleaks.toml`.

## Agent Skills & AX Traversables

- **Paste-to-agent adoption flow**: `docs/agent-adoption.md` is the DRY
  handoff for asking any coding agent to classify a Tinyland repo, map it to the
  enforceable layers, flag smells, preserve dirty worktrees, and patch toward
  conformance.
- **Canonical skill location**: `.agents/skills/<name>/SKILL.md`. Edit here.
- **Claude Code discovery**: `.claude/skills/<name>` is a symlink to
  `../../.agents/skills/<name>`. Do not author here — the symlink resolves
  automatically.
- **Plugin marketplace**: `.claude-plugin/marketplace.json` exposes
  `plugins/scaffold-core/` as a git-subdir-installable plugin. Other repos
  install via `/plugin marketplace add github:tinyland-inc/site.scaffold` then
  `/plugin install scaffold-core@site-scaffold`. Plugin skills are sibling
  symlinks under `plugins/scaffold-core/skills/` that resolve back to the
  canonical `.agents/skills/<name>`.
- **Published skills** (six):
  - `tinyland-whoami` — cold-landing repo-role classifier. Run via `just whoami`.
  - `tinyland-spawn-sister-site` — user-only; wraps the `gh repo create
    --template` + `scripts/rebrand.sh` ritual.
  - `tinyland-scaffold-doctor` — drift audit. Run via `just scaffold-doctor`.
  - `tinyland-repo-contract` — house-style baseline (Justfile/flake/gitleaks).
  - `tinyland-static-spoke` — per-spoke customization for static brand sites.
  - `tinyland-flywheel-bazel` — cache-first Bazel through GloriousFlywheel.
- **Validation**: `just skills-validate` checks every SKILL.md frontmatter for
  required fields and the Anthropic 1,536-char description cap. Wire into
  `just check` in any consuming repo that publishes its own skills.
- **Public agent index**: `static/llms.txt`, `static/agent-map.md`, and the
  `/agent` SvelteKit route. The `/agent` route renders skill bodies from
  `.agents/skills/*/SKILL.md` at build time — do not hand-edit the route to
  list skills; update the SKILL.md and rebuild.
- `tinyland.repo.json` is the machine-readable repo-shape manifest. It declares
  that this repo is a `static-spoke-scaffold`, not a mothership or stateful app.
- Durable operating truth belongs in repo files, schemas, tests, and Just
  recipes. Do not hide requirements only in prompt text.

## Bazel Posture

- Bazel exists for **module-graph integrity proofs**, cache-first package
  authority, and future RBE pipeline acceleration. The canonical app build
  remains `pnpm run build` until a spoke proves the matching Bazel target class.
- Registry order: `tinyland-inc/bazel-registry` first, then BCR.
- Local smoke: `just bazel-graph` may inspect module-graph health inside the
  Nix dev shell.
- Flywheel-backed build/test/fetch work goes through
  `scripts/gloriousflywheel-bazel.sh` or the `just flywheel-*` wrappers. The
  wrapper chooses cache-only vs executor-backed mode from validated environment;
  raw Bazel config flags are not the scaffold contract.
- In-house `@tummycrypt/*` / `@tinyland/*` npm dependencies are compatibility
  edges for pnpm/Vite until the static build moves fully under Bazel. Their
  versions must be exact and match the corresponding `bazel_dep` version.

## GloriousFlywheel Cache Enrollment (cache-first, TIN-2119)

- This spoke is **enrolled in the shared Bazel cache** via the `cache_backed`
  lane of `tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml` (pinned at
  `@v2.7.0`, `cache_backed: true`, `flywheel_config: flywheel`). The
  `flywheel-build` and `bazel-graph` jobs read the shared cache over the cluster
  substrate; `vite build` + `svelte-check` + `vitest` are wrapped as
  flywheel-eligible CAS-cacheable Bazel actions (`//:build`,
  `//:sveltekit_types`, `//:svelte_check_test`, `//:unit_tests`).
- **Do NOT create runners.** Enrollment attaches to the existing in-cluster
  `tinyland-nix` ARC pool. Hosted / repo-shaped runner fallback is rejected
  fail-closed by `scripts/cache-attachment-contract.sh`.
- **Do NOT treat raw `bazelisk build` as enrollment.** A green local-only build
  proves nothing. Real enrollment = the `--config=ci-cached` lane reading
  `$BAZEL_REMOTE_CACHE`, with `build:ci --disk_cache=` so a green build cannot be
  an incidental local-disk hit. The remote-cache hit/transfer lines in the
  cache-backed step's log are the real-attach proof.
- **Self-verify** before claiming enrollment: `just cache-contract-strict`
  (reads `enrollment.substrateMode` from `tinyland.repo.json` as the
  authoritative expected mode and fails closed on a declared-vs-actual mismatch).
- **CACHE-FIRST only** (TIN-1997 Option D): no remote executor is wired here.
  REAPI / executor-backed mode is classified but out of scope for this spoke.
  Cache attach is not an org-migration closure.

## Theme & Skeleton

- **Skeleton 4.15.2** (pinned). Do not upgrade casually.
- Tailwind v4 + the `skeletonTailwindV4Compat()` shim plugin in `vite.config.ts`
  rewrites `@variant` / `@apply variant-` to stable equivalents. Do not remove.
- Theme cascade lives in `src/app.css`. Per-site brand themes go under
  `src/lib/styles/themes/`.

## Projection And Broker Display

- This site is a **read-only consumer** of reviewed `tinyland.dev` content.
- `greatfallstoolbus.org` supports two read-only spoke modes:
  - **Static projection ingestion**: checked-in JSON artifacts validated at
    build time. This is the default for product, service, offer, and simple
    brand sites.
  - **Runtime broker display**: a static Cloudflare Pages shell fetches
    reviewed content from a public Tinyland broker route at runtime. This is
    the intended mode for blog/Pulse surfaces that need fresh posts, notes,
    media, or stream items without committing content payloads into the spoke.
- Runtime broker display still does not make the spoke an authority. The spoke
  may render public broker data, but it must not own writes, auth, private
  media, checkout, ActivityPub delivery, inboxes, followers, retries,
  tombstones, or moderation state.
- Use `just validate-static-projection <snapshot>` before trusting a copied
  snapshot.
- Use `just sync-static-projection <source> <target>` for generic static-spoke
  snapshots.
- Use `just pulse-ingest <source> <target>` for checked-in
  `PublicPulseSnapshot` files.
- These recipes validate static-spoke source authority, content hashes, Pulse
  M1 public shape, secret-shaped field absence, and optional Tinyland brand
  actor public-key readiness. When `--require-signature` is set, remote HTTPS
  snapshots must also carry a valid Tinyland HTTP Signature from the expected
  actor key. These recipes do not add auth, mutation APIs, checkout sessions,
  payment custody, ActivityPub delivery workers, or public Fediverse
  federation.
- `.github/workflows/pulse-ingest.yml` is allowed to open checked-in snapshot
  refresh PRs. It must not push directly to the default branch. It is not the
  runtime broker-display path.

## Per-Site Customization Checklist

After `gh repo create --template tinyland-inc/site.scaffold`:

1. `direnv allow`
2. `scripts/rebrand.sh <site.example.com>` — rewrites name strings, env vars,
   bazel cache name, etc.
3. Update `MODULE.bazel` `module(name = ...)` to underscored site name.
4. Update `README.md` / `AGENTS.md` with the per-site brand purpose.
5. Replace `src/routes/+page.svelte` with the brand landing page.
6. Set the GH repo description and homepage URL via `gh repo edit`.
7. Push first commit; verify CI green (secrets-scan, build-and-test, bazel-graph).

## What Not To Do

- Don't add runtime database / API server to a sister site. Keep it static.
- Don't fork tinyland-color-utils / tinyvectors / vite plugins per-site.
  Pin via the BCR.
- Don't add in-house npm package ranges or allow `package.json` to drift from
  `MODULE.bazel`; use `just inhouse-package-parity` or `just conformance`.
- Don't bypass `Justfile` in CI or local — DX/AX must stay homogenous.
- Don't unpin Skeleton or Tailwind v4-compat shim without coordination.

## Multi-Lane Posture

- The normative CI + lane contract is [`docs/CI-SCHEMA.md`](./docs/CI-SCHEMA.md).
  Read it before changing `.github/lanes.json`, `.github/workflows/*.yml`,
  any `tofu/` file, or any `flywheel-*` Justfile recipe.
- A spoke runs one or more **lanes** declared in `.github/lanes.json`. The
  default scaffold ships a single `default` lane; multi-trunk spokes
  (MassageIthaca-shaped) add more — up to 8.
- Lane edits are a one-file change. After editing `.github/lanes.json`,
  run `just lanes-validate` and `just conformance` before committing.
- A three-lane reference is checked in at `.github/lanes.example.json`
  (not loaded by CI — copy fields you need into `lanes.json`).

## Flywheel Binding

- The canonical spoke entrypoint is `scripts/gloriousflywheel-bazel.sh`, usually
  through `just flywheel-build`, `just flywheel-test`, or `just flywheel-fetch`.
  Do not call raw `bazelisk build/test/run` for cache-backed or executor-backed
  work.
- The advertised enrollment path is `just flywheel-enroll`, then
  `just flywheel-doctor`, then `just flywheel-verify`. These commands inspect
  the GloriousFlywheel fleet profile state and fail closed before agents run
  cache-backed Bazel.
- Endpoint authority is environment-driven, not `.bazelrc`-driven:
  - `GF_FLYWHEEL_PROFILE_STATE` records the fleet enrollment state:
    `unattached`, `shared-cache-backed`, `executor-backed`, or `local-proof`.
  - `BAZEL_REMOTE_CACHE` is required for Flywheel-backed Bazel work.
  - `GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed` means remote cache only.
  - `GF_BAZEL_SUBSTRATE_MODE=executor-backed` also requires
    `BAZEL_REMOTE_EXECUTOR`.
  - `GF_BAZEL_REMOTE_UPLOAD=true` is only for trusted default-branch or operator
    cache-writing jobs; pull requests remain read-only.
  - Optional auth material is runtime-only:
    `BAZEL_CREDENTIAL_HELPER`, `BAZEL_REMOTE_HEADER`,
    `BAZEL_REMOTE_CACHE_HEADER`, and `BAZEL_REMOTE_EXEC_HEADER` may be supplied
    by CI/operator environment and must not be committed.
  - `BAZEL_REMOTE_INSTANCE_NAME` is non-secret routing metadata. When present,
    the wrapper must pass it through as `--remote_instance_name` so the REAPI
    cell does not fall back to the `default` tenant.
  - `GF_BAZEL_JOBS` and `BAZEL_REMOTE_MAX_CONNECTIONS` are optional executor
    throttles for bounded proof lanes and small executor pools; they must come
    from runtime profile/operator context, not checked-in defaults.
- `.bazelrc.flywheel` is endpoint-free. It may hold safe Bazel behavior such as
  timeouts, download mode, worker platform hints, and `flywheel-eligible` tag
  filters, but it must not hard-code `remote_cache` or `remote_executor`.
- Proved-for-spoke target classes (mirrored from
  `tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json`):
  `sveltekit-app-build`, `sveltekit-unit-tests`,
  `deployment-bundle-packaging`, `docs-site-static-build`. Candidate
  (still rejected at runtime): `web-playwright-chromium-static-smoke`.
- Hard NOs: current RustFS is not trusted CAS/action-cache/publication authority
  until TIN-1147 proves repair or replacement; no OpenTofu RBE
  (`opentofu-validate`/`opentofu-fmt` are blocked); no developer-server RBE
  (`//app:dev` cannot run on REAPI); cache hits are not RBE.
- Local DX: `nix develop` for the toolchain. If `BAZEL_REMOTE_CACHE` is absent,
  Flywheel Bazel recipes fail fast instead of silently doing heavy local work.
  Use `just bazel-graph` for local module-graph inspection only.

## Testing & Browser-RBE Smoke Suite

Back-propagated from the `darkmap.phasi.space` spoke, which matured this surface
first. These are reusable directives; the example targets/scenarios are
illustrative, not scaffold content.

- **Remote-first.** Browserful Playwright e2e (and any server-bundle build) are
  remote-first. Locally use `just check` / `just ci-quick`; do **not** run
  browserful e2e locally unless explicitly gated (`LOCAL=1`). CI is the source of
  truth for browser regressions.
- **Browser-RBE smoke SUITE pattern.** Prefer one aggregate `test_suite`
  (`playwright_browser_rbe_smoke_suite`) wrapping **thin per-scenario `js_test`
  wrappers** that each set a `*_RBE_SMOKE_SCENARIO` env var and `await import()` a
  single shared orchestrator (server spawn + Chromium launch + network mocks +
  the scenario). One runner, N cheap wrappers. Two **load-bearing tag gotchas**:
  - `test_suite` `tags` are *filters*, not metadata — keep them to the shared tag
    set or the suite silently resolves to zero targets.
  - A target needs `tags = ["flywheel-eligible"]` or `--config=flywheel-executor`'s
    tag filter matches **zero** targets (a silent no-op). Add `manual` so bare
    `bazel test //...` doesn't run browserful work by accident.
  - `executor-backed` must force the remote spawn strategy and disable local
    fallback; cache hits or processwrapper/local execution are not RBE proof.
- **The proof cell has NO fonts and NO WebGL** (same as the gstack `/browse`
  headless cell). Consequences, learned the hard way:
  - The MapLibre/WebGL canvas **never paints** in CI — assert layout/DOM, not
    pixels. Text-only nodes render zero-size, so use Playwright
    `waitFor({ state: 'attached' })` + `textContent`/attributes, **not**
    `{ state: 'visible' }` or `.click()` on them.
  - **Click the map canvas at its own CENTER** — `canvas.click()` with **no**
    `position`. A viewport-relative `position` breaks once the map is inset
    (framed/gutter layouts): the click point falls outside the smaller canvas and
    times out as "not visible/stable". (Real regression caught only by the live
    proof, never by static review.)
  - **Trust the live browser-RBE proof over static analysis** for smoke impact —
    a static read of the smokes cannot see runtime actionability failures.
- **Font/WebGL-dependent visuals are CI-blind.** Verify them **locally** with a
  SwiftShader Chrome capture tool (`just capture-shipped-ui` →
  `scripts/capture-shipped-ui.mjs`): it serves the build and drives the system
  Chrome with `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`
  (+ real fonts) so the canvas actually renders for per-route screenshots. This is
  the only camera that can see a framed/gutter layout regression.
- **`root_lib_test` lists files explicitly — NO glob.** Top-level `src/lib/*.ts` +
  `*.test.ts` are enrolled by explicit label in `BUILD.bazel` (Bazel globs stop at
  sub-package boundaries, and aspect_rules_js rejects raw cross-package file
  labels). A new lib module + its test must be **added to both the `data` and
  `args` lists**; cross-package `$lib/...` sources are pulled in via a wrapping
  `js_library` in the root package. Forgetting this silently drops the test from
  the slice.

## Build target (adapter-static default; adapter-node is an opt-in escape hatch)

The scaffold default is **adapter-static → GitHub Pages** (cheap, DB-less, no edge
auth) and that is the house baseline for content/brand spokes. **adapter-node** is
a *sanctioned opt-in*, not the default — adopt it only when a spoke genuinely needs
a server: a secret-holding proxy, upstream normalization (e.g. ad-header stripping
/ bbox rewriting), or thin API routes the browser can't do safely. The
`darkmap.phasi.space` spoke is the adapter-node reference (it proxies + normalizes
an upstream GeoServer). A spoke that switches must also flip its deploy lane
(container build → server) and its smoke serve path (`node build/index.js` vs a
static file server) — keep both documented; never silently switch the default.

**Dynamic-spoke variant (adapter-node, flagged at spawn — TIN-2228).** Rather than
hand-rolling the static→node swap (the way `printstack`/TIN-1280 did), the swap is a
flagged mode IN this scaffold. `scripts/rebrand.sh` takes `--adapter=node|static`
(default `static`): `--adapter=node <domain>` jq-swaps the `@sveltejs/adapter-static`
devDependency for `@sveltejs/adapter-node`, rewrites `svelte.config.js` to
`adapterNode()` (dropping the `fallback`/`precompress`/`prerender` static-isms, keeping
runes + `BASE_PATH`), and stamps `taxonomy.spawned_repo_role = "app-stateful-spoke"`
in `tinyland.repo.json`. The edits are crash-safe (tmp+mv) and idempotent. The
rationale, role decision (reuse `app-stateful-spoke`, do not add a new enum), and
the static-vs-dynamic deploy lanes live in
[`docs/decisions/dynamic-spoke-adapter-mode.md`](docs/decisions/dynamic-spoke-adapter-mode.md)
and [`docs/decisions/dynamic-canary-blue-green.md`](docs/decisions/dynamic-canary-blue-green.md).
A dynamic spoke is `app-stateful-spoke`, so the static-spoke boundary block does NOT
constrain it — re-check `boundaries` in `tinyland.repo.json` after flipping.

**Deploy lane (default = GitHub Pages).** The shipped `.github/workflows/deploy-pages.yml`
deploys the static `build/` to **GitHub Pages** (`actions/upload-pages-artifact` +
`actions/deploy-pages`), built with `BASE_PATH="/<repo>"` for project-path hosting at
`https://<owner>.github.io/<repo>/`; `svelte.config.js` reads `base: process.env.BASE_PATH ?? ''`.
A **custom-domain** spoke adds its own `static/CNAME` and builds with `BASE_PATH=""` (root base) —
the scaffold ships **no** default `static/CNAME` (a wrong-domain marker is a DNS footgun).
**Cloudflare Pages** is a sanctioned opt-in for org/edge spokes (org-provisioned CF creds; Blahaj
owns the edge; spokes never hold long-lived CF creds) — copy-paste workflow in
[`docs/deploy/cloudflare-pages.md`](docs/deploy/cloudflare-pages.md). A spoke that switches deploy
lanes keeps docs + workflow + `svelte.config.js` `base` consistent (TIN-2230).

**Dynamic deploy lane.** A `--adapter=node` spoke does NOT use the Pages lane. Its
deploy is **blue/green via the Blahaj GitOps receiver** (build a server image →
stand up GREEN beside BLUE → health-gate GREEN cold → Blahaj flips ingress →
rollback = flip back to the still-warm BLUE). The static lane's safety is instead a
post-deploy **health-gate** on an atomic-publish host (rollback = re-publish the
prior artifact). Both lanes are designed in
[`docs/decisions/dynamic-canary-blue-green.md`](docs/decisions/dynamic-canary-blue-green.md)
(design-stage; no workflow/tofu wiring is shipped yet).

## Per-PR Ephemeral Envs

- Each PR provisions one ephemeral environment per declared lane via the
  `tinyland-inc/blahaj` GitHub App (`repository_dispatch` payload
  schema: `docs/schemas/blahaj-dispatch.schema.json`).
- DNS naming: `pr-{PR_NUMBER}-{LANE}.<spoke.domain>`.
- Image tag template: `pr-{PR_NUMBER}-sha-{COMMIT_SHA}` (override per
  spoke or per lane).
- TTL: default 72h. Per-PR raise via labels `lane-ttl/7d`,
  `lane-ttl/30d`, `lane-ttl/keep` (capped at 720h). Reap on PR close +
  hourly TTL backstop + manual `workflow_dispatch`. Reap is idempotent.
- Local dry-run: `just lane-dispatch <pr>` prints the payload Blahaj
  would receive; `just lane-reap <pr>` does the same for destroy (with
  a confirm prompt; `--dispatch` requires `REAP_CONFIRM=1`).

## Public Client Previews

- Tailnet PR lanes are the default. Public/client review URLs are explicit
  overlays requested through `docs/schemas/public-preview-dispatch.schema.json`.
- Default auth is Cloudflare Access One-time PIN with allowlisted emails or
  domains. Fully public routes require an explicit exception in the spoke's
  `AGENTS.md`.
- Spokes do not receive Cloudflare API credentials. Blahaj owns public DNS,
  Access app/policy creation, Tunnel ingress rules, and TTL cleanup.
- Do not recycle retired names such as `alpha` or `beta` for client previews.
  Use purpose-specific aliases such as `jen-preview.<domain>`.
- The current reference adoption tranche is documented in
  `docs/spec/massageithaca-pattern-backfeed-2026-05-19.md`; use it when
  updating this scaffold, `ci-templates`, Blahaj, or GloriousFlywheel to keep
  the pattern consistent across repos.

## Tofu Posture

- Per-spoke infrastructure lives in `tofu/`. The five spoke-facing
  modules come from `tinyland-inc/GloriousFlywheel/tofu/modules/spoke-*`
  pinned by version tag in `tofu/main.tf`.
- State backend is **operator-provisioned S3-compatible storage**, key
  `spokes/<spoke-slug>/terraform.tfstate`. In Tinyland today that storage plane
  is RustFS. Spokes must not hard-code provider endpoints; backend endpoint,
  credentials, retention, and restore behavior are environment/operator
  authority.
- Consumed modules (from `tinyland-inc/GloriousFlywheel@spoke-tofu-modules-v1.0.0`):
  - `spoke-state-namespace` — S3 prefix + reaper IAM.
  - `spoke-dns-pr-env` — wildcard CNAME `*.pr.<domain>`.
  - `spoke-cache-quota` — Attic + Bazel cache allocation.
  - `spoke-runner-binding` — runner-class ACL (hard-deny).
  - `spoke-blahaj-app-install` — Blahaj GitHub App binding.
- Required spoke inputs (in `tofu/spoke.auto.tfvars`): `spoke_slug`,
  `brand_domain`, `github_org`, `blahaj_installation_id`,
  `allowed_runner_classes`, `lane_allowlist`. `scripts/rebrand.sh`
  fills in `spoke_slug` and `brand_domain` on template instantiation.

## Conformance

- `just conformance` runs `scripts/check-conformance.sh` — the
  seventeen-item checklist in `docs/CI-SCHEMA.md` §12. A green run means
  the spoke is house-style compliant. MANUAL items (org ruleset,
  tailnet DNS) require operator verification outside this repo.
- This scaffold conforms to `docs/CI-SCHEMA.md` at the
  `tinyland-inc/site.scaffold` tag this clone was spawned from. Sister
  spokes that have not bumped past their original tag are not required
  to track schema changes until they explicitly upgrade.
