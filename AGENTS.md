# Agent Notes: greatfallstoolbus.org

This file is the working contract for coding agents and LLMs operating in the
Great Falls Tool Bus platform repository and in the scaffold surfaces it still
carries.

## Agent Coordination (multi-session)

Multiple agent sessions (any provider or runtime) may work these repos in
parallel. Rules, learned from a real duplicate-work collision (PRs #43/#47
duplicated merged #44/#37 on 2026-07-04):

1. **One lead session holds merge authority.** Other sessions propose only:
   open PRs, never merge, never close another session's PR. The operator
   designates the lead; as of 2026-07-04 the lead is the operator's primary
   interactive session.
2. **Before starting a lane: sync main and scan open PRs** (`git pull`,
   `gh pr list`). If an open PR or fresh main commit already covers your
   task, extend it or stand down; do not build a parallel solution.
3. **Branch naming declares the session**: use a session prefix
   (`codex/...`, `feat/...` from the lead, etc.) so provenance is legible.
4. **File fences win.** If a PR or issue names files another lane owns,
   do not touch them; note the handoff instead.
5. Generated artifacts (`.agents/skills/gftb-mail-laceup-*`, `static/llms.txt`
   mail section) are owned by `just skills-build`; edit the source
   (`src/lib/data/mail-clients.ts`), never the outputs.

### How we work: active-dialog + goal-ladder cadence (operator ruling 2026-08-29)

When the operator is present and co-working, the coordinator session — which
is the lead session of rule 1 above, not a second authority — runs an
active-dialog loop rather than batch-and-report. Everything below governs HOW
that lead works; rule 1 still governs WHO may merge:

- **Operator dialog = the interview tool** (AskUserQuestion or equivalent) at
  every genuine decision point — batched into few interviews, never blocking
  running lanes; decided-by-default still governs (an interview is for
  decisions primary sources cannot answer, and its rulings are recorded to
  the durable board immediately).
- **Agent dialog = intra-agent chat** (SendMessage or equivalent): peer seats
  (e.g. the GF estate seat) get interlock requests with concrete asks and
  get their constraints folded into lane briefs; lanes get resumable,
  self-contained briefs and report back measured evidence.
- **Goal ladders carry four horizons** — next 2h / next 4h / this
  afternoon-or-evening / end-of-day — each row Linear-linked with its SLA,
  under assumed massive agent parallelization (mythos delegation: fable
  coordinates only; sonnet builds/recons; opus refutes; per-lane model set
  explicitly).
- **Session SLOs** (conditions the lead's own merges must meet — never a
  grant of merge authority to another lane): merges only SHA-guarded on
  adversarial LAND-class
  verdicts; push→verdict ≤ 90 min; parked/killed lane rescue ≤ 15 min;
  double-green where a known flake lives; zero signing bypasses; zero
  consent-gate bypasses; a durable board receipt within 15 min of every
  landing.
- SSOT for the full doctrine: `prompts-enqueue` —
  `context/house-active-dialog-cadence.md` (this cadence),
  `context/house-agent-conventions.md` (the org-wide AX/DX contract), and
  `patterns/multi-agent-orchestration.md` (orchestrator/spawn/verification
  method). Model-tiering authority is `Jesssullivan/prompt-toon`
  `policy/delegation.json` (TIN-2698); `context/house-model-routing.md` is a
  retired stub — do not cite it. This section is the repo-local binding.

## GFTB Specifics

This spoke is the **Great Falls Tool Bus** public monorepo (see
`docs/decisions/0001-gftb-mvp-decisions.md`, the binding decision packet,
Linear TIN-2360), promoted to the platform role under TIN-3815 / ADR 0014 —
see "Repo Role" below for what that widens and what it does not.
Non-negotiables beyond the scaffold contract: this repo holds
**zero secrets and zero cluster endpoints, ever** (public repo; sops+age
material lives in the org apply-plane overlay `great-falls-tool-bus-infra`
under its `secrets/` lane); IaC here is declare-only intent, apply authority
is `great-falls-tool-bus-infra` (mail/list/Anubis/DNS apply + runners,
TIN-2299; packet 0001 Amendment 1 / memo 0002, blahaj is replaceable
substrate consumed by reference); never scaffold a runner or
bake a cache/executor endpoint; the five sewing-cell ASINs stay opaque until
operator-mediated resolution (never invent product names); all money-donation
copy stays recipient-neutral with no tax-deductibility claims until decision
row (h) is signed.

## Repo Role

This repo is the **Great Falls Tool Bus platform**: an `app-stateful-spoke`
(TIN-3815, ADR 0014). It owns member, contact, payment, and inventory behavior
— runtime routes, domain state, schema and migrations, and the one immutable
image that carries the `web`, `worker`, and `migrator` process boundaries.

What it still does **not** own, and must never acquire: secret values, cluster
credentials, kubeconfigs, DNS or edge mutation, and GitOps apply. Those stay in
`great-falls-tool-bus-infra`, the sole apply plane. Runtime *references* are
fine; a change that appears to need a secret or an endpoint has found an infra
hand-off, not a code change. Public page copy and `.svx` logs belong to the
separate `gftb-site` microsite, not here.

**Naming and visibility are operator-gated (ADR 0014 §0.1).** The `gftb-platform`
slug rename and the visibility flip are sequenced behind operator proofs
(private CI, package pull, rollback) and are not part of any code slice. Until
the change is observed, keep using the current slug and **do not describe this
repository as private or renamed** in code, comments, docs, or image refs.

## Taxonomy Boundary

- Cross-repo repo-shape truth lives in
  `docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`.
- Static-spoke rules retained in this repo apply to its **scaffold/template
  surfaces** and to sister sites spawned from them — not to the platform's own
  runtime behavior, which is app-stateful by declaration. Do not apply them
  wholesale to `tinyland.dev`, which is the mothership/content authority.
- The app-stateful role widens what this repo may own; it does not relax the
  apply-plane boundary above. `just conformance` enforces exactly that: an
  `app-stateful-spoke` manifest must set `owns_runtime_backend: true` and leave
  `owns_gitops_apply` and `owns_cloudflare_mutation` false.
- Org-wide rules still apply everywhere: clear `AGENTS.md`, reproducible
  Just/Nix entrypoints where commands exist, secrets scanning, GitHub-first CI,
  and no hidden prompt-only requirements.
- The desired convergence is a GloriousFlywheel-powered, Blahaj-routed GitOps
  path where repo shape is declarative and lane/reaper/public-preview plumbing
  is not duplicated per repo. **This describes mechanism layer B (the
  gated-convergence chain), which meta ADR
  `decisions/0020-adopt-production-convergence-contract-2026-08-21.md` §2
  tracks but does NOT adopt** — its GFTB carrier (TIN-2611) is Backlog behind
  seven unmet prerequisites, and the *dispatch* shape this bullet names is
  what `converge-agent.md` §3 forbids outright once GFTB declares a carrier
  under mechanism A. See the "Per-PR Ephemeral Envs" and "Tofu Posture"
  sections ~375 lines below for the current, superseded-and-stamped state of
  the Blahaj-routed path specifically.

## Authoritative Entrypoints

- **DX/AX**: `Justfile` is the single source of truth for every operation.
  Always invoke through `just <recipe>`. Do not call `pnpm` / `vite` /
  `bazelisk` directly outside the Justfile unless adding a new recipe.
- **Shell**: `nix develop` (auto-loaded by `direnv`), never assume host
  toolchain. CI runs `nix develop --command just <recipe>`.
- **Build**: `just build` with no `ADAPTER` set produces a static `build/`
  (adapter-static). That default is the local/CI fallback ADR 0010 Amendment 1
  item 2 requires; the image recipes select adapter-node explicitly.
- **Image entrypoints**: `just platform-entrypoints-check` runs the exact
  derivations the image installs at `/bin/web`, `/bin/worker`, and
  `/bin/migrator`. It needs no container daemon, so it is the per-entrypoint
  proof to run locally. `just container-image-smoke` proves the *assembled*
  image instead (per-role `--entrypoint … --help`, in-container `id -u` = 1001);
  it skips with a message when no container daemon answers.
- **Database (Member v0, TIN-3817 S1)**: `just db-generate` regenerates the
  checked-in migration SQL and its hash manifest; `just db-check` refuses a
  drifted tree, an edited committed migration, or a recipe that reaches for
  `drizzle push`, and rides inside `just check`; `just db-migrate` runs the
  real migrator against `$DATABASE_URL` (a runtime *name* — the value belongs
  to `great-falls-tool-bus-infra`); `just db-migrator-bundle` builds the
  `/bin/migrator` payload the image ships. Migrations are forward-only: an
  applied file's hash is immutable, and changing one fails closed rather than
  reapplying.
- **Integration tests**: `just test-integration` runs the testcontainers-backed
  PostgreSQL 16.15 suite (RLS, `FORCE`, advisory lock, ledger drift, runtime
  role grants). It **skips loudly, exit 0, when no container daemon answers** —
  this org's ARC pool advertises only `tinyland-nix` and has no dind runner, so
  those rows are CI-pending, not merely flaky. The tree-shaped half of the same
  properties is proved by `just check`.
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
  `../../.agents/skills/<name>`. Do not author here, the symlink resolves
  automatically.
- **Plugin marketplace**: `.claude-plugin/marketplace.json` exposes
  `plugins/scaffold-core/` as a git-subdir-installable plugin. Other repos
  install via `/plugin marketplace add github:tinyland-inc/site.scaffold` then
  `/plugin install scaffold-core@site-scaffold`. Plugin skills are sibling
  symlinks under `plugins/scaffold-core/skills/` that resolve back to the
  canonical `.agents/skills/<name>`.
- **Published skills** (six):
  - `tinyland-whoami`, cold-landing repo-role classifier. Run via `just whoami`.
  - `tinyland-spawn-sister-site`, user-only; wraps the `gh repo create
    --template` + `scripts/rebrand.sh` ritual.
  - `tinyland-scaffold-doctor`, drift audit. Run via `just scaffold-doctor`.
  - `tinyland-repo-contract`, house-style baseline (Justfile/flake/gitleaks).
  - `tinyland-static-spoke`, per-spoke customization for static brand sites.
  - `tinyland-flywheel-bazel`, cache-first Bazel through GloriousFlywheel.
- **Validation**: `just skills-validate` checks every SKILL.md frontmatter for
  required fields and the Anthropic 1,536-char description cap. Wire into
  `just check` in any consuming repo that publishes its own skills.
- **Public agent index**: `static/llms.txt`, `static/agent-map.md`, and the
  `/agent` SvelteKit route. The `/agent` route renders skill bodies from
  `.agents/skills/*/SKILL.md` at build time, do not hand-edit the route to
  list skills; update the SKILL.md and rebuild.
- `tinyland.repo.json` is the machine-readable repo-shape manifest. It declares
  this repo an `app-stateful-spoke` and keeps GitOps/edge authority external.
- Durable operating truth belongs in repo files, schemas, tests, and Just
  recipes. Do not hide requirements only in prompt text.

## Bazel Posture

- Bazel is the **graph of record** for module integrity, cache-first
  package authority, Flywheel acceleration, and all first-party package
  ingestion. TIN-2881 graph-links the six `@tummycrypt/*` public `:pkg` targets
  from Bzlmod; `package.json` and `pnpm-lock.yaml` carry no first-party source
  edge.
- Registry order: `tinyland-inc/bazel-registry` first, then BCR.
- Node-compatible Just entrypoints (`setup`, Vite/check/test, and image build
  lanes) run `just _house-hydrate` to materialize those graph outputs into
  `node_modules`. A graph-key stamp prevents a stale pre-cutover npm directory
  from satisfying hydration.
- Flywheel-backed build/test/fetch work still goes only through
  `scripts/gloriousflywheel-bazel.sh` or the `just flywheel-*` wrappers. Their
  endpoint authority remains environment-driven; `.bazelrc.flywheel` remains
  endpoint-free. Hydration is layout materialization, not RBE proof.
- `just inhouse-package-parity` enforces zero `@tummycrypt/*` / `@tinyland/*`
  npm specifiers plus complete `bazel_dep` ↔ `npm_link_package :pkg` edges.

## GloriousFlywheel Cache Enrollment (cache-first, TIN-2119)

- This spoke is **enrolled in the shared Bazel cache** via the `cache_backed`
  lane of `tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml` (pinned at
  `@v2.9.0`, `cache_backed: true`, `flywheel_config: flywheel`). The
  `flywheel-build` and `bazel-graph` jobs read the shared cache over the cluster
  substrate; `vite build` + `svelte-check` + `vitest` are wrapped as
  flywheel-eligible CAS-cacheable Bazel actions (`//:build`,
  `//:sveltekit_types`, `//:svelte_check_test`, `//:unit_tests`).
  Naming note: `flywheel-test` is the template's matrix name for the
  Node-compatible `just check` lane; it may hydrate first-party Bzlmod packages
  before pnpm-based checks. Cache-attached Bazel proof still lives in
  `flywheel-build` / `bazel-graph`.
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
2. `scripts/rebrand.sh <site.example.com>`, rewrites name strings, env vars,
   bazel cache name, etc.
3. Update `MODULE.bazel` `module(name = ...)` to underscored site name.
4. Update `README.md` / `AGENTS.md` with the per-site brand purpose.
5. Replace `src/routes/+page.svelte` with the brand landing page.
6. Set the GH repo description and homepage URL via `gh repo edit`.
7. Push first commit; verify CI green (secrets-scan, build-and-test, bazel-graph).

## What Not To Do

- Don't add a runtime database / API server to a **sister site** spawned from
  these scaffold surfaces, or to the `gftb-site` microsite. Keep those static.
  This platform repo may own that behavior; it still may not own cluster apply,
  edge credentials, or secret values.
- Don't fork tinyland-color-utils / tinyvectors / vite plugins per-site.
  Pin their modules through `tinyland-inc/bazel-registry`.
- Don't add any in-house npm source specifier. Keep every first-party
  `bazel_dep` graph-linked through `npm_link_package :pkg`; verify with
  `just inhouse-package-parity` or `just conformance`.
- Don't bypass `Justfile` in CI or local, DX/AX must stay homogenous.
- Don't unpin Skeleton or Tailwind v4-compat shim without coordination.

## Multi-Lane Posture

- The normative CI + lane contract is [`docs/CI-SCHEMA.md`](./docs/CI-SCHEMA.md).
  Read it before changing `.github/lanes.json`, `.github/workflows/*.yml`,
  any `tofu/` file, or any `flywheel-*` Justfile recipe.
- A spoke runs one or more **lanes** declared in `.github/lanes.json`. The
  default scaffold ships a single `default` lane; multi-trunk spokes
  (MassageIthaca-shaped) add more, up to 8.
- Lane edits are a one-file change. After editing `.github/lanes.json`,
  run `just lanes-validate` and `just conformance` before committing.
- A three-lane reference is checked in at `.github/lanes.example.json`
  (not loaded by CI, copy fields you need into `lanes.json`).

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
  - `test_suite` `tags` are *filters*, not metadata, keep them to the shared tag
    set or the suite silently resolves to zero targets.
  - A target needs `tags = ["flywheel-eligible"]` or `--config=flywheel-executor`'s
    tag filter matches **zero** targets (a silent no-op). Add `manual` so bare
    `bazel test //...` doesn't run browserful work by accident.
  - `executor-backed` must force the remote spawn strategy and disable local
    fallback; cache hits or processwrapper/local execution are not RBE proof.
- **The proof cell has NO fonts and NO WebGL** (same as the gstack `/browse`
  headless cell). Consequences, learned the hard way:
  - The MapLibre/WebGL canvas **never paints** in CI, assert layout/DOM, not
    pixels. Text-only nodes render zero-size, so use Playwright
    `waitFor({ state: 'attached' })` + `textContent`/attributes, **not**
    `{ state: 'visible' }` or `.click()` on them.
  - **Click the map canvas at its own CENTER**, `canvas.click()` with **no**
    `position`. A viewport-relative `position` breaks once the map is inset
    (framed/gutter layouts): the click point falls outside the smaller canvas and
    times out as "not visible/stable". (Real regression caught only by the live
    proof, never by static review.)
  - **Trust the live browser-RBE proof over static analysis** for smoke impact, a static read of the smokes cannot see runtime actionability failures.
- **Font/WebGL-dependent visuals are CI-blind.** Verify them **locally** with a
  SwiftShader Chrome capture tool (`just capture-shipped-ui` →
  `scripts/capture-shipped-ui.mjs`): it serves the build and drives the system
  Chrome with `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`
  (+ real fonts) so the canvas actually renders for per-route screenshots. This is
  the only camera that can see a framed/gutter layout regression.
- **`root_lib_test` lists files explicitly, NO glob.** Top-level `src/lib/*.ts` +
  `*.test.ts` are enrolled by explicit label in `BUILD.bazel` (Bazel globs stop at
  sub-package boundaries, and aspect_rules_js rejects raw cross-package file
  labels). A new lib module + its test must be **added to both the `data` and
  `args` lists**; cross-package `$lib/...` sources are pulled in via a wrapping
  `js_library` in the root package. Forgetting this silently drops the test from
  the slice.

## Build target (adapter-static fallback default; adapter-node chosen explicitly)

The scaffold default is **adapter-static** (cheap, DB-less, no edge auth) and that
is the house baseline for content/brand spokes. **adapter-node** is a
*sanctioned opt-in*, adopt it only when a spoke genuinely needs a server: a
secret-holding proxy, upstream normalization (e.g. ad-header stripping / bbox
rewriting), or thin API routes the browser can't do safely. The
`darkmap.phasi.space` spoke is the adapter-node reference (it proxies + normalizes
an upstream GeoServer). A spoke that switches must also flip its deploy lane
(container build → server) and its smoke serve path (`node build/index.js` vs a
static file server), keep both documented; never silently switch the default.

**Here, adapter-node is the served artifact but NOT the no-`ADAPTER` default
(TIN-3815 S0).** The platform is served by adapter-node, and every image recipe
sets `ADAPTER=node` explicitly (`ContainerFile`, `just container-image-build`,
`just container-image-publish`). `svelte.config.js` keeps its adapter-static
default on purpose: ADR 0010 Amendment 1 item 2 retains adapter-static as "a
local/CI fallback build (`just build` with no `ADAPTER` set stays green against
the frozen lockfile, so the default gates never regress)". Flipping that default
would amend a standing ADR as a side effect. If the operator later wants it
flipped, that is a one-paragraph erratum against Amendment 1 item 2, raised on
its own.

**Dynamic-spoke variant (adapter-node, flagged at spawn, TIN-2228).** Rather than
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
constrain it, re-check `boundaries` in `tinyland.repo.json` after flipping.

**Deploy lane (GFTB = on-cluster, `adapter-node`).** ADR 0010
([`docs/decisions/0010-on-prem-is-the-production-host.md`](docs/decisions/0010-on-prem-is-the-production-host.md),
executed 2026-07-06, Amendment 2 2026-07-07) retired the Cloudflare Pages
opt-in this section used to describe: `.github/workflows/deploy-pages.yml` has
been removed. Production now serves on-cluster behind the `cloudflared` tunnel
— `adapter-node` -> OCI image (`.github/workflows/container-ghcr.yml` -> GHCR)
-> K8s Deployment in `great-falls-tool-bus-infra`. This public repo still
never stores CF credentials or edge-apply authority; Blahaj/the org overlay
own DNS, Access, Tunnel, and the image pin.

**This repo publishes; it does not deploy (TIN-3899).** `container-ghcr.yml`
used to carry a `signal-cd` job that resolved the pushed `@sha256` digest and
fired a `repository_dispatch` (`web-image-published`) at the overlay's
`web-stack.yml`, which then applied it — continuous deployment on merge-to-main.
Both ends are retired: the overlay workflow is deleted and the signal job is
gone, so a push to `main` builds and publishes an image and stops there. No
`INFRA_CD_DISPATCH_TOKEN` is consumed, and nothing in this repository can mutate
the live Deployment. Production changes are an attended, reviewed release in the
overlay. Cloudflare Pages is not just
retired — the project itself is **deleted** (ADR 0010 Amendment 2, TIN-2560:
the operator closed the rollback window early, 2026-07-06, rather than holding
it warm to ~2026-07-08) — see
[`docs/deploy/cloudflare-pages.md`](docs/deploy/cloudflare-pages.md)
(historical) and
[`docs/runbooks/cf-pages-rollback.md`](docs/runbooks/cf-pages-rollback.md)
(why its rollback procedure no longer applies; rollback is now an attended
on-cluster re-plan/re-apply of the overlay's reviewed release chain with the
previous digest — the infra `web-stack.yml` dispatch this line used to name was
retired by TIN-3899). The
scaffold default remains GitHub Pages for personal/static spokes; GFTB's
history of overrides is ADR 0003 (Cloudflare Pages) then ADR 0010
(on-cluster, Pages deleted).

**Dynamic deploy lane.** A `--adapter=node` spoke does NOT use the Pages lane. Its
deploy is **blue/green via the Blahaj GitOps receiver** (build a server image →
stand up GREEN beside BLUE → health-gate GREEN cold → Blahaj flips ingress →
rollback = flip back to the still-warm BLUE). The static lane's safety is instead a
post-deploy **health-gate** on an atomic-publish host (rollback = re-publish the
prior artifact). Both lanes are designed in
[`docs/decisions/dynamic-canary-blue-green.md`](docs/decisions/dynamic-canary-blue-green.md)
(design-stage; no workflow/tofu wiring is shipped yet).

## Per-PR Ephemeral Envs — SUPERSEDED, see meta ADR 0020

> **SUPERSEDED (2026-08-21).** The `tinyland-inc/blahaj` GitHub App
> `repository_dispatch` receiver this section describes was deleted 2026-08-05
> (PR #1255 / `813ef8c0`, operator ruling: "fully remove, these are
> application infra substrate that should not live in blahaj"). Nothing
> execution-shaped has replaced it estate-wide. Reading this section in the
> present tense is the exact failure mode
> `org-standard-cd-pattern-truth-20260821.md` C6/D21 names: an agent's first
> read is the superseded pattern. CD authority for GFTB now routes through
> `meta` ADR `decisions/0020-adopt-production-convergence-contract-2026-08-21.md`
> (Great-Falls-Tool-Bus/meta#34, DRAFT — operator merges); the
> preview-environment companion decision is
> `great-falls-tool-bus-infra` ADR `docs/decisions/0003-preview-cd-authority-companion-2026-08-21.md`
> (great-falls-tool-bus-infra#125, DRAFT). The ratified interim is a tailnet
> preview (`tailscale serve`, `just preview-tailnet`); the ratified target is
> `staging.greatfallstoolbus.org` promote-on-PR after the infra apply
> sitting. The text below is retained per the no-silent-rewrite convention —
> it describes the scaffold's generic Per-PR Ephemeral Envs shape, which this
> repository does not currently run.

- Each PR provisions one ephemeral environment per declared lane via the
  `tinyland-inc/blahaj` GitHub App (`repository_dispatch` payload
  schema: `docs/schemas/blahaj-dispatch.schema.json`).
- DNS naming: `pr-{PR_NUMBER}-{LANE}.<spoke.domain>`.
- Image tag template: `pr-{PR_NUMBER}-sha-{COMMIT_SHA}` (override per
  spoke or per lane).
- TTL: default 72h. Per-PR raise via labels `lane-ttl/7d`,
  `lane-ttl/30d`, `lane-ttl/keep` (capped at 720h). Reap on PR close +
  hourly TTL backstop + manual `workflow_dispatch`. Reap is idempotent.
- Historical local dry-run: `just lane-dispatch <pr>` and
  `just lane-reap <pr>` constructed these payloads. TIN-489 removed both
  recipes and `scripts/lane-dispatch.py` after the receiver disappeared.
- `.github/workflows/lane-env.yml` was the fail-open sender for this retired
  path and has also been removed. `docs/schemas/blahaj-dispatch.schema.json`
  records the historical payload contract only.

## Public Client Previews — SUPERSEDED, see meta ADR 0020

> **SUPERSEDED (2026-08-21).** Same failure mode as the two stamped sections
> around this one (C6/D21: an agent's first read is the superseded pattern) —
> missed in the first stamping pass, closed here. "Public/client review URLs
> are explicit overlays requested through
> `docs/schemas/public-preview-dispatch.schema.json`" describes a dispatch
> receiver in the same evicted `tinyland-inc/blahaj` GitHub App family as
> "Per-PR Ephemeral Envs" above — and the freshly re-ingested
> `docs/CI-SCHEMA.md` (current, this same PR) states plainly that "the former
> Blahaj lane, reaper, and public-preview dispatch schemas are removed" and
> preserved only in git history, not an execution contract. GFTB CD authority
> routes through `meta` ADR
> `decisions/0020-adopt-production-convergence-contract-2026-08-21.md`
> (Great-Falls-Tool-Bus/meta#34, DRAFT) and the preview companion
> `great-falls-tool-bus-infra` ADR
> `docs/decisions/0003-preview-cd-authority-companion-2026-08-21.md`
> (great-falls-tool-bus-infra#125, DRAFT) from here forward. The text below
> is retained per the no-silent-rewrite convention.

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

## Tofu Posture — SUPERSEDED, see meta ADR 0020

> **SUPERSEDED (2026-08-21).** `spoke-state-namespace` below is the module
> the current site.scaffold `docs/CI-SCHEMA.md` §8 (as re-ingested into this
> repo in the same change as this stamp) calls "the retired
> state-namespace/env-reaper IAM module." GFTB's actual per-spoke `tofu/`
> wiring and its relationship to the org-standard production-convergence
> carrier are governed by `meta` ADR
> `decisions/0020-adopt-production-convergence-contract-2026-08-21.md`
> (Great-Falls-Tool-Bus/meta#34, DRAFT) from here forward, not by this
> section. This repository owns no gitops apply
> (`tinyland.repo.json` `boundaries.owns_gitops_apply=false`); actual `tofu/`
> state for GFTB's workloads lives in `great-falls-tool-bus-infra`, whose own
> preview-authority companion decision is
> `docs/decisions/0003-preview-cd-authority-companion-2026-08-21.md`
> (great-falls-tool-bus-infra#125, DRAFT). The text below is retained per the
> no-silent-rewrite convention as the scaffold's generic Tofu Posture shape;
> confirm current module pins against `great-falls-tool-bus-infra` before
> relying on the specifics.

- Per-spoke infrastructure lives in `tofu/`. The five spoke-facing
  modules come from `tinyland-inc/GloriousFlywheel/tofu/modules/spoke-*`
  pinned by version tag in `tofu/main.tf`.
- State backend is **operator-provisioned S3-compatible storage**, key
  `spokes/<spoke-slug>/terraform.tfstate`. In Tinyland today that storage plane
  is RustFS. Spokes must not hard-code provider endpoints; backend endpoint,
  credentials, retention, and restore behavior are environment/operator
  authority.
- Consumed modules (from `tinyland-inc/GloriousFlywheel@spoke-tofu-modules-v1.0.0`):
  - `spoke-state-namespace`, S3 prefix + reaper IAM.
  - `spoke-dns-pr-env`, wildcard CNAME `*.pr.<domain>`.
  - `spoke-cache-quota`, Attic + Bazel cache allocation.
  - `spoke-runner-binding`, runner-class ACL (hard-deny).
  - `spoke-blahaj-app-install`, Blahaj GitHub App binding.
- Required spoke inputs (in `tofu/spoke.auto.tfvars`): `spoke_slug`,
  `brand_domain`, `github_org`, `blahaj_installation_id`,
  `allowed_runner_classes`, `lane_allowlist`. `scripts/rebrand.sh`
  fills in `spoke_slug` and `brand_domain` on template instantiation.

## Conformance

- `just conformance` runs **two** scripts, always both: the ingested
  `scripts/check-conformance.sh` (the checklist in `docs/CI-SCHEMA.md` §11,
  byte-identical to `site.scaffold`), then `scripts/check-conformance-local.sh`
  (GFTB-specific items with no scaffold equivalent — see that file's own
  header for why it's separate rather than patched into the ingested one). A
  green run on both means the spoke is house-style compliant. MANUAL items
  (org ruleset, required status checks) require operator verification
  outside this repo.
- **Known-red rows, as of this re-ingest** — see each script's own comments
  for the full account; this is the pointer, not the duplicate: the
  ingested script's role gate, `validate-substrate-boundary.py`,
  `test-production-convergence-contract.py`, and
  `modules/converge_agent/tests/test_converge_agent_contract.py` rows are
  expected red (scaffold gates this repo doesn't carry yet; see
  `scripts/check-conformance.sh`'s own numbered comments for which). The
  local addendum's two rows (endpoint leak scan, `app-stateful-spoke` role)
  are expected **green** — if either goes red, treat it as a real finding,
  not scaffold drift.
- This scaffold conforms to `docs/CI-SCHEMA.md` at `tinyland-inc/site.scaffold`
  commit `8659dcd7702524697220c5c2e79d6096921f4b84` (`origin/main`,
  2026-08-18), re-ingested 2026-08-21. `site.scaffold`'s actual `v0.3.0` git
  tag points at an earlier commit (`5c6b8bc5`, 2026-07-08) that predates
  every `docs/patterns/*` document this re-ingest exists to reach, by 94
  commits — no tag currently covers `8659dcd7` (meta ADR 0020 §1 has the
  full derivation).
- **`tinyland.repo.json`'s `scaffold_tag` field holds that same SHA, not
  `v0.3.0`, on purpose.** The field's schema (`docs/schemas/tinyland-repo-manifest.schema.json`)
  types it as a bare non-empty string with no tag-shape pattern, and
  `tinyland-scaffold-doctor`'s Layer 2 reads it only to run
  `git checkout "$SCAFFOLD_TAG"` against a `site.scaffold` clone — a
  40-hex SHA is exactly as valid there as a tag name, so this keeps the
  doctor chain green. The two rejected alternatives: stamping the literal
  string `v0.3.0` would be false about the ingested bytes on this ADR's own
  evidence (the tag does not cover the commit); adding a sibling
  `scaffold_sha` field would fail conformance item 0 outright, since the
  manifest schema sets `additionalProperties: false` at the top level and
  editing that schema is its own re-ingest-scope decision, not this PR's.
  Re-pin to a real covering tag (`v0.3.1`+, a proper tag string again) once
  `site.scaffold` cuts one, per the ask meta ADR 0020 §1 already makes.
- **`config/production-convergence.json` is deliberately absent, not
  merely default.** GFTB does not converge yet and is not declaring a
  carrier. The scaffold's own contract test
  (`scripts/test-production-convergence-contract.py`,
  `test_declaring_neither_carrier_fails`) treats a declaration file that
  exists but names zero or two carriers as a **violation**, not an opt-out
  — only a *missing* file reads as "out of scope, the template-repository
  default" (`production-convergence.md:144-148`). There is no third,
  schema-legal "consciously declared non-converging" shape: any file with
  an `armed`/`enabled`/comment-only body and no `carrier_workflow` or
  `carrier_resource` key fails the same way an empty `{}` does. Given that,
  writing the file would turn a currently-invisible, correctly-out-of-scope
  product into a mechanically FAILING one for no doctrinal gain — so this
  repository stays in the silent-absence state and records the reasoning
  here instead, per meta ADR 0020 §8/§10 and
  `org-standard-cd-pattern-truth-20260821.md` §3.4 item 4's own instruction
  to "choose consciously and record which." Re-open this note once GFTB
  adopts a real carrier (ADR 0020 §2) or once `site.scaffold` grows a
  legitimate declared-non-converging shape, whichever comes first.

## GFTB SSOT grounding (binding; pointers only — content lives at each SSOT)

Ground every change in these authorities and cite the specific section/ticket
in the PR's Authority table. Reviews check citation-conformance first.
Decisions are decided-by-default: search these before writing "open question".

- meta `Great-Falls-Tool-Bus/meta` @ origin/main (ALWAYS fetch; stale local
  checkouts have produced false not-founds):
  - `spec/launch-member-v0-system-2026-08-16.md` — the contract (application
    §4, contribution §5, tool custody §8, forms §10).
  - `spec/member-v0-executable-slices-2026-08-18.md` — the slice map.
  - `decisions/0014`, `decisions/0015` — ratified ADRs (repo split §1,
    inventory pilot §7).
  - `diagrams/launch-member-v0/*.mmd` — the design ontology
    (inventory-custody-flow = the tool-flow authority).
- Linear: initiative "Great Falls Tool Bus — Launch" + document "GFTB launch
  operating map" (milestone spine, SLAs, WIP rule live THERE). Custody lane:
  TIN-3814/3847/3848; TIN-3498 blocks TIN-3502. Read issue descriptions AND
  comment threads.
- Standing operator rulings (recorded in meta/Linear; one-line tripwires):
  vocabulary application/intake (never enrollment/ingest/catalog/steward);
  Maine/TIN-3905 operator-only; bus permanently parked; membership state
  never changes on payment events; no path ever auto-charges a member.
