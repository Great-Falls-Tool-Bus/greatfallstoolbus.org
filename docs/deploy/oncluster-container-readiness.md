# On-cluster container readiness (image build active; cutover operator-gated)

- Status: Image build ACTIVE (TIN-2543); production cutover NOT yet done and
  operator-gated. This repo builds the on-cluster serve artifact; it does not
  flip the live host.
- ADR 0008 (Accepted 2026-07-05) supersedes ADR 0003 for production hosting: it
  accepts on-cluster (`adapter-node` -> OCI image -> K8s -> `cloudflared`) as the
  target for the static-production surface, on the MassageIthaca precedent.
- Current serving host is still Cloudflare Pages (project
  `greatfallstoolbus-org`, `adapter-static`, behind Cloudflare Access) and stays
  so until the operator applies the overlay stack and bumps the image pin.

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

## Accepted direction, cutover not yet done

ADR 0003 originally bound the serving host to Cloudflare Pages and rejected
cluster-served static behind the blahaj tunnel (no house precedent; honey
pod-cap pressure; route authority unfinished). ADR 0008 (Accepted 2026-07-05)
revisited that on new evidence: the MassageIthaca on-cluster precedent and a
live pod-headroom probe that retired the pod-cap blocker. It supersedes 0003 for
the static-production serving host and names the `adapter-node -> image -> K8s ->
cloudflared` pattern as the house standard.

Accepting the direction is not flipping the host. The cutover is phased and
operator-gated (0008 §7, phases P2 through P5); only the image-build phase (P2)
is active in this repo. Cloudflare Pages remains the live host until the operator
applies the overlay stack, flips the tunnel ingress, and bumps the image pin.
That cutover re-checks the static-spoke `boundaries` in `tinyland.repo.json`
(0008 §6 flags adding `owns_container_image_production` while `owns_gitops_apply`
and `owns_cloudflare_mutation` stay false, so the overlay still owns the pin and
apply) and moves the deploy lane to the blahaj GitOps receiver (see
`docs/decisions/dynamic-canary-blue-green.md`).

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
