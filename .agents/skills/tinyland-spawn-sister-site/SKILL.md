---
name: tinyland-spawn-sister-site
description: Route sister-site creation from this GFTB consumer to the protected transaction owned by tinyland-inc/site.scaffold. Use when a user asks to create, spawn, or scaffold a Tinyland spoke while working in this repository. This shim prevents GFTB from carrying a second rebrand implementation or an obsolete direct-to-main publication path.
when_to_use: |
  Use only to redirect an explicit spoke-creation request to the canonical
  site.scaffold checkout and its skill. Do not execute a spawn from GFTB.
disable-model-invocation: true
argument-hint: "[owner/repo] [site-domain] [one-line-purpose]"
allowed-tools:
  - Bash(gh api *)
  - Bash(git *)
  - Read
---

# Tinyland Spawn Sister Site: GFTB Consumer Shim

GFTB is an app-stateful consumer, not the owner of repository creation
mechanics. It deliberately carries no rebrand script or adapter-selection ADR.

For an operator-requested spawn:

1. Resolve a clean, reviewed checkout of `tinyland-inc/site.scaffold` inside an
   authorized workspace.
2. Fetch canonical `main`, require its exact GitHub commit to be verified with
   reason `valid`, and record that full SHA.
3. Read and follow that checkout's
   `.agents/skills/tinyland-spawn-sister-site/SKILL.md` completely.
4. Execute only from that scaffold checkout and preserve its protected
   topic-branch, PR, and owner-overlay boundaries.

If the upstream checkout or verified source cannot be established, stop. Never
reconstruct the transaction from this shim, copy it into GFTB, call a deleted
local `scripts/rebrand.sh`, push a generated child directly to `main`, add a
bridge or fallback, or infer provider placement.
