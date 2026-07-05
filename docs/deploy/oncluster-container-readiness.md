# On-cluster container readiness (declare-only)

- Status: Declare-only readiness (TIN-2541). NOT a hosting change.
- Production host is unchanged: adapter-static -> Cloudflare Pages (ADR 0003).

## What this is

Optionality, not adoption. It lets the SAME source that CF Pages serves
statically also be served in-cluster as a Node server (`node build/index.js`),
without changing the production default. Everything here is additive, flagged,
and dormant:

| Surface | Default behavior | On-cluster behavior |
| --- | --- | --- |
| `svelte.config.js` | adapter-static (CF Pages) | adapter-node **iff** `ADAPTER=node` |
| `ContainerFile` | not built by any default gate | multi-stage `ADAPTER=node` build -> `node build/index.js` on `:3000`, non-root |
| `.github/workflows/container-ghcr.yml` | never triggers (no push/PR) | manual `workflow_dispatch` **and** `confirm=true` (fail-closed) |

The default static build never imports adapter-node and never touches the
ContainerFile, so all default gates (`just format lint typecheck test-unit
skills-check source-map-check build`) stay green with the frozen lockfile.

## Why on-cluster is not the production host

ADR 0003 bound the serving host to Cloudflare Pages and **explicitly rejected**
cluster-served static behind the blahaj tunnel as the production host (no house
precedent; honey pod-cap pressure; route authority unfinished). This readiness
work does not reopen that decision — it only removes the "we can't even build a
server image" friction if a future, genuinely server-needing capability (a
secret-holding proxy, upstream normalization, thin API routes) is sanctioned.
Adopting the node path would be a new ADR, would flip the deploy lane to
blue/green via the blahaj GitOps receiver (see
`docs/decisions/dynamic-canary-blue-green.md`), and would re-check the
static-spoke `boundaries` in `tinyland.repo.json`.

## Boundary posture (public repo holds nothing operational)

- Zero secrets, endpoints, or ciphertext. The workflow uses only the ambient
  `GITHUB_TOKEN` (`packages: write`); no new secret is introduced.
- DNS, Cloudflare Access, Tunnel ingress, and any actual deploy are owned by
  `great-falls-tool-bus-infra` / blahaj. Route intent lives there
  (blahaj `tofu/intent/<workload>/public-edge-routes.json`), never here.
- Image name (names-only contract):
  `ghcr.io/great-falls-tool-bus/greatfallstoolbus.org:sha-<commit>`.

## Follow-up: promoting adapter-node to a committed devDependency

Today adapter-node is installed only inside the ContainerFile builder stage, so
the committed `package.json` / `pnpm-lock.yaml` and the Bazel graph are
untouched. Committing `@sveltejs/adapter-node` (pinned `^5.5.3`, MassageIthaca
parity) to `devDependencies` is deliberately deferred because it is a contract
bump, not an additive edit:

1. Regenerate `pnpm-lock.yaml` (the house `just setup` uses
   `--frozen-lockfile`; a drifted lockfile fails CI).
2. Refresh the Bazel side (`MODULE.bazel.lock` / `npm_translate_lock`) so
   `just bazel-graph` and the Flywheel CAS targets still resolve.
3. Confirm `src/lib/house-stack-contract.test.ts` still passes — it does not
   forbid new devDependencies, but it pins the surrounding stack.

Until that bump lands, the build-time install keeps the default static build
fully insulated.
