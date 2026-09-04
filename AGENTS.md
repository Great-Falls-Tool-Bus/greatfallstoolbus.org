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
- **Surfacing rule** (operator-derived 2026-09-03; SSD rulings addendum (e)):
  ratifications, agendas, todos, and review items reach the operator in
  exactly one of two forms — decisions via the interview feature
  (AskUserQuestion decision briefs); read/LOOK items opened in the operator's
  Chrome as tabs. Never prose status lists with shell-command fallbacks;
  never GUI `open` (fleet guard). Printing via printstack remains the
  annotation route. The claude-in-chrome prohibition is scoped to agent
  browsing/QA (gstack supersedes there); operator-attended LOOK tab-opening
  is the sanctioned exception.
- SSOT for the full doctrine: `prompts-enqueue` —
  `context/house-active-dialog-cadence.md` (this cadence plus the surfacing
  rule; created by Jesssullivan/prompts-enqueue#205 — the pointer was dangling
  before that PR landed),
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
is `great-falls-tool-bus-infra` (mail/list/Anubis/DNS apply + execution demand,
TIN-2299; packet 0001 Amendment 1 / memo 0002; provider supply and placement are
opaque here); never scaffold a runner or
bake a cache/executor endpoint; the five sewing-cell ASINs stay opaque until
operator-mediated resolution (never invent product names); all money-donation
copy stays recipient-neutral with no tax-deductibility claims until decision
row (h) is signed.

## Repo Role

This repo is the **Great Falls Tool Bus platform**: an `app-stateful-spoke`
(TIN-3815, ADR 0014). It owns member, contact, payment, and inventory behavior
— runtime routes, domain state, schema and migrations, and the one immutable
deployment bundle carrying the `web`, `worker`, and `migrator` process
boundaries for qualified owner publication.

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

- Cross-repo repo-shape truth is the exact site.scaffold v2 schema carried at
  `docs/schemas/tinyland-repo-manifest.v2.schema.json`; this repository carries
  only its consumer instance.
- Static-spoke rules retained in this repo apply to its **scaffold/template
  surfaces** and to sister sites spawned from them — not to the platform's own
  runtime behavior, which is app-stateful by declaration. Do not apply them
  wholesale to `tinyland.dev`, which is the mothership/content authority.
- The app-stateful role widens what this repo may own; it does not relax the
  apply-plane boundary above. `just conformance` enforces exactly that: an
  `app-stateful-spoke` manifest must set `owns_runtime_backend: true` and leave
  `owns_gitops_apply` and `owns_cloudflare_mutation` false.
- Org-wide rules still apply everywhere: clear `AGENTS.md`, reproducible
  Just/Nix entrypoints where commands exist, secrets scanning, v4 action CI,
  and no hidden prompt-only requirements.

## Authoritative Entrypoints

- **DX/AX**: `Justfile` is the single source of truth for every operation.
  Always invoke through `just <recipe>`. Do not call `pnpm` / `vite` /
  `bazelisk` directly outside the Justfile unless adding a new recipe.
- **Shell**: `nix develop` (auto-loaded by `direnv`), never assume host
  toolchain. CI runs `nix develop --command just <recipe>`.
- **Build**: `just build` and Bazel `//:build` produce the adapter-node server
  under `build/`. Production and validation no longer compile different app
  shapes behind an `ADAPTER` switch.
- **Database (Member v0, TIN-3817 S1)**: `just db-generate` regenerates the
  checked-in migration SQL and its hash manifest; `just db-check` refuses a
  drifted tree, an edited committed migration, or a recipe that reaches for
  `drizzle push`, and rides inside `just check`; `just db-migrate` runs the
  real migrator against `$DATABASE_URL` (a runtime *name* — the value belongs
  to `great-falls-tool-bus-infra`). The application-owned
  `build/migrator.mjs` payload is included in `//:deployment_bundle`; GF-I09
  owns the final image `/bin` wrappers and their proof. Migrations are
  forward-only: an applied file's hash is immutable, and changing one fails
  closed rather than reapplying.
- **Integration tests**: `just test-integration` runs the testcontainers-backed
  PostgreSQL 16.15 suite (RLS, `FORCE`, advisory lock, ledger drift, runtime
  role grants). It fails closed when neither a container daemon nor the
  operator-supplied `GFTB_TEST_PG_SUPERUSER_DSN` is available; unavailable
  integration infrastructure is not a green result.
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
- **Published scaffold skills** (five):
  - `tinyland-whoami`, cold-landing repo-role classifier. Run via `just whoami`.
  - `tinyland-spawn-sister-site`, user-only; proves the exact template tree,
    then stamps the consumer repository and owner-overlay identity.
  - `tinyland-scaffold-doctor`, drift audit. Run via `just scaffold-doctor`.
  - `tinyland-repo-contract`, house-style baseline (Justfile/flake/gitleaks).
  - `tinyland-static-spoke`, per-spoke customization for static brand sites.
  - GloriousFlywheel v4 adoption follows the upstream
    `tinyland-flywheel-enroll` skill; this repo no longer vendors the retired
    v3 cache/profile skill.
- **Validation**: `just skills-validate` checks every SKILL.md frontmatter for
  required fields and the Anthropic 1,536-char description cap. Wire into
  `just check` in any consuming repo that publishes its own skills.
- **Public agent index**: this repo serves no live `/agent` route
  (single-product history, L72 Q3-A); the public agent surfaces are
  `static/llms.txt` + `static/agent-map.md`. (Corrected 2026-09-03: this
  bullet previously claimed a live `/agent` SvelteKit route — the only live
  `/agent` is site.scaffold's; gftb-site deliberately serves none either.)
- `tinyland.repo.json` is the machine-readable repo-shape manifest. It declares
  this repo an `app-stateful-spoke` and keeps GitOps/edge authority external.
- Durable operating truth belongs in repo files, schemas, tests, and Just
  recipes. Do not hide requirements only in prompt text.

## GloriousFlywheel v4 Action Fabric

- This application owns finite Bazel targets and the ActionPlan/v4 schema-3
  result dispositions in
  `.github/lanes.json`. It does not own a runner, pool, endpoint, platform,
  cache profile, token exchange, or provider placement.
- `.github/workflows/ci.yml` invokes only the immutable
  `tinyland-inc/ci-templates/.github/workflows/spoke-ci-v4.yml@32e39ced0008edf4564ebeb173a5e8fbf069e28f`
  (`v5.1.0`, carrying ActionPlan/v4 schema 3) and
  selects one checked-in action name. The image-custodied compiled
  `gf-action-client` is the sole execution entrypoint.
- The Great-Falls-Tool-Bus organization installs the GF GitHub App. Its sibling
  `great-falls-tool-bus-infra` repository owns the signed
  `OwnerInstallation/v1` and `TenantOverlay/v1` demand instances. GF core
  owns their types and verifier, never these consumer instances.
- Provider supply and placement are opaque to this repository. Missing App,
  overlay, catalog, binding, OIDC, client, or REAPI authority is a product
  failure and fails closed.
- There is no v4 fallback to local execution, cache-only execution, a hosted or
  repo-shaped runner, a direct endpoint, a profile, a port-forward, or a
  producer-held consumer registry.
- Local `just` recipes remain developer tools; their output is never v4
  evidence and never substitutes for a refused remote action.
- This application exports `//:deployment_bundle`; it does not construct or
  publish an OCI image. Only upstream GF-I07/v5 may qualify its verified
  `ActionOutputSet/v1`; only the GF-I09 owner materializer/publisher/controller
  may then construct, publish, and converge that image. Those authorities are
  not available to the current source carrier, so publication remains
  fail-closed with no application-owned bridge.
- In-house packages enter only through the pinned Bzlmod/BCR graph. Node-facing
  developer recipes may hydrate those graph outputs, but package.json,
  pnpm-lock.yaml, and v4 actions have no npm-shadow or fallback source.
## Theme & Skeleton

- **Skeleton 5.0.1** (pinned, PAIRED). `@skeletonlabs/skeleton` and
  `@skeletonlabs/skeleton-svelte` are a version-locked pair (skeleton-common
  component CSS @applies brand presets only core defines) — always bump both
  to the identical version in ONE commit; the solo bumps in #202/#203 broke CI.
- Tailwind v4, shim-free: the old `skeletonTailwindV4Compat()` plugin was
  removed with the v5 bump. Skeleton 5 ships stable `@variant` syntax and its
  base/globals.css requires `@variant dark` retained (this app uses
  `[data-mode]`, never `.dark`). Do not reintroduce the shim.
  `skeletonColorUtilities()` in `vite.config.ts` is separate and stays — it
  supplies paired utilities (e.g. `text-surface-900-50`) Skeleton never ships.
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

After the exact-tree generation transaction documented by
`tinyland-spawn-sister-site`:

1. `direnv allow`
2. Run `scripts/rebrand.sh` with the exact repository, description,
   consumer-overlay identity, and full scaffold source SHA. It stamps explicit
   machine fields only; review human-facing brand copy separately.
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
  Pin via the BCR.
- Don't add an in-house npm source edge. Keep each BCR module linked through its
  public `:pkg` target; use `just inhouse-package-parity` or `just conformance`.
- Don't bypass `Justfile` in CI or local, DX/AX must stay homogenous.
- Don't unpin Skeleton or split the skeleton/skeleton-svelte paired pin
  without coordination.

## V4 ActionPlan And Consumer Boundary

- The normative interface is [`docs/CI-SCHEMA.md`](./docs/CI-SCHEMA.md).
- `.github/lanes.json` contains only named `build` or `test` actions, finite
  workspace-local Bazel targets, and the abstract `rbe-linux-x86_64`
  capability. It contains no tenant or provider data.
- Every action declares one closed result disposition. Validation is
  `status-only`. The product build selects exact target
  `//:deployment_bundle` with `export-regular-files` and output group
  `default`; only its verified `ActionOutputSet/v1` may cross into a separate
  owner publication transaction.
- One immutable ci-templates invocation selects one member. Plan membership is
  admission, not a request to execute every member in one ARC job.
- ARC is only the thin GitHub admission edge. Bazel actions, REAPI scheduling,
  and the shared CAS/AC are the compute fabric.
- Browser LOOK, publication, OpenTofu, mutable preview lifecycle, and production
  apply are not Bazel actions. A PR LOOK route needs a separately admitted
  controller result and an owner-overlay reap transaction; neither may be
  approximated by a local preview or direct cluster mutation.
- Source presence is not activation. Keep a v4 adoption Draft until the exact
  consumer-owned overlay, resolved catalog, protected client image, and
  measurement attribution exist.
## Build target (one adapter-node product shape)

GFTB is an `app-stateful-spoke`, not a static scaffold instance. `just build`
and Bazel `//:build` compile the same adapter-node server shape, while
`//:deployment_bundle` is the sole application-owned promotion input. A
qualified owner publication transaction consumes those verified bytes; it does
not authorize a second application build. The retired adapter-static branch and
`ADAPTER` selector are absent: a green local/static build cannot stand in for
the artifact promoted on main.

**Application role.** This repository is an `app-stateful-spoke`, not a live
scaffold conversion. Schema v2 forbids `taxonomy.spawned_repo_role` on this
role. The retained `scripts/rebrand.sh` is historical scaffold tooling and is
not an enrollment, execution, or deployment path for this application.

**Non-action release transactions.** Browser LOOK, image publication, preview
lifecycle, reap, OpenTofu, production apply, and edge mutation are not Bazel
actions. This application declares product source and public intent. Its
consumer-owned `great-falls-tool-bus-infra` overlay owns signed demand and
owner transactions; provider supply and placement remain opaque here. The
retired Blahaj dispatch schemas, app-owned OpenTofu execution root, and
Cloudflare Pages rollback surfaces are absent rather than preserved as
fallbacks.

## Conformance

- `just conformance` runs the single application-aware
  `scripts/check-conformance.sh`; there is no second local conformance engine.
- `just repo-manifest-validate` routes only schema version 2 through
  `scripts/validate_repo_manifest.py`. Version 1 is retired and fails closed.
- `tinyland.repo.json` records the exact scaffold origin commit and the
  consumer-owned organization overlay. It never records provider placement.
- `just lanes-validate` and `just lanes-list` read the ActionPlan/v4 schema-3
  `.github/lanes.json` ActionPlan's `.actions` map.
- MANUAL rows (org ruleset and required status checks) require operator
  verification outside this repository.

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
