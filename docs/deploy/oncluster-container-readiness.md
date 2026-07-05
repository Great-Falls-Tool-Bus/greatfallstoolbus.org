# On-cluster serving readiness (on-prem is the accepted host; cutover operator-gated)

- Status: On-prem is the **accepted production host** (ADR 0010, operator ruled
  2026-07-05). The **primary serving path is adapter-static** (the static
  `build/` output served by a simple in-cluster static file server behind the
  `cloudflared` tunnel), the static-spoke fit. The adapter-node OCI image this
  repo builds (TIN-2543) is **retained as the reserved path for a future genuine
  server need**, not the primary serving path.
- Cutover is the **executing operator-gated plan** (ADR 0010 §5), not declare-only
  optionality. This repo builds the reserved on-cluster serve artifact; it does
  not flip the live host.
- ADR 0010 supersedes ADR 0003 (Pages-bound serving) and rules ADR 0008 Decision
  2. Cloudflare Pages **spins down**: kept warm only during the cutover window,
  then the project is deleted and the repo's `Pages:Edit` token retired.
- **Not yet applied.** Cloudflare Pages (project `greatfallstoolbus-org`,
  `adapter-static`, behind Cloudflare Access) stays the *live* host until the
  operator completes the cutover (mint web-apply SA/RBAC, create namespace,
  replicas 0->2, tunnel route, apex/www DNS flip Pages->tunnel, re-point Access
  origin, delete the Pages project). On-prem is the **accepted** host; it is not
  **live** until those steps complete.

## What this is

On-prem serving is the accepted production host (ADR 0010). The primary path is
the static-spoke shape: the same immutable `build/` artifact Cloudflare Pages
serves today, served instead from an in-cluster static file server fronted by the
`cloudflared` tunnel. No Node runtime, no server state, no new backend authority
is required for the static surface, so the static-spoke boundary
(`owns_runtime_backend=false`) is preserved by the primary path.

This repo also carries a **reserved** on-cluster serve path as a concrete,
build-active artifact: the adapter-node OCI image. It is the sanctioned path
**if and when** GFTB acquires a real runtime need (a secret-holding proxy, thin
API routes, upstream normalization). It builds and publishes today, but it is not
the primary serving path and nothing here deploys it or moves the live host:

| Surface | Today (Cloudflare Pages is live) | Primary on-cluster path (adapter-static) | Reserved path (adapter-node) |
| --- | --- | --- | --- |
| `svelte.config.js` | adapter-static (CF Pages) | adapter-static `build/` served by a static file server | adapter-node **iff** `ADAPTER=node` |
| `ContainerFile` | not built by the CF Pages deploy lane | not required (static file server serves `build/`) | multi-stage `ADAPTER=node` build -> `node build/index.js` on `:3000`, non-root |
| `.github/workflows/container-ghcr.yml` | builds + pushes an `adapter-node` OCI image to GHCR on every push to `main` (and on `workflow_dispatch`); publishing the image does **not** deploy it | the primary path serves the same static `build/` gates already produce | supplies the `sha-<commit>` image the overlay pins if the reserved server path is ever taken |

The default static build (`just build`) emits adapter-static and never imports
adapter-node or touches the ContainerFile, so all default gates (`just format
lint typecheck test-unit skills-check source-map-check build`) stay green with
the frozen lockfile. The container workflow builds the reserved image on its own
lane; it never mutates production serving.

## Accepted host, cutover not yet applied

ADR 0003 originally bound the serving host to Cloudflare Pages and rejected
cluster-served static behind the tunnel (no house precedent; honey pod-cap
pressure; route authority unfinished). ADR 0008 (Accepted 2026-07-05) retired all
three premises on new evidence: the MassageIthaca on-cluster precedent and a live
pod-headroom probe. **ADR 0010 (operator ruled 2026-07-05) then made on-prem the
production host** and spun down Cloudflare Pages, with **adapter-static as the
primary path** for the static surface.

The accepted host is not yet the live host. The cutover is operator-gated (ADR
0010 §5) and executed by `great-falls-tool-bus-infra` + the operator; this repo
cannot apply any of it. Cloudflare Pages remains the live host, kept warm as a
cutover-window standby, until the operator applies the overlay stack, adds the
tunnel route, flips apex/www DNS, re-points the Access origin, and deletes the
Pages project. Because the primary path is adapter-static (not adapter-node), the
static-spoke `boundaries` in `tinyland.repo.json` are undisturbed: no
`owns_container_image_production` flip is required for the static surface (ADR
0008 §6 flagged that flip only for the adapter-node shape). The GitOps deploy
lane for any on-cluster surface rides the blahaj receiver (see
`docs/decisions/dynamic-canary-blue-green.md`).

## Boundary posture (public repo holds nothing operational)

- Zero secrets, endpoints, or ciphertext. The container workflow uses only the
  ambient `GITHUB_TOKEN` (`packages: write`); no new secret is introduced.
- DNS, Cloudflare Access, Tunnel ingress, and any actual deploy are owned by
  `great-falls-tool-bus-infra` / blahaj. Route intent lives there
  (blahaj `tofu/intent/<workload>/public-edge-routes.json`), never here.
- The Access gate gates the tunnel hostnames on the Cloudflare edge, not
  Cloudflare Pages, so it survives the origin move unchanged (ADR 0010 §6).
- Image name (names-only contract):
  `ghcr.io/great-falls-tool-bus/greatfallstoolbus.org:sha-<commit>`.

## adapter-node is a committed devDependency (for the reserved path)

`@sveltejs/adapter-node` is committed to `devDependencies` (pinned `^5.5.7`) and
resolves through the frozen `pnpm-lock.yaml`. It is imported lazily in
`svelte.config.js` and only selected when `ADAPTER=node`, so the default static
build never loads it and the frozen-lockfile gates stay green. The container
image build consumes it at build time through the Nix image recipe
(`nix/oci-image.nix`); the `ContainerFile` is the portable equivalent. Keeping it
committed keeps the reserved server path build-ready without touching the primary
static path.

Because the dependency is committed rather than installed only at image-build
time, keep the Bazel side (`MODULE.bazel.lock` / `npm_translate_lock`) and
`src/lib/house-stack-contract.test.ts` in sync whenever the pin moves, so `just
bazel-graph` and the Flywheel CAS targets still resolve.
