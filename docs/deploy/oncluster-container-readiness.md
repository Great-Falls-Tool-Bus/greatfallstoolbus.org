# On-cluster container readiness (HISTORICAL framing — cutover is DONE)

> **STATUS (2026-07-07): the cutover this doc describes as pending has
> EXECUTED.** ADR 0010
> (`docs/decisions/0010-on-prem-is-the-production-host.md`, executed
> 2026-07-06, Amendment 2 2026-07-07) superseded ADR 0008's operator-gated
> framing: on-cluster (`adapter-node` -> OCI image -> K8s -> `cloudflared`) is
> the **live, sole** production host, and Cloudflare Pages is not a warm
> standby — the `greatfallstoolbus-org` Pages project was **deleted**
> 2026-07-06 (TIN-2560). The image-build mechanics described below
> (`container-ghcr.yml` plus the sole nix2container image) remain accurate; the
> "not yet done" / "warm standby" framing around them is not — see
> `AGENTS.md` "Deploy lane" for the current, live posture.

- Status (as of this doc's original writing, TIN-2543): image build ACTIVE;
  production cutover not yet done and operator-gated. **Superseded** — see the
  banner above.
- ADR 0008 (Accepted 2026-07-05) supersedes ADR 0003 for production hosting: it
  accepts on-cluster (`adapter-node` -> OCI image -> K8s Deployment -> ClusterIP
  Service -> in-cluster `cloudflared` tunnel -> apex) as the **primary** target
  for the static-production surface, on the MassageIthaca precedent. ADR 0010
  then executed this direction and, per Amendment 2, closed out the Pages
  warm-standby mitigation entirely rather than holding it open-ended.
- Current serving host is on-cluster (`adapter-node`); Cloudflare Pages no
  longer exists as a project to fall back to.

## What this is

On-cluster is the live serving path under ADR 0010. This repo builds and
publishes its Node-server image, run as `server.js` (TIN-3959: a thin wrapper
around adapter-node's generated `build/handler.js` that fixes the
Cache-Control/ETag headers the stock `node build/index.js` never sets for
prerendered HTML — see `server.js`'s own header comment); on a green push to
`main`, the workflow publishes the exact digest and stops. It does not signal
or execute the consumer overlay's release/apply transaction. A manual workflow
dispatch has the same publication-only authority.

| Surface | Product build | Authority |
| --- | --- | --- |
| `svelte.config.js` / Bazel `//:build` | adapter-node `build/index.js` | application source |
| `.github/workflows/container-ghcr.yml` | packages that same server through nix2container | image publication only |

There is no adapter-static or local container-build fallback. The container
workflow holds no apply credentials; production mutation remains in the
separate infra repository.

## Accepted direction, cutover EXECUTED (was: "not yet done")

ADR 0003 originally bound the serving host to Cloudflare Pages and rejected
cluster-served static behind the blahaj tunnel (no house precedent; honey
pod-cap pressure; route authority unfinished). ADR 0008 (Accepted 2026-07-05)
revisited that on new evidence: the MassageIthaca on-cluster precedent and a
live pod-headroom probe that retired the pod-cap blocker. It supersedes 0003 for
the static-production serving host and names the `adapter-node -> image -> K8s ->
cloudflared` pattern as the house standard.

ADR 0010 then executed the cutover this section originally described as
phased-and-pending: all of 0008 §7's phases have run, the overlay is applied,
the tunnel ingress is live, and the image pin is current. Cloudflare Pages is
not the live host and is not on standby — the project is deleted (ADR 0010
Amendment 2, TIN-2560). The static-spoke `boundaries` re-check this section
anticipated (0008 §6's `owns_container_image_production` flag) is the
operator's to formalize in `tinyland.repo.json` when convenient; it does not
block the already-executed cutover.

## What changed at cutover: Cloudflare Pages is gone, not standing by

The original plan was to demote Cloudflare Pages from primary publisher to
**warm standby** rather than delete it outright. The operator ruled otherwise
(ADR 0010 Amendment 2, 2026-07-07: *"decommission now, align docs"*) and closed
the standby window early:

- The primary — and only — origin is the in-cluster tunnel fronting the
  ClusterIP web Service fronting the adapter-node Deployment. The former infra
  `web-stack.yml` rollback bridge is deleted. The protected v4 exact-plan
  transaction is the only ratified replacement and is not yet installed; no
  application-owned publisher, local apply, or interim dispatch substitutes for
  it.
- Cloudflare Pages is **not** kept warm as a second origin. The
  site-level-outage tradeoff (the cluster is one physical location) is the
  accepted posture, same as MassageIthaca already runs in production; there is
  no second live publisher mitigating it anymore.

## Boundary posture (public repo holds nothing operational)

- Zero secrets, endpoints, or ciphertext. The workflow uses only the ambient
  `GITHUB_TOKEN` (`packages: write`); no new secret is introduced.
- DNS, access, ingress, and any actual deploy are owned by the consumer overlay
  `Great-Falls-Tool-Bus/great-falls-tool-bus-infra`. Provider supply and
  placement are opaque to this application repository.
- Image name (names-only contract):
  `ghcr.io/great-falls-tool-bus/greatfallstoolbus.org:sha-<commit>`.

## adapter-node is the sole committed adapter

`@sveltejs/adapter-node` is now committed to `dependencies` (pinned `^5.5.7`)
and resolves through the frozen `pnpm-lock.yaml`; the earlier "deliberately
deferred" posture has landed. `svelte.config.js` selects it unconditionally.
The sole image implementation is the nix2container package in `flake.nix`.

Because the dependency is committed rather than installed only at image-build
time, keep the Bazel side (`MODULE.bazel.lock` / `npm_translate_lock`) and
`src/lib/house-stack-contract.test.ts` in sync whenever the pin moves, so `just
bazel-graph` and the Flywheel CAS targets still resolve.
