---
name: tinyland-static-spoke
description: Customize, review, or maintain a Tinyland static spoke site created from tinyland-inc/site.scaffold. Use when changing AGENTS.md, CLAUDE.md, README.md, SvelteKit static routes, theme files, static projection ingestion, Blahaj lane previews, llms.txt, sitemap/robots, public preview docs, or per-site brand setup.
---

# Tinyland Static Spoke

## Overview

Use this skill for Tinyland sister sites that consume reviewed static
projections from `tinyland.dev`. A spoke is a static public site, not an app
backend, and does not own auth, user data, payments, mutation APIs, ActivityPub
delivery, or runtime broker fetches.

Do not use this skill to impose static-spoke restrictions on `tinyland.dev` or
MassageIthaca-shaped app/stateful repos. For cross-repo taxonomy, read
`docs/spec/tinyland-repo-taxonomy-and-gitops-contract-2026-05-19.md`.

## First Reads

Read these before editing:

- `AGENTS.md` for the repo-local operating contract.
- `docs/CI-SCHEMA.md` before changing lanes, workflows, Tofu, Blahaj dispatch,
  or Flywheel recipes.
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

Lanes live in `.github/lanes.json`. Blahaj receives one dispatch containing all
lanes for a PR. Use `just lanes-validate` after lane edits.

Tailnet PR lanes are the default. Public/client previews are explicit overlays
requested through the public-preview dispatch schema. Spokes do not own
Cloudflare mutation credentials; Blahaj owns DNS, Access, Tunnel ingress, and
TTL cleanup.

## Agent-Facing Surfaces

Keep these synchronized when truth changes:

- `AGENTS.md`: normative operator/agent contract.
- `CLAUDE.md`: short Claude reminder pointing back to `AGENTS.md`.
- `.agents/skills/*/SKILL.md`: Codex/agent project skills.
- `.claude/skills/*/SKILL.md`: Claude-compatible project skill entrypoints.
- `static/llms.txt`: public LLM index for the deployed site.
- `/agent`: human- and agent-readable route that links the repo contracts.

Do not put hidden operational requirements only in an LLM prompt. Put durable
truth in repo docs, Justfile recipes, schemas, or tests.
