# On-cluster container readiness (HISTORICAL framing — cutover is DONE)

> **STATUS (2026-07-07): the cutover this doc describes as pending has
> EXECUTED.** ADR 0010
> (`docs/decisions/0010-on-prem-is-the-production-host.md`, executed
> 2026-07-06, Amendment 2 2026-07-07) superseded ADR 0008's operator-gated
> framing: on-cluster (`adapter-node` -> OCI image -> K8s -> `cloudflared`) is
> the **live, sole** production host, and Cloudflare Pages is not a warm
> standby — the `greatfallstoolbus-org` Pages project was **deleted**
> 2026-07-06 (TIN-2560). The image-build mechanics described below (the
> `ContainerFile`, `container-ghcr.yml`, the adapter-static/adapter-node table)
> are still accurate as a description of how the artifact is built; the
> "not yet done" / "warm standby" framing around them is not — see
> `docs/DEVELOPMENT.md` "Deploying" for the current, live posture.

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

On-cluster is the accepted direction (ADR 0008), but the live host has not
changed yet. This repo carries the on-cluster serve path as a concrete,
build-active artifact while Cloudflare Pages keeps serving production. The same
source CF Pages serves statically can also be served in-cluster as a Node server
(`node build/index.js`); the image is built and published, but nothing here
deploys it or moves the live host:

| Surface | Today (Cloudflare Pages is live) | On-cluster serve path |
| --- | --- | --- |
| `svelte.config.js` | adapter-static (CF Pages) | adapter-node **iff** `ADAPTER=node` |
| `ContainerFile` | not built by the CF Pages deploy lane | multi-stage `ADAPTER=node` build -> `node build/index.js` on `:3000`, non-root |
| `.github/workflows/container-ghcr.yml` | builds + pushes an `adapter-node` OCI image to GHCR on every push to `main` (and on `workflow_dispatch`); publishing the image does **not** deploy it | supplies the `sha-<commit>` image the overlay pins at the operator-gated cutover |

The default static build (`just build`) still emits adapter-static and never
imports adapter-node or touches the ContainerFile, so all default gates (`just
format lint typecheck test-unit skills-check source-map-check build`) stay green
with the frozen lockfile. The container workflow builds the image on its own
lane; it never mutates production serving.

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
  ClusterIP web Service fronting the adapter-node Deployment. Rollback is an
  overlay image-pin revert (re-pin a previous known-good digest and re-dispatch
  the infra `web-stack.yml` workflow, ADR 0008 §5 / 0010 §5 / Amendment 2), not
  the Cloudflare Pages / GitHub Pages model `docs/runbooks/cf-pages-rollback.md`
  describes (that runbook is now historical — see its own status banner).
- Cloudflare Pages is **not** kept warm as a second origin. The
  site-level-outage tradeoff (the cluster is one physical location) is the
  accepted posture, same as MassageIthaca already runs in production; there is
  no second live publisher mitigating it anymore.

## Boundary posture (public repo holds nothing operational)

- Zero secrets, endpoints, or ciphertext. The workflow uses only the ambient
  `GITHUB_TOKEN` (`packages: write`); no new secret is introduced.
- DNS, Cloudflare Access, Tunnel ingress, and any actual deploy are owned by
  `great-falls-tool-bus-infra` / blahaj. Route intent lives there
  (blahaj `tofu/intent/<workload>/public-edge-routes.json`), never here.
- Image name (names-only contract):
  `ghcr.io/great-falls-tool-bus/greatfallstoolbus.org:sha-<commit>`.

## adapter-node is a committed devDependency

`@sveltejs/adapter-node` is now committed to `devDependencies` (pinned `^5.5.7`)
and resolves through the frozen `pnpm-lock.yaml`; the earlier "deliberately
deferred" posture has landed. It is imported lazily in `svelte.config.js` and
only selected when `ADAPTER=node`, so the default static build never loads it and
the frozen-lockfile gates stay green. The container image build consumes it at
build time through the Nix image recipe (`nix/oci-image.nix`); the `ContainerFile`
is the portable equivalent.

Because the dependency is committed rather than installed only at image-build
time, keep the Bazel side (`MODULE.bazel.lock` / `npm_translate_lock`) and
`src/lib/house-stack-contract.test.ts` in sync whenever the pin moves, so `just
bazel-graph` and the Flywheel CAS targets still resolve.
