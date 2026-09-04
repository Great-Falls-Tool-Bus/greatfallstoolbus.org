---
name: tinyland-static-spoke
description: Customize, review, or maintain a Tinyland static spoke site created from tinyland-inc/site.scaffold. Use when changing AGENTS.md, CLAUDE.md, README.md, SvelteKit static routes, theme files, static projection ingestion, ActionPlan declarations, llms.txt, sitemap/robots, or per-site brand setup.
---

# Tinyland Static Spoke

## Overview

Use this skill for Tinyland sister sites that consume reviewed static
projections from `tinyland.dev`. A spoke is a static public site, not an app
backend, and does not own auth, user data, payments, mutation APIs, ActivityPub
delivery, or runtime broker fetches.

Do not use this skill to impose static-spoke restrictions on `tinyland.dev` or
app-stateful repos. For cross-repo taxonomy, read the repository's
`tinyland.repo.json` against
`docs/schemas/tinyland-repo-manifest.v2.schema.json`.

## First Reads

Read these before editing:

- `AGENTS.md` for the repo-local operating contract.
- `docs/CI-SCHEMA.md` before changing the ActionPlan or immutable v4 workflow.
- `Justfile` before running or documenting commands.
- `src/app.css`, `src/lib/styles/themes/`, and existing Svelte components before
  changing visuals.

## Spoke Customization

When creating or rebranding a spoke:

1. Run `scripts/rebrand.sh <site.example.com>` from the repo root.
2. Update `MODULE.bazel` module name to the underscored site name.
3. Update `README.md`, `AGENTS.md`, `CLAUDE.md`, `static/robots.txt`, sitemap,
   and any `llms.txt`/agent surface to the new domain.
4. Replace `src/routes/+page.svelte` with the real static site experience.
5. Keep Skeleton pinned unless the repo explicitly coordinates an upgrade.
6. Validate with `just check`, `just build`, and `just conformance`.

## Static Projection Rules

Use checked-in JSON artifacts only. Do not add browser or edge runtime fetches
back to `tinyland.dev`.

Valid ingestion paths:

- `just validate-static-projection <snapshot>`
- `just sync-static-projection <source> <target>`
- `just pulse-ingest <source> <target>`

Keep snapshots public-shaped. Reject secret-shaped fields, private location
fields, auth/payment custody, and claims that a static spoke performs public
Fediverse delivery.

## Lane And Preview Rules

Finite Bazel action intent lives in `.github/lanes.json` as an ActionPlan/v4
schema-3 declaration. Use `just lanes-validate` after action edits. Keep
provider placement, endpoints, credentials, publication, apply, and lifecycle
out of the plan and application workflow.

Browser LOOK and preview lifecycle require a separately admitted controller
result and an owner-overlay transaction. A spoke must not add a dispatch,
reaper, direct cluster mutation, or Cloudflare credential when that authority
is unavailable; it fails closed.

## Agent-Facing Surfaces

Keep these synchronized when truth changes:

- `AGENTS.md`: normative operator/agent contract.
- `CLAUDE.md`: short Claude reminder pointing back to `AGENTS.md`.
- `.agents/skills/*/SKILL.md`: Codex/agent project skills.
- `.claude/skills/*/SKILL.md`: Claude-compatible project skill entrypoints.
- `static/llms.txt`: public LLM index for the deployed site.
- No live `/agent` route in this repo (single-product history, L72 Q3-A);
  the public agent surfaces are `static/llms.txt` + `static/agent-map.md`.

Do not put hidden operational requirements only in an LLM prompt. Put durable
truth in repo docs, Justfile recipes, schemas, or tests.
