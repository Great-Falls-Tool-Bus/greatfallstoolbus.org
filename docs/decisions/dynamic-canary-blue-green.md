# DESIGN: dynamic-spoke canary — static health-gate vs. blue/green

- **Status:** Design-stage (NOT executed). Companion to
  [`dynamic-spoke-adapter-mode.md`](./dynamic-spoke-adapter-mode.md).
- **Date:** 2026-06-29
- **Linear:** TIN-2228
- **Scope fence:** This document DESIGNS two deploy lanes. It does not provision
  infrastructure, add workflows, or run a deploy. No blue/green controller is
  built here.

> **Correction note (2026-07-03, ledger item 20 / TIN-2385):** the "Blahaj
> executes" / "Blahaj **owns** Cloudflare DNS, Access, Tunnel ingress, the
> traffic cut-over" language in Lane B below predates the TIN-2385 carve-out
> recorded in [`0001-gftb-mvp-decisions.md`](./0001-gftb-mvp-decisions.md)
> Amendment 1. Under the resolved carve-out, an **owner apply-plane overlay**
> (for GFTB: `Great-Falls-Tool-Bus/great-falls-tool-bus-infra`) holds a
> Cloudflare token scoped to exactly its own zones and applies its own
> DNS/Access/Tunnel-route changes; blahaj keeps CF custody for house zones and
> its tunnel daemon. The invariant that survives unchanged: **spokes** (this
> repo included) still never hold long-lived CF creds and still only request —
> the executor is the owning overlay, not necessarily Blahaj. The original
> design text is retained per the no-silent-rewrite rule.

The adapter mode a spoke picks (`scripts/rebrand.sh --adapter=static|node`) also
selects its deploy/canary lane. The two lanes have fundamentally different
rollback shapes, so they get different safety mechanisms.

## Lane A — static spoke: post-deploy HEALTH-GATE

The static lane deploys an immutable artifact to an atomic-publish host
(GitHub Pages today via `.github/workflows/deploy-pages.yml`; Cloudflare Pages as
the sanctioned opt-in). There is no live process to drain, so a blue/green swap
buys nothing — the host already swaps the published tree atomically.

**Design:**

1. Build the static `build/` with `BASE_PATH` for the host (already shipped).
2. Publish via the host's atomic mechanism (`upload-pages-artifact` +
   `deploy-pages`, or the CF Pages equivalent). The previous deployment stays
   live until the swap completes.
3. **Post-deploy health-gate:** after the host reports the deployment URL, probe
   a small set of canary URLs (`/`, `/agent`, `llms.txt`, plus any spoke-declared
   critical routes) for HTTP 200 + a content assertion. The gate is a *report +
   alert* step, not a traffic controller: Pages cannot do percentage traffic
   shifting, so the gate's job is fast detection, and **rollback = re-publish the
   previous artifact** (atomic, seconds).
4. On gate failure: open/annotate the deploy as failed and surface the prior good
   SHA for re-publish. No partial-traffic state to reconcile.

**Properties:** zero-downtime is inherent (atomic host swap); rollback is a
re-publish; the gate is detection-only. Cheap, DB-less, no edge auth.

## Lane B — dynamic spoke (adapter-node): blue/green via Blahaj

A node spoke is a live process (`node build/index.js`) that may hold secrets,
proxy upstreams, or serve API routes. An in-place restart is a downtime + bad-deploy
window, so the dynamic lane uses **blue/green** behind the Blahaj GitOps receiver
(`tinyland-inc/blahaj`), which already owns ephemeral-env provisioning, DNS,
Access policy, and Tunnel ingress for this scaffold (see AGENTS.md "Per-PR
Ephemeral Envs" and "Public Client Previews").

**Design (declarative; Blahaj executes, the spoke only requests):**

1. **Build + package** the server bundle as a container image
   (`pr-{PR}-sha-{SHA}` tag template, per the ephemeral-env contract). The spoke
   never deploys directly — it emits a `repository_dispatch` payload to Blahaj.
2. **Stand up GREEN** alongside the live BLUE: Blahaj provisions the new color as
   a parallel deployment with its own internal address, reusing the existing
   ephemeral-env machinery. BLUE keeps serving 100% of traffic.
3. **Health-gate GREEN** before any traffic cut-over: readiness + the same canary
   URL set as Lane A, plus dynamic-only checks (process up, upstream reachable,
   secret material loaded). GREEN must pass cold before it is eligible.
4. **Cut over** by repointing the Blahaj-owned ingress/DNS from BLUE to GREEN.
   Because Blahaj owns DNS/Access/Tunnel, the cut-over is a receiver-side route
   flip, not a spoke action. Optionally hold a short bake window watching GREEN
   error rate.
5. **Rollback = flip ingress back to BLUE** (still warm) and reap GREEN. Because
   BLUE is never torn down until GREEN is proven and baked, rollback is a single
   route flip with no cold-start penalty.
6. **Reap BLUE** after the bake window; idempotent reap, same as ephemeral-env
   TTL teardown.

**Boundary invariants (must hold even in design):**

- The spoke **requests**; Blahaj **owns** Cloudflare DNS, Access, Tunnel ingress,
  the traffic cut-over, and cleanup. Spokes never hold long-lived CF creds.
- Blue/green is orchestrated through the existing Blahaj dispatch contract
  (`docs/schemas/blahaj-dispatch.schema.json` / the lane-env workflow), not a new
  bespoke controller.
- State backend, secrets, and any DB a dynamic spoke owns are out of the
  blue/green artifact swap — they are operator/runtime authority and must survive
  a color flip (no schema migration is implied by a route cut-over).

## What is intentionally NOT here

- No workflow, no tofu module wiring, no Blahaj dispatch payload is added by this
  ADR. Lane B is a design target for a follow-up implementation issue.
- No percentage/canary-weight traffic splitting is designed for Lane A (the host
  cannot do it) and only an optional bake window is designed for Lane B.
- No Superforms, no full adapter-node production build (TIN-2228 scope fence).
