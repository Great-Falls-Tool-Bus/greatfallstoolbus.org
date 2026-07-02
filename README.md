# greatfallstoolbus.org

**Great Falls Tool Bus** — a shared tool library on wheels for Lewiston-Auburn,
Maine. *This is a bus, the shop comes later :)*

The public monorepo for the tool bus: the static site (what's on the bus, how to
donate, how to get access), printable cell sheets, and the **declare-only**,
public-safe IaC intent for the mail/list/form infrastructure. Apply authority for
everything cluster-side (mail transport, Mailman/HyperKitty, Anubis, DNS/tunnel)
lives in the private `blahaj` plane; runner tenancy lives in
`Great-Falls-Tool-Bus/great-falls-tool-bus-infra`. This repo holds **zero
secrets** by contract — see `docs/decisions/0001-gftb-mvp-decisions.md`.

Spawned from [`tinyland-inc/site.scaffold`](https://github.com/tinyland-inc/site.scaffold)
at `v0.2.0` (post-UPLIFT contract).

## Stack

- **Just** — sole authoritative DX/AX entrypoint (`Justfile`)
- **Nix flake + direnv** — reproducible dev shell (`flake.nix`, `.envrc`)
- **Bazel 8 + Bzlmod** — Bazel-first in-house package authority with GloriousFlywheel cache / executor proof
- **Agent skills** — Codex/agent project skills with Claude-compatible entrypoints
- **SvelteKit + adapter-static** — static-only, prerendered
- **Skeleton 4.15.2** — pinned exact, Tailwind v4 with v4-compat shim
- **Tummycrypt vite plugins** — `vite-plugin-a11y`, `vite-plugin-skeleton-colors`, `tinyvectors`, `tinyland-color-utils`
- **CI** — gitleaks secrets-scan, build-and-test, bazel-graph (all run inside `nix develop`)
- **Preview lanes** — tailnet PR lanes by default; opt-in public client previews via Blahaj + Cloudflare Access

## After creating from template

```bash
cd <new-repo>
direnv allow
scripts/rebrand.sh <site.example.com>   # rewrites name strings
just setup
just check
just build
```

## Paste-to-agent adoption

Open a new coding-agent session in any Tinyland repo and paste this:

> Adopt the Tinyland scaffold contract for this repo: read `AGENTS.md`, `Justfile`, `flake.nix`, `tinyland.repo.json` if present, `.github/workflows/*`, `.github/lanes.json`, `.bazelrc*`, `MODULE.bazel`, and `docs/CI-SCHEMA.md` if present; classify the repo shape and authority boundaries against `tinyland-inc/greatfallstoolbus.org/docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`; map the repo to the enforceable layers in `tinyland-inc/greatfallstoolbus.org/docs/agent-adoption.md`; flag contract smells; patch only minimal conformance gaps; run through `just <recipe>` entrypoints only; validate with `just check` plus `just conformance` or the closest documented equivalent; do not remove or rewrite dirty worktrees without preserving them and reporting the stash/branch.

The full DRY adoption flow lives in
[`docs/agent-adoption.md`](docs/agent-adoption.md). Keep the long checklist
there; link to it from other agent-ingestion surfaces instead of duplicating it.

## Agent surfaces

This scaffold dogfoods its agent-facing contract:

- `tinyland.repo.json`
- [`docs/agent-adoption.md`](docs/agent-adoption.md)
- `.agents/skills/tinyland-flywheel-bazel/SKILL.md`
- `.agents/skills/tinyland-static-spoke/SKILL.md`
- `.agents/skills/tinyland-repo-contract/SKILL.md`
- `.claude/skills/*` symlinks for Claude project skills
- `static/llms.txt`, `static/agent-map.md`, and `/agent`

The public surface is intentionally thin. `AGENTS.md` and
[`docs/CI-SCHEMA.md`](docs/CI-SCHEMA.md) remain the normative contracts.
`tinyland.repo.json` is the machine-readable repo-shape manifest.
For the cross-repo distinction between static spokes, app/stateful spokes, the
`tinyland.dev` mothership, Blahaj, and GloriousFlywheel, read
[`docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`](docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md).

## Projection Modes

Sister sites are read-only consumers of Tinyland authority. The scaffold supports
two modes:

- **Static projection ingestion**: consume reviewed static snapshots from
  `tinyland.dev` as checked-in JSON artifacts.
- **Runtime broker display**: deploy a static Cloudflare Pages shell that
  fetches reviewed public content from `hub.tinyland.dev` at runtime. This is
  for blog/Pulse-style sites where Tinyland remains the editor, greymatter,
  media, and broker authority, and the spoke only renders the stream.

The scaffold includes validation and sync recipes for the checked-in snapshot
flow:

```bash
just validate-static-projection path/to/public-snapshot.v1.json
just sync-static-projection https://tinyland.dev/projections/<spoke>/public-snapshot.v1.json path/to/public-snapshot.v1.json
just pulse-ingest https://tinyland.dev/projections/<spoke>/pulse/public-snapshot.v1.json static/data/pulse/public-snapshot.v1.json
```

These recipes validate snapshot hashes, Tinyland source authority for
`tinyland.static-spoke.snapshot.v1`, public Pulse M1 policy shape, and
secret-shaped field absence before writing a local JSON file. They do not add
mutation APIs, checkout sessions, payment custody, ActivityPub workers, or
public Fediverse delivery claims.

The optional spoke/actor arguments add a Tinyland brand actor public-key
readiness check before accepting a refreshed snapshot. `.github/workflows/pulse-ingest.yml`
wraps the same gate on a schedule or `workflow_dispatch` and opens a PR when a
checked-in snapshot changes. That workflow still treats the site as static. When
`require_signature` is enabled, it fails closed unless the fetched HTTPS
snapshot carries a valid Tinyland HTTP Signature from the expected actor key.

Runtime broker-display spokes must fetch from the configured Tinyland public
broker, not from checked-in post payloads, CI materialization, or the
`tinyland.dev` public apex. They remain static spokes: no server-side mutation
API, no local keys, no follower ledger, and no public Fediverse delivery worker.

## Conventions

- Repo name = domain with dots preserved (e.g. `tinyland-inc/phasi.space`)
- Default branch: `main`
- Visibility: private until an explicit launch decision
- Issues / projects: tracked in Linear team `Tinyland`, GH issues mirror
- Operator/agent contract: `AGENTS.md`

## CI and preview contract

The normative workflow contract lives in [`docs/CI-SCHEMA.md`](docs/CI-SCHEMA.md).
It covers `.github/lanes.json`, Blahaj PR-env dispatch, Cloudflare Access
public-preview overlays, runner-class rules, and the GloriousFlywheel cache vs
executor distinction. Spokes should not call Cloudflare directly for client
previews; they request a public alias and Blahaj owns DNS, Access, Tunnel, and
TTL cleanup.

GloriousFlywheel-backed Bazel work goes through
`scripts/gloriousflywheel-bazel.sh` via `just flywheel-build`,
`just flywheel-test`, or `just flywheel-fetch`. First run
`just flywheel-enroll` to inspect the advertised path, `just flywheel-doctor`
to diagnose the current shell, and `just flywheel-verify` to fail closed before
cache-backed work. The preferred source is the GloriousFlywheel
Home Manager/NixOS fleet profile, which exports `GF_FLYWHEEL_PROFILE_STATE`
plus endpoint metadata. Set `BAZEL_REMOTE_CACHE` and
`GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed` for cache-backed work; add
`BAZEL_REMOTE_EXECUTOR` and switch to `GF_BAZEL_SUBSTRATE_MODE=executor-backed`
only for proved target classes on cluster runners. Pull requests are read-only
unless a trusted lane explicitly sets `GF_BAZEL_REMOTE_UPLOAD=true`.

Runtime auth material stays out of the repo. CI or operator shells may supply
`BAZEL_CREDENTIAL_HELPER`, `BAZEL_REMOTE_HEADER`,
`BAZEL_REMOTE_CACHE_HEADER`, or `BAZEL_REMOTE_EXEC_HEADER`; do not commit their
values.

The scaffold ships finite Bazel targets for the static build, Svelte check, and
Vitest unit tests:

```bash
just flywheel-enroll      # inspect/profile the advertised enrollment path
just flywheel-doctor      # diagnose the current shell
just flywheel-verify      # fail-closed profile/env check
just flywheel-build        # //:build
just flywheel-test         # //:ci_validation_suite
just bazel-graph
```

MassageIthaca is the current reference adoption tranche for these patterns; see
[`docs/spec/massageithaca-pattern-backfeed-2026-05-19.md`](docs/spec/massageithaca-pattern-backfeed-2026-05-19.md)
for the public-preview, multi-lane, Bazel-first, and agent-contract lessons
being folded back into the scaffold.

In-house `@tummycrypt/*` and `@tinyland/*` packages are Bazel-first. If a
package still appears in `package.json` for pnpm/Vite compatibility, its version
must be exact and match `MODULE.bazel`:

```bash
just inhouse-package-parity
```

## Secrets scanning

Gitleaks is part of the baseline toolchain:

```bash
just secrets-scan-dir      # working tree
just secrets-scan          # git history
```

## SBOM

Local SBOM generation uses Syft from the Nix dev shell and writes ignored
artifacts under `build/sbom/`:

```bash
just sbom
```
