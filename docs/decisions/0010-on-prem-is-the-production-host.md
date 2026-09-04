# 0010 - On-prem is the production host; spin down Cloudflare Pages

- Status: **Accepted** (operator ruled 2026-07-05)
- Date: 2026-07-05
- Supersedes / narrows:
  - historical **0003** (retained in Git history) Decision 1 - supersedes the
    Cloudflare-Pages-bound serving host for the static-production surface.
  - historical **0007** (retained in Git history) - narrows the retained
    Cloudflare Pages publisher from an open-ended warm standby to a
    cutover-window-only standby that is then decommissioned.
  - historical **0008** (retained in Git history) - rules 0008's Decision 2
    (its P4). This retires 0008's own "declare-only / not a hosting change /
    optionality not adoption" framing: on-prem is now the adopted host and the
    cutover is the executing plan, not a parked option.
- Relates:
  - Infra ADR `great-falls-tool-bus-infra:docs/decisions/0001-pr-gated-ephemeral-preview-deploys.md`
    (TIN-2535) - historical preview decision, superseded again by the v4
    controller-result and owner-overlay reap contract described in §4.
  - `docs/CI-SCHEMA.md` (the current v4 product-export contract),
    `tinyland-inc/site.scaffold:docs/decisions/dynamic-spoke-adapter-mode.md`
    (the adapter-selection SSOT), and `0002-blahaj-substrate-boundary.md`
    (the ownership boundary this preserves).
- Boundary: this repo stays schema-pinned `owns_cloudflare_mutation=false` and
  `owns_gitops_apply=false` (`tinyland.repo.json`). It **codifies the ruling and
  the host of record**; every apply named in §5 is executed by
  `great-falls-tool-bus-infra` + the operator, never from this repo.

## 1. The ruling

The operator has ruled (2026-07-05) to **reduce Cloudflare Pages reliance
entirely**. On-prem serving behind the in-cluster `cloudflared` tunnel **is the
production host** for `greatfallstoolbus.org`. This is a hosting change, not a
declaration of optionality. It closes out 0008's phased path at its final gate
(P4 ruled) and moves the site onto the executing cutover plan in §5.

Prior docs framed the on-cluster move as declare-only intent, "not a hosting
change," and "optionality not adoption" (0008 P0 framing; 0007 parked option
(c)). **That framing is superseded.** The technical readiness that framing was
waiting on was then recorded as in hand: the TIN-2543 carrier built and
published an image, the MassageIthaca
on-cluster precedent is proven (0008 §1), and the 2026-07-05 live cluster probe
retired the last capacity blocker (0008 §7.1, ~176 free pod slots cluster-wide).
The cutover was halted on non-technical grounds, not a missing fact. The ruling
removes that halt.

## 2. Decision 1 - on-prem is the production host; adapter-static is the primary path

`greatfallstoolbus.org` production is served **on-prem, in-cluster, behind the
`cloudflared` tunnel edge**.

- **adapter-static is the primary path.** The site is a static spoke
  (`owns_runtime_backend=false`), and its accepted host is the static `build/`
  output served by a simple in-cluster static file server. This keeps the
  static-spoke contract intact: no Node runtime, no server state, no new backend
  authority. The on-cluster origin is a plain internal Service fronted by the
  tunnel; it is the same immutable `build/` artifact Cloudflare Pages serves
  today, just served from the cluster instead of the CDN.
- **adapter-node remains viable, reserved for a future genuine server need.**
  The `adapter-node -> OCI image -> K8s -> cloudflared` path (0008 §3, the
  MassageIthaca house standard) already builds and publishes from this repo
  (the historical TIN-2543 carrier, removed by Amendment 4). It is retained as the
  sanctioned path **if and when** GFTB acquires a real runtime need (a
  secret-holding proxy, thin API routes, upstream normalization). Adopting a Node
  server for a site that has no runtime requirement would be gratuitous, so the
  static surface takes the static path. This does not weaken 0008: the MI pattern
  stays the house standard for genuinely dynamic surfaces; GFTB's static-
  production surface simply does not need it.

**Correction to 0008 §3 as applied to GFTB's static surface:** 0008 named
`adapter-node` as the shape for "every on-cluster GFTB web surface." For the
static-production surface that is narrowed here to **adapter-static served by a
static file server**; adapter-node is the reserved future path, not the default
for a site with no server need.

## 3. Decision 2 - Cloudflare Pages spins down

Cloudflare Pages is **decommissioned** as GFTB's serving host.

- It is retained **only as a short warm standby during the cutover window**, so
  that the origin flip in §5 has an instant fall-back while the on-cluster origin
  is proven live. It is **not** a permanent standby.
- **After the cutover bakes, the Pages project is deleted** and the public
  repo's one live Cloudflare credential (the `Pages:Edit` account-scoped token,
  0003 Decision 1) is retired from the repo, improving the zero-secret posture
  (0008 §6).

This **supersedes 0003 Decision 1** (Pages-bound serving) for the
static-production surface and **narrows 0007**: 0007's recommendation (a) kept a
Cloudflare Pages single-publisher as the standing rollback origin; 0008 §7.1 then
proposed keeping that publisher *warm* as the site-level-SPOF mitigation. Under
this ruling the warm standby is **cutover-window-only**, not open-ended: the
site-level-SPOF tradeoff (the cluster is one physical on-prem location, 0008
§7.1) is the accepted availability posture, the same tradeoff MassageIthaca
already runs in production. Cloudflare's proxy still fronts and caches the tunnel
origin at the edge; the on-cluster serving rollback is the re-pin primitive
(0008 §5), not a second live publisher.

## 4. Decision 3 - historical preview choice; mechanism superseded

This ADR originally selected an on-cluster ephemeral reaper after Cloudflare
Pages previews were retired. That repository-shaped reaper and its shared
`ContainerFile` premise no longer exist after the v4 hard cut.

The binding replacement is the v4 boundary: browser LOOK, publication, mutable
preview lifecycle, and reap are not application Bazel actions. A preview may be
created only from a separately admitted controller result and removed only by
the owner-overlay reap transaction. No local tailnet preview, application-owned
dispatch, or revived reaper is a fallback. This historical ADR does not
authorize any of those deleted mechanisms.

## 5. The cutover - operator-gated, and it is THE executing plan

The cutover is operator-gated and executed by `great-falls-tool-bus-infra` + the
operator (this repo cannot apply any of it). It is the plan being executed, not
optionality parked behind a future decision. Ordered steps:

1. Mint the web-apply Service Account and RBAC for the GFTB web workload.
2. Create the workload namespace in the overlay.
3. Scale the web Deployment `replicas` from 0 to 2 (anti-affinity onto the
   nodes with headroom per 0008 §7.1; keep the tightest node for its existing
   form / mail / substrate load).
4. Add the tunnel route from the public hostnames to the internal ClusterIP
   Service.
5. Flip apex and www DNS from the Cloudflare Pages host to the tunnel
   (Pages -> tunnel), in the overlay `edge` stack.
6. Re-point the Cloudflare Access origin at the tunnel hostnames.
7. Delete the Cloudflare Pages project and retire the public repo's `Pages:Edit`
   token last (after the on-cluster origin has baked).

**Rollback during the window:** re-flip DNS / Access origin back to the warm
Pages standby (Decision 2 keeps it warm precisely for this window); after the
window, on-cluster rollback is the re-pin-previous-`sha-<commit>` primitive
(0008 §5).

## 6. The Access gate survives the origin move

Cloudflare Access **gates the tunnel hostnames on the Cloudflare edge, not
Cloudflare Pages.** The gate sits in front of the public hostnames at the edge;
moving the origin from the Pages host to the tunnel does not touch the Access
policy or its allowlist. Gating is therefore **unaffected** by this cutover (the
allowlist was proven working 2026-07-05). Step 6 in §5 only re-points the Access
*origin* at the tunnel; the *policy* (who is allowed) is unchanged. The gate-
opening criteria (0004) and the private-repo posture (0007 context, 0001
Amendment 2) are likewise unaffected.

## 7. Boundary and public-repo posture (unchanged, and improved)

- This repo stays a static spoke: `owns_cloudflare_mutation=false`,
  `owns_gitops_apply=false`, `owns_runtime_backend=false`. Because the primary
  path is adapter-static (not adapter-node), the static-spoke boundary block is
  **not** disturbed by this ruling; no `owns_container_image_production` flip is
  required for the static surface (0008 §6 flagged that flip only for the
  adapter-node shape, which the static surface does not take).
- Zero secrets, endpoints, or ciphertext in the public tree
  (`scripts/scan-internal-endpoints.sh` enforces it; no cluster hostnames or IPs
  appear in this ADR). DNS, Access, Tunnel ingress, manifests, and every apply
  stay in `great-falls-tool-bus-infra` / blahaj.
- Net posture: after cutover the repo **sheds** its one live Cloudflare
  credential (§3), so it is more publish-safe, not less.

## 8. Consequences

- **On-prem is the host of record.** 0003 Decision 1, 0007's open-ended warm
  standby, and 0008's declare-only framing are superseded per the annotations
  landed on those ADRs (no-silent-rewrite: their text is retained, this ADR is
  the ruling).
- **Cloudflare Pages spins down**: warm during the cutover window only, then the
  project is deleted and the token retired.
- **Previews move on-cluster**, pending the infra companion decision
  (TIN-2535 reopened in spirit, §4).
- **The Access gate is untouched** by the origin move (§6).
- **Not yet applied.** This ADR codifies the accepted host and the executing
  cutover plan; the cutover steps in §5 are operator + overlay work and are not
  applied by this document. On-prem is the **accepted** host; it is not claimed
  **live** until the operator completes §5.

## Amendment 1 — §2 & §7: adapter-node is the production serving mode (AMENDED 2026-07-06, operator decision; TIN-2543)

**Superseded text (retained per the no-silent-rewrite rule):**

> ~~**adapter-static is the primary path.** The site is a static spoke
> (`owns_runtime_backend=false`), and its accepted host is the static `build/`
> output served by a simple in-cluster static file server. This keeps the
> static-spoke contract intact: no Node runtime, no server state, no new backend
> authority. The on-cluster origin is a plain internal Service fronted by the
> tunnel; it is the same immutable `build/` artifact Cloudflare Pages serves
> today, just served from the cluster instead of the CDN.~~
>
> ~~**adapter-node remains viable, reserved for a future genuine server need.**
> The `adapter-node -> OCI image -> K8s -> cloudflared` path (0008 §3, the
> MassageIthaca house standard) already builds and publishes from this repo
> (the historical TIN-2543 carrier, removed by Amendment 4). It is retained as the
> sanctioned path **if and when** GFTB acquires a real runtime need (a
> secret-holding proxy, thin API routes, upstream normalization). Adopting a Node
> server for a site that has no runtime requirement would be gratuitous, so the
> static surface takes the static path. This does not weaken 0008: the MI pattern
> stays the house standard for genuinely dynamic surfaces; GFTB's static-
> production surface simply does not need it.~~
>
> ~~**Correction to 0008 §3 as applied to GFTB's static surface:** 0008 named
> `adapter-node` as the shape for "every on-cluster GFTB web surface." For the
> static-production surface that is narrowed here to **adapter-static served by a
> static file server**; adapter-node is the reserved future path, not the default
> for a site with no server need.~~

> ~~Because the primary path is adapter-static (not adapter-node), the
> static-spoke boundary block is **not** disturbed by this ruling; no
> `owns_container_image_production` flip is required for the static surface
> (0008 §6 flagged that flip only for the adapter-node shape, which the static
> surface does not take).~~ (§7, second bullet)

**Replacement — adapter-node is the production serving mode:**

The operator ruled (2026-07-05, **reaffirmed 2026-07-06**, verbatim: *"none of
this site should be CF pages served, that was shot down in favor of
adapter-node"*) that GFTB's on-cluster production surface runs **adapter-node**,
not a static file server. §2's "adapter-static primary / adapter-node reserved"
framing — including its "Correction to 0008 §3" paragraph, quoted above — is
**superseded**: 0008's original framing (`adapter-node` as the shape for
on-cluster GFTB web) turns out to be the shipped shape after all, once the
operator ruled out any CF-Pages-served lane, interim or long-term, entirely —
not narrowed to a case-by-case "genuine server need" test.

**Amendment 3 — one product build (2026-09-01).** The operator superseded the
remaining adapter-static local/CI fallback during the GF v4 hard cut. The Pages
project and deploy lane are already gone; retaining a second build shape now
only lets CI validate bytes that cannot be promoted. `svelte.config.js`,
`just build` and Bazel `//:build` therefore emit the adapter-node server. The
`ADAPTER` selector and adapter-static dependency are removed. Git history
carries the old static implementation; it is not a live fallback. Amendment 4
supersedes the application-owned OCI publisher while preserving this one-product
build ruling. The unused `PUBLIC_ARCHIVE_LIVE` build flag is removed with that
second path: no current source consumer or `/discuss` route remains.

Every build-active artifact since this ADR's Accepted date confirms adapter-node
as the shipped shape, not a reserved future path:

- Bazel `//:deployment_bundle` exports the adapter-node server and its three
  process payloads as the application-owned publication input.
- The infra web Deployment remains the live state-continuity surface
  (`great-falls-tool-bus-infra:k8s/web/greatfallstoolbus-org-production/`, infra
  PR #60), with adapter-node readiness/liveness through `GET /health`. Its
  current image is not evidence of v4 publication or main-to-production
  convergence.
- **Serving-shape parity**: the adapter-node server remains the application
  payload carried inside the owner-published image and served on-cluster.

**Boundary-schema replacement (2026-09-04):** schema v2 declares this repo an
`app-stateful-spoke` that owns runtime behavior and the finite
`//:deployment_bundle` action. It does not own OCI construction/publication,
application pins or workloads, GitOps apply, Cloudflare mutation, or provider
placement. Those begin only after GF-I07/v5 qualification and in the GF-I09
owner transaction described by Amendment 4.

**§7 replacement:** the boundary reasoning tied to "the primary path is
adapter-static (not adapter-node)" no longer holds — the primary path *is*
adapter-node. §7's surviving posture is the ownership boundary: zero
secrets/endpoints in the public application tree, with release/apply authority
in the consumer-owned `great-falls-tool-bus-infra` overlay and provider
supply/placement opaque to this repository.

**What this amendment does not change:** on-prem remains the host of record and
the Access policy remains independent of adapter selection. §3–§5 document the
completed 2026 cutover history; they do not authorize a present release or
fallback. Amendment 4 governs all current publication and convergence.

**Historical citations:** site PRs #111, #113, and #114; infra PR #60. These
show why adapter-node was selected, not a current publication mechanism.

**Operator decision:** 2026-07-05, reaffirmed 2026-07-06, verbatim: *"none of
this site should be CF pages served, that was shot down in favor of
adapter-node."*

## Amendment 4 — application publisher retired; owner-authorized v4 publication (2026-09-04; TIN-4251)

The application stops at Bazel `//:deployment_bundle` and its verified
`ActionOutputSet/v1`. It does not construct or publish an OCI image. The
application-owned publication workflow, Nix OCI output, local image recipes,
and their readiness document are deleted rather than retained as a bridge.

GF-I07/v5 must first qualify those bytes against independent execution/cache
observation. Only the GF-I09 owner materializer/publisher/controller may then
construct and publish the OCI image, create the `ApplicationRelease`, and
converge the consumer overlay. ci-templates v5.1.0 invokes the action but does
not yet expose qualified output to a publication job, and GFTB has no remote
action producing its publishable OCI payload. This amendment therefore does
**not** claim publication, activation, or main-to-production convergence is
live; it records an exact upstream block and forbids an application-owned
workflow, local publisher, attended apply, or dispatch fallback.

## Amendment 2 — §5 step 7 & §8: cutover fully executed, Cloudflare Pages project deleted (AMENDED 2026-07-07, operator ruling; TIN-2560)

**Superseded text (retained per the no-silent-rewrite rule):**

> ~~7. Delete the Cloudflare Pages project and retire the public repo's
> `Pages:Edit` token last (after the on-cluster origin has baked).~~

> ~~**Rollback during the window:** re-flip DNS / Access origin back to the warm
> Pages standby (Decision 2 keeps it warm precisely for this window); after the
> window, on-cluster rollback is the re-pin-previous-`sha-<commit>` primitive
> (0008 §5).~~

> ~~**Not yet applied.** This ADR codifies the accepted host and the executing
> cutover plan; the cutover steps in §5 are operator + overlay work and are not
> applied by this document. On-prem is the **accepted** host; it is not claimed
> **live** until the operator completes §5.~~ (§8, final bullet)

**Replacement — the cutover is fully executed; the warm-standby window closed early:**

The operator ruled (2026-07-07, verbatim: *"decommission now, align docs"*) to
retire the Cloudflare Pages project immediately rather than hold it through the
full cutover-rollback window originally bounded at ~2026-07-08 (§3). Amendment
1 already established that on-cluster `adapter-node` serving was live and
verified; the remaining day of warm-standby overlap bought nothing once that
was proven, so the operator closed the window early instead of waiting out the
date.

All seven §5 steps are **done**:

- Steps 1–6 (SA/RBAC, namespace, `replicas` 0→2, tunnel route, apex/www DNS
  flip, Access re-point) are the state `great-falls-tool-bus-infra` carries
  today: `tofu/stacks/edge` `var.pages_host` now **defaults to the
  honey-ingress tunnel cname**, not `greatfallstoolbus-org.pages.dev` (infra
  PR #63); the web Deployment overlay is the executing shape (`replicas: 2`,
  digest-pinned; infra PR #60), and `web-stack.yml` run 28767572897 put 2/2
  replicas `Ready` on `/health`.
- Step 7 — **the `greatfallstoolbus-org` Cloudflare Pages project is deleted.**
  Site PR #122 added a one-off, dispatch-only, name-confirm-gated GitHub
  Actions workflow whose sole job was the deletion (fail-closed without the
  repo's `Pages:Edit`-scoped secret). Run
  [`28801030150`](https://github.com/Great-Falls-Tool-Bus/greatfallstoolbus.org/actions/runs/28801030150)
  executed it 2026-07-06T14:58Z: the Cloudflare API `DELETE
  .../pages/projects/greatfallstoolbus-org` call returned `{"success":true}`
  (job log: `Pages project greatfallstoolbus-org deleted.`). PR #123 removed
  the one-off workflow immediately after (its whole job was done) and recorded
  the verification: `greatfallstoolbus-org.pages.dev` no longer resolves in
  DNS at all, and apex/`www` are healthy on the tunnel origin.

**Rollback truth, corrected again 2026-09-04:** neither rollback mechanism this
ADR previously named remains executable. The Pages project is absent, and infra
PR #183 deleted `web-stack.yml` with the rest of the attended bridge. The
ratified replacement is the protected v4 exact-plan transaction re-pinning a
previously served digest and recording readback; that transaction is not yet
installed. No application-owned dispatch, local apply, or interim workflow may
stand in for it, and this repository must not claim rollback is currently armed.

**§8 replacement:** "Not yet applied" is superseded. The cutover is live and
fully applied end-to-end: on-prem is not merely the *accepted* host, it is the
**sole** serving host, verified — apex/`www` resolve through the tunnel, and
the retired `pages.dev` hostname no longer resolves at all (no second live
publisher remains, by construction).

**What this amendment does not change:** §1–§4, §6, and §7 stand as written
(and as already amended by Amendment 1); this amendment closes out §5 step 7
and corrects §8's "not yet applied" caveat and the now-obsolete
rollback-during-the-window text only.

**Citations:** site PR #122
(`chore(tin-2560): one-off dispatch workflow to delete the retired Pages
project`), site PR #123
(`chore(tin-2560): remove the one-off Pages-delete workflow (executed)`),
workflow run 28801030150, infra `tofu/stacks/edge/variables.tf` (`var.pages_host`
current default = the honey-ingress `cfargotunnel.com` target).

**Operator decision:** 2026-07-07, verbatim: *"decommission now, align docs."*
