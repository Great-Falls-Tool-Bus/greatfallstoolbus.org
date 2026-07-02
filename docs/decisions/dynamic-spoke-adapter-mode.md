# ADR: the dynamic-spoke is a flagged adapter mode IN greatfallstoolbus.org

- **Status:** Accepted (design-heavy; in-repo parts implemented)
- **Date:** 2026-06-29
- **Linear:** TIN-2228 (dynamic-spoke capstone)
- **Supersedes / relates to:** TIN-1280 (printstack hand-rolled the swap), TIN-2230
  (deploy-lane consistency), AGENTS.md "Build target" section

## Context

The house default is **adapter-static → GitHub/CF Pages**: cheap, DB-less, no edge
auth, perfect for content/brand spokes. But a growing set of spokes genuinely need
a server at runtime — a secret-holding proxy, upstream normalization (header
stripping, bbox rewriting), or thin API routes the browser cannot do safely. The
`darkmap.phasi.space` spoke already runs `@sveltejs/adapter-node` for exactly this
reason, and `printstack` (TIN-1280) hand-rolled the static→node swap by editing
`svelte.config.js` and `package.json` by hand, with no reusable path and no
manifest/role signal that the repo had become stateful.

The capstone goal (TIN-2228) is to make **greatfallstoolbus.org the universal client
entrypoint**: one scaffold that can spawn either a static spoke or a dynamic spoke,
rather than maintaining a second sibling "dynamic scaffold" repo that would
immediately drift from the static one (shared Justfile, flake, gitleaks, skills,
conformance, lanes contract, etc.).

## Decision

1. **The dynamic-spoke is a flagged adapter MODE inside greatfallstoolbus.org, not a
   sibling repo.** `scripts/rebrand.sh` gains `--adapter=node|static` (default
   `static`). `--adapter=node` performs the static→node swap deterministically at
   spawn time, so no spoke has to hand-roll it the way printstack did.

   - `package.json`: jq-swap the `@sveltejs/adapter-static` devDependency for
     `@sveltejs/adapter-node` (pinned `^5.5.3`, matching the `MassageIthaca`
     reference).
   - `svelte.config.js`: rewrite to `adapter()` from `@sveltejs/adapter-node`,
     dropping the static-isms (`fallback`, `precompress`, the `prerender` block)
     while keeping `compilerOptions.runes` and the `BASE_PATH` `paths.base` that
     merged with #31. The rewrite is a full deterministic template, not a fragile
     in-place patch.
   - `tinyland.repo.json`: stamp `taxonomy.spawned_repo_role` (see role decision).

   All three edits are crash-safe (`tmp` file then `mv`) and idempotent: the
   function gates on `grep adapter-node svelte.config.js` and no-ops on a second
   run. **rebrand.sh never runs `git checkout`/`git reset`** — a prior run wiped
   uncommitted edits that way, so the script only ever writes forward.

2. **Reuse the existing `app-stateful-spoke` role for dynamic spokes.** The
   manifest schema's `$defs.repoRole` already lists `app-stateful-spoke`, and
   `taxonomyLayer` already lists the matching `app-stateful-spoke` layer. A
   dynamic spoke owns a runtime backend, which is exactly what
   `app-stateful-spoke` denotes (the `MassageIthaca`-shaped class AGENTS.md
   already describes). Adding a new `dynamic-spoke` enum would mean editing both
   `repoRole` and `taxonomyLayer`, updating every consumer of the taxonomy, and
   carrying two near-synonymous roles — for no semantic gain. So `--adapter=node`
   stamps `spawned_repo_role = "app-stateful-spoke"`.

## Why not the alternatives

- **A separate `greatfallstoolbus.org-dynamic` repo.** Rejected: it duplicates the entire
  house contract (Justfile/flake/gitleaks/skills/lanes/conformance) and guarantees
  drift. The scaffold-is-entrypoint thesis (TIN-2228) wants ONE entrypoint.
- **Hand-rolling the swap per spoke (the printstack/TIN-1280 path).** Rejected as
  the steady state: it is error-prone, leaves no role/manifest signal, and every
  spoke re-derives the same edits. The flag captures that knowledge once.
- **A new `dynamic-spoke` enum value.** Rejected: `app-stateful-spoke` already
  means "owns runtime behavior." A second role is churn without distinction.

## Consequences

- A dynamic spoke is `app-stateful-spoke`, so the static-spoke boundary block in
  the schema's `allOf` (which pins `owns_runtime_backend=false`, `owns_auth=false`,
  …) does **not** apply to it — a node spoke MAY legitimately own a runtime
  backend. The operator must re-check the `boundaries` object after flipping;
  `rebrand.sh` prints that reminder.
- The deploy lane must flip with the adapter: static = Pages health-gate, dynamic
  = blue/green via the Blahaj GitOps receiver. That is designed (not executed) in
  [`dynamic-canary-blue-green.md`](./dynamic-canary-blue-green.md).
- The smoke serve path changes: `node build/index.js`, not a static file server.
- **In-scope for this slice (implemented):** the `--adapter=node` flag, this ADR,
  the canary/blue-green DESIGN, the schema-role decision + wiring, and the AGENTS
  update. **Out of scope (not executed):** a full adapter-node production build,
  Superforms, and any live deploy/canary execution.
