# 0010 - On-prem is the production host; spin down Cloudflare Pages

- Status: **Accepted** (operator ruled 2026-07-05)
- Date: 2026-07-05
- Supersedes / narrows:
  - **0003** (`0003-hosting-and-remote-posture.md`) Decision 1 - supersedes the
    Cloudflare-Pages-bound serving host for the static-production surface.
  - **0007** (`0007-private-repos-rollback-gap.md`) - narrows the retained
    Cloudflare Pages publisher from an open-ended warm standby to a
    cutover-window-only standby that is then decommissioned.
  - **0008** (`0008-oncluster-production-hosting.md`) - rules 0008's Decision 2
    (its P4). This retires 0008's own "declare-only / not a hosting change /
    optionality not adoption" framing: on-prem is now the adopted host and the
    cutover is the executing plan, not a parked option.
- Relates:
  - Infra ADR `great-falls-tool-bus-infra:docs/decisions/0001-pr-gated-ephemeral-preview-deploys.md`
    (TIN-2535) - the intent of its Option A (Cloudflare Pages managed previews)
    is superseded here; PR previews move to the on-cluster reaper pattern. This
    needs an infra-side companion decision to revive the reaper (TIN-2535
    reopened in spirit; see §4).
  - `docs/deploy/oncluster-container-readiness.md` (the build-active artifact),
    `dynamic-spoke-adapter-mode.md` and `dynamic-canary-blue-green.md` (the
    adapter-mode / lane design), `0002-blahaj-substrate-boundary.md` (the
    three-layer boundary this preserves).
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
waiting on is already in hand: the container image builds and publishes today
(`docs/deploy/oncluster-container-readiness.md`, TIN-2543), the MassageIthaca
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
  (`docs/deploy/oncluster-container-readiness.md`). It is retained as the
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

## 4. Decision 3 - PR previews move to the on-cluster reaper pattern

PR previews move from Cloudflare Pages managed previews to the **on-cluster
ephemeral reaper pattern** (the blahaj / MassageIthaca reaper shape, proven
healthy in the 2026-07-05 probe, 0008 §7.1).

- This **supersedes the intent of infra ADR 0001** (TIN-2535), whose Option A
  chose Cloudflare Pages previews on the premise that production stays on
  Cloudflare Pages. With production on-cluster, that premise no longer holds
  (0008 §4): a preview lane now shares the production `ContainerFile`, GHCR
  publish, and overlay stack, so the reaper is the coherent choice rather than a
  net-new capability.
- **This needs an infra-side companion decision.** Preview provisioning is
  overlay + blahaj work (`owns_gitops_apply=false` here), so reviving the reaper
  is a `great-falls-tool-bus-infra` decision. TIN-2535 is reopened in spirit:
  its preview question is re-weighed with production-on-cluster as the new
  premise, Option B (on-cluster reaper) now favored. PR #46's pod-cap caution on
  preview *scale* carries forward unchanged.

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
