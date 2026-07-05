# 0008 — On-cluster production hosting for GFTB web (supersedes 0003, scoped)

- Status: **Accepted** (operator ruled 2026-07-05: on-cluster is the way to go); supersedes ADR 0003 for production hosting
- Date: 2026-07-05
- Ticket: TIN-2541 (this decision)
- Evidence base: TIN-2537 research/corrections brief
  (`great-falls-tool-bus-infra:docs/research/full-oncluster-web-serving-2026-07.md`,
  infra PR #47) — every technical claim below traces to a path that brief read
  READ-ONLY.
- Supersedes / scopes: **0003** (hosting cutover to Cloudflare Pages) — this ADR
  narrows 0003 to *static production only* and, if the operator rules to migrate,
  supersedes its serving-host decision for the static-production surface. Under
  the no-silent-rewrite rule, 0003's text is retained; this ADR is the annotation.
- Relates: **0007** (private-repos rollback gap, Proposed on site PR #74) —
  reconciled in §5; **TIN-2535** preview ADR
  (`great-falls-tool-bus-infra:docs/decisions/0001-pr-gated-ephemeral-preview-deploys.md`,
  infra PR #46) — reconciled in §4.
- Boundary: this repo is schema-pinned `owns_cloudflare_mutation=false` and
  `owns_gitops_apply=false` (`tinyland.repo.json`). It **decides posture and
  declares intent only**; every apply is `great-falls-tool-bus-infra` +
  operator. No manifest, toggle, DNS record, or route in this ADR is enabled;
  each new toggle it names ships fail-closed / default-off.

## 1. Context — what changed under 0003

0003 (Accepted 2026-07-03, operator-approved in-session same day) bound serving
to **Cloudflare Pages** and **rejected** cluster-served static, by name: *"no
house precedent; honey at 103-104/110 pods per blahaj ADR 005; TIN-991 route
authority unfinished; its same-origin-form advantage was already forfeited by
row f/g."* That ruling was correct on its evidence at the time.

Two facts have moved since:

1. **A clean house precedent for full on-cluster web serving now exists.**
   MassageIthaca serves its *public* web app fully on-cluster with **no**
   Cloudflare Pages and **no** Vercel: SvelteKit `adapter-node` → OCI image on
   GHCR → K8s Deployment behind a ClusterIP Service → in-cluster `cloudflared`
   tunnel edge (`Jesssullivan/MassageIthaca:svelte.config.js`, `ContainerFile`,
   `.github/workflows/docker-ghcr.yml`; `tinyland-inc/blahaj:tofu/stacks/
   massageithaca/main.tf`, `deploy/honey/retained-cloudflared.yaml`,
   `tofu/intent/massageithaca/public-edge-routes.json`). Verified 2026-07-05:
   MI's `svelte.config.js` uses `@sveltejs/adapter-node`; its `ContainerFile`
   prod stage runs non-root uid/gid 1001, `EXPOSE 3000`, health-checked
   `node build/index.js`; blahaj declares the ClusterIP Service and the
   in-cluster tunnel edge. **0003's "no house precedent" premise no longer
   holds.**
2. **Gated-dynamic web I/O is already on-cluster here, and load-bearing.** The
   GFTB contact form runs on the Honey substrate today (Anubis PoW →
   form-handler → Mailman LMTP; `great-falls-tool-bus-infra:k8s/form/
   latoolb-us-production/`, `docs/runbooks/form-intake.md`), and the `discuss@`
   archive is next (TIN-2528 / TIN-2535). On-cluster serving is not hypothetical
   for GFTB — the muscle exists and is in production.

## 2. Decision 1 — scope 0003 to static production; gated-dynamic is not a 0003 matter

**Read 0003's rejection narrowly.** 0003 governs the **static-production**
surface only. **Gated-dynamic** serving (the live form; the coming archive) is a
*different, already-decided* thing — dynamic web I/O the Cloudflare Pages CDN
structurally cannot serve — and its on-cluster placement is **not** an 0003
reversal. This scoping matches the operator's own posture (TIN-2535 comment,
2026-07-05: static/prerendered production → CF Pages; PoW-gated dynamic →
on-cluster via Anubis).

Consequence of the scoping: the current posture is **coherent, not
split-brain** — a CDN for static, the cluster for gated-dynamic. "Split-brain"
is retired as a framing. 0003 Decision 1 (Cloudflare Pages for static
production) **stands as written** until and unless the operator rules on
Decision 2 below.

## 3. Decision 2 — adopt the MI pattern as the house standard for on-cluster GFTB web

**Adopt the MassageIthaca `adapter-node → image → K8s → cloudflared` pattern as
the sanctioned house standard for every on-cluster GFTB web surface** (it is
already the de-facto shape for the form). Named, shape-only (no endpoints, no
IDs — see §6):

- **Adapter:** SvelteKit `@sveltejs/adapter-node` (a long-running Node HTTP
  server, not `adapter-static`); build emits `build/index.js`.
- **Artifact:** a multi-stage OCI image (builder runs the SvelteKit build; prod
  stage runs non-root uid/gid 1001 under an init shim, `EXPOSE 3000`,
  health-checked `node build/index.js`), published to GHCR by the **public
  repo's own same-org CI using the ambient `GITHUB_TOKEN`** — no cross-org
  secret, no long-lived PAT in tree.
- **Deployment:** a K8s Deployment declared in the **overlay**
  (`great-falls-tool-bus-infra`), not this repo — containerPort 3000,
  RollingUpdate, liveness/readiness on a health route, `runAsNonRoot` 1001, PDB,
  `replicas=2`; the `dedicated.tinyland.dev/compute-expansion` toleration only if
  it lands on `sting`. Template references: `blahaj:tofu/stacks/
  mi-portal-deploy/main.tf` (tunnel-only variant — the closest shape) and
  `tofu/stacks/tinyland-dev/main.tf` (full template).
- **Service:** a plain **ClusterIP** (internal only; never internet-exposed).
- **Public edge:** the in-cluster `cloudflared` tunnel; the apex/www are proxied
  CNAMEs → the tunnel, forwarding to the internal Service. TLS terminates at the
  Cloudflare edge; the origin hop tunnel→Service is plain in-cluster HTTP (no
  cert-manager on the public apex path).
- **Promotion / rollback:** operator-gated image-pin bump in the overlay
  (`sha-<commit>`), decoupled from app CI, via a reviewed pin PR + protected
  OpenTofu apply. **Rollback = re-pin the previous `sha-<commit>` and re-apply**
  — trivially reversible, identical under public or private repos.

**Authority split (unchanged from 0002):** the public app repo owns *behavior +
image*; the overlay owns *every manifest + the pin + apply*; `latoolb.us` /
`greatfallstoolbus.org` DNS is the **overlay's** `edge` stack (zone-scoped token,
TIN-2385), not blahaj. This is MI's model verbatim and GFTB's existing
three-layer boundary — nothing about "build an image" requires a privileged
credential in the public repo.

## 4. Decision 3 — preview reconciliation with the TIN-2535 reaper ADR

The TIN-2535 preview ADR (infra PR #46) recommended **Cloudflare Pages managed
previews (Option A)** and *declined* to clone the blahaj/MI on-cluster reaper
(Option B), on the reasoning that CF Pages previews are free, already
Access-gated, and **redundant with a Pages production**. That recommendation was
sound **under its stated premise: that production stays on CF Pages.**

**If Decision 2 moves static production on-cluster, that premise is revisited.**
Once production is a running pod fronted by the tunnel, an on-cluster ephemeral
PR preview (the blahaj reaper shape) shares the **same** machinery as production
— the app `ContainerFile`, the GHCR publish, and the overlay stack template;
only the route-intent + lifecycle (reaper TTL vs durable pin) differ. In that
world the reaper is no longer a *net-new* capability whose whole cost must be
justified against a free incumbent; it is a marginal lifecycle variant of the
production path, and **on-cluster reaper previews become the coherent choice**
rather than the redundant one PR #46 correctly rejected.

**Reconciliation, not reversal.** PR #46's Option A stays the ruling **while
production is on CF Pages**. This ADR records that **an operator ruling for
Decision 2 is the trigger to re-open TIN-2535's preview question** — at which
point Option B (on-cluster reaper, blahaj pattern) and Option A (CF Pages
previews) are re-weighed with production-on-cluster as the new premise. The two
lanes are deliberately kept sharing one `ContainerFile` + one GHCR publish so
adopting the pattern for production lowers the marginal cost of the preview lane.
PR #46's pod-cap caution (each preview ≥ Anubis + server pod against thin
headroom) carries forward unchanged as a real constraint on preview *scale*.

## 5. Reconciliation with 0007 (rollback gap)

0007 (Proposed, site PR #74) surfaced that the documented GH Pages **full-path**
rollback is inviable while the repos are private (GitHub Free will not serve
Pages from a private repo), and recommended **(a) Cloudflare Pages
single-publisher rollback**. 0007 parked on-cluster static as its option **(c)**,
rollback-only, gated behind the same 0003 blockers.

This ADR reframes that relationship:

- **For any surface that moves on-cluster (Decision 2), the 0007 rollback gap is
  *dissolved*, not inherited.** On-cluster rollback = re-pin the previous
  `sha-<commit>` in the overlay and re-apply — a first-class, operator-gated,
  trivially reversible primitive (MI's exact model; MI PR #505 *rejected* an
  auto-pin-writer specifically to keep promotion operator-gated). It works
  identically under public or private repos, because the pin lives in the private
  overlay regardless. This is **strictly better** than 0007's single-publisher CF
  Pages fast-path for the migrated surface.
- **For any surface that stays on CF Pages, 0007's gap still applies** and must be
  solved on 0007's own terms.
- Net: 0007's option (c) — on-cluster as a rollback-only fallback — is subsumed
  by Decision 2. If production *serving* moves on-cluster, there is no separate
  rollback origin to stand up; the pin revert *is* the rollback. 0007's
  recommendation (a) remains the correct posture **for as long as production
  stays on CF Pages**; Decision 2, if ruled, retires the question for the
  migrated surface.

## 6. Public-repo zero-secret posture (on-cluster *improves* it)

The hard constraint is unchanged: the soon-public `greatfallstoolbus.org` repo
holds **ZERO** secrets, endpoints, or ciphertext — only declare-only intent and
names-only contracts (`secrets.contract.yaml`; `0002` three-layer boundary).
On-cluster serving does **not** weaken this — it **strengthens** it:

- The authority split (image vs pin) keeps every privileged surface — manifests,
  the image pin, DNS/tunnel-route mutation, kubeconfig, ciphertext — in the
  overlay and blahaj, never in the public repo.
- GHCR publish uses the **ambient same-org `GITHUB_TOKEN`**; no cross-org secret
  (the `secrets: inherit` cross-org gotcha proven by site PR #54 is avoided by
  staying same-org).
- On-cluster serving lets the public repo **retire its one live Cloudflare
  credential** — the `Pages:Edit` account-scoped token it carries today to drive
  CF Pages (0003 Decision 1). If static production leaves CF Pages, that token
  leaves the public repo. Net posture: **more** publish-safe, not less.

**Boundary-schema note (must be done deliberately, not drift):** a
container-producing spoke is a different shape than a static-projection spoke.
If Decision 2 is ruled, `tinyland.repo.json` gains an explicit
`owns_container_image_production=true` while `owns_gitops_apply` /
`owns_cloudflare_mutation` **stay false** (the overlay still owns the pin +
apply). This ADR flags the change; it does not make it.

## 7. Single open dependency, and the phased operator-gated path

**The only unresolved fact was capacity headroom — RESOLVED 2026-07-05 by the
live probe recorded in §7.1.** Of 0003's three blockers,
"no precedent" is **dissolved** (§1) and "TIN-991 route authority" is **reframed
to a standing governance constraint GFTB already operates inside** (the live form
route rides the same operator-gated, dashboard/token-managed tunnel; no CI
auto-applier — a persistent *process* constraint, not a feasibility bar). The
one blocker that survives is the **honey pod cap**: max-pods 110/node, honey
`quota_pods=200`, and a deliberately conservative posture leaving thin headroom
(PR #46 cites ~103-104/110). MI runs `replicas=2` comfortably, so a 2-pod GFTB
web workload is clearly *shaped* to fit — but exact **live** headroom is not
determinable from any repo.

**Single open dependency (OQ-5): a live `kubectl` pod-headroom probe** on
honey / bumble / sting against the per-node cap and `quota_pods`. This was the
one fact no document could supply and the one gate this ADR could not close from
the repo. **RESOLVED 2026-07-05 — the operator-authorized read-only probe in
§7.1 supplies it; the headroom bar is met with wide margin and the reaper is
healthy.** OQ-5 is CLOSED.

**Phased path (nothing applied; each phase operator-gated):**

- **P0 — this ADR (docs only).** Scope 0003 (Decision 1); sanction the MI
  pattern (Decision 2, *proposed*); record the preview + rollback
  reconciliations. Keep CF Pages for static production. Operator ruling
  requested. *(This is the only phase authorized by this document.)*
- **P1 — probe. DONE 2026-07-05 (§7.1).** The live pod-headroom count (OQ-5) is
  in hand; the one hard dependency is satisfied.
- **P2 — app-repo container readiness (public repo, no apply).** Add the
  `adapter-node` build behind a flag, the `ContainerFile`, and a same-org GHCR
  publish workflow (ambient `GITHUB_TOKEN`). Verify the image serves its health
  route locally. Still zero secrets in the repo; CF Pages stays the live path.
- **P3 — overlay stack (private, plan-only).** Add a GFTB app stack under the
  overlay modeled on `blahaj:tofu/stacks/mi-portal-deploy/main.tf` +
  `tinyland-dev/main.tf`; add the RustFS backend HCL; `just tofu-plan` only. Add
  the route-intent JSON mirroring the form's route contract.
- **P4 — this Decision 2 ruled.** With P1 headroom in hand, the operator
  adjudicates Decision 2; if authorized, this ADR supersedes 0003's serving-host
  decision for static production and the `owns_*` pin change (§6) lands.
- **P5 — cutover (only if P4 authorizes).** Operator applies the overlay stack,
  flips `enable_cloudflare_tunnel_ingress` (fail-closed until then), applies the
  tunnel route out-of-band, bumps the image pin. Rollback = re-pin previous
  `sha-<commit>` (§5). Retire the public repo's `Pages:Edit` CF token last.
  Re-open TIN-2535 previews under the new premise (§4).

## 7.1 — 2026-07-05 Live probe — dependency OQ-5 RESOLVED

**The one open dependency (§7, OQ-5) is now closed by a live, read-only
`kubectl` probe of the honey rke2 cluster (2026-07-05).** This makes Decision 2
**decision-READY**; it does **NOT** adopt it — Status stays **Proposed** and the
operator still rules the adoption (§8, P4). Every number below is a live
observation; the node private IPs are the same ones already published in the
infra diagrams (no new endpoint, secret, or IP is disclosed).

**Update 2026-07-05: ruled Accepted, see status line.**

### Pod headroom (scheduled / capacity → free)

| Node | Private IP | Scheduled / Capacity | Free |
|--------|--------------|----------------------|------|
| honey  | 192.168.0.10 | 138 / 150 | 12 |
| bumble | 192.168.0.11 | 50 / 110  | 60 |
| sting  | 192.168.0.12 | 96 / 200  | 104 |
| **Cluster** | — | 284 / 460 | **~176** |

**honey was EXPANDED to a 150-pod cap.** 0003's blocker premise (~103-104/110,
~6 free) is therefore OBSOLETE / faulty and is retired below. Cluster-wide
**~176 free pod slots** remain. A `replicas=2` web Deployment (server pod +
sidecars) fits easily and is NOT a headroom risk under any reading of the live
numbers.

### Reaper health (the adjacent dynamic-lane safety concern)

The kube-system CronJob `massageithaca-pr-lane-backstop-reaper` is **Active**
(`*/10`, last ran ~5 min before the probe, not suspended). Live pr-ephemeral
namespaces carry correct **future-dated `expires-epoch` TTLs**
(`tinyland-dev-pr-611 / 645 / 646` healthy). One lane
(`tinyland-dev-pr-620-apex`) sat ~80 min past its TTL but was still Active — this
is **WITHIN NORMAL operation, not a leak**: the full GH reaper runs a 4h cycle
and the backstop adds a 6h hard-delete grace, so bounded post-TTL latency is
expected. **Finding: the reaper is healthy.** The on-cluster ephemeral-preview
machinery §4 would re-open is proven-sound in production, lowering the risk of
the preview reconciliation.

### SPOF analysis

- **Serving SPOF = NONE.** Three-node cluster; the overlay already specs
  pod / node anti-affinity and `cloudflared` runs `replicas:2`, so a node loss
  reschedules. A `replicas=2` GFTB web Deployment placed with anti-affinity
  survives any single-node loss.
- **CI-runner-on-sting = a DEPLOY-VELOCITY concern, not a serving risk.** ALL
  ARC / nix runners (`great-falls-tool-bus-nix` + every listener) are
  concentrated on **sting**. A wedged runner stalls *deploys*, not *serving* —
  it is known / accepted / already-mitigated and is the same risk the live MI,
  mail, and form stacks already bear. This is explicitly NOT the "sting SPOF" a
  serving decision must weigh.
- **The genuine SPOF is SITE-LEVEL.** The whole cluster is one physical on-prem
  location (all three nodes on one /24). This is the honest availability tradeoff
  vs CF Pages' global CDN and is stated plainly, not waved away. MI already
  accepts this tradeoff for PRODUCTION today; Cloudflare's proxy fronts and
  caches the origin; and the named mitigation is a **warm CF-Pages standby**,
  which ties directly to **0007** (§5): the CF Pages publisher 0007 keeps for the
  static surface doubles as the standby origin, so the site-level SPOF is
  mitigated by keeping 0007's fast-path *warm* rather than cold. No new
  machinery.

### Deploy path (house patterns, nothing net-new)

Two operator-selectable paths, both already proven:

- **GitOps (preferred):** OpenTofu CI/CD gitops via the GFTB overlay
  (`great-falls-tool-bus-infra`) using `tinyland-inc/ci-templates` reusable
  workflows + the MassageIthaca `repository_dispatch` → blahaj `tofu-apply` →
  reaper flow. GFTB on-cluster inherits MI's proven apply / promotion / reaper
  path verbatim.
- **Direct:** operator `kubectl` / `tofu` apply out-of-band.

Either way there is **no new deploy machinery** to build — the pin-bump promotion
(§3) and re-pin rollback (§5) ride the existing MI path.

### Node-placement note

Place the web Deployment on **bumble / sting** (60 / 104 free). **honey is
tightest at 12 free** — the anti-affinity + toleration in §3 should steer the two
replicas onto bumble and sting and keep honey for its existing form / mail /
substrate load.

### 0003's three blockers — explicit disposition

The live probe closes the last open fact and, with §1's precedent finding,
resolves all three of 0003's original rejection premises. Each is now retired
(0003 is **annotated, not rewritten** — see 0003's dated annotation block):

1. **"honey pod-cap ~103-104/110, ~6 free" → DISSOLVED.** honey is now
   150-cap; cluster-wide ~176 free. The headroom bar is met with wide margin.
2. **"no house precedent" → DISSOLVED.** MI serves its public production fully
   on-cluster (adapter-node → image → K8s → cloudflared); Vercel + Neon + CF
   Pages were retired for it (§1).
3. **"TIN-991 route authority / sting SPOF" → RETIRED as a feasibility bar,
   reframed as a standing process constraint.** Routes are dashboard / token-
   managed (a *process* MI proves works daily; the live GFTB form already rides
   it), and the "sting SPOF" is the CI-runner concentration (deploy-velocity),
   NOT a serving risk. Neither blocks Decision 2.

**Consequence for §7:** OQ-5 is CLOSED and P1 is satisfied. The only gate now
standing between P0 and cutover is the operator's **P4 ruling on Decision 2** — a
decision, not a missing fact.

## 8. Consequences

- **P0-only, now decision-READY.** No infrastructure, toggle, DNS record, or
  route is applied. The P1 probe is DONE (§7.1, OQ-5 resolved 2026-07-05), so
  proceeding past P0 requires **only** an operator ruling on Decision 2 — no
  further fact-finding is outstanding.
- **0003 is scoped, not deleted.** Its Cloudflare Pages static-production
  decision stands until Decision 2 is ruled; its "no precedent" premise is
  annotated as superseded by MI (§1); its text is retained (no-silent-rewrite).
- **The MI pattern is the sanctioned house standard** for on-cluster GFTB web
  (already de-facto true for the form); the next surface is a copy, not a design.
- **Preview posture (PR #46) is unchanged until Decision 2 is ruled**, then
  re-opened with production-on-cluster as the new premise (§4).
- **The 0007 rollback gap is retired for any migrated surface** (pin revert) and
  unchanged for anything staying on CF Pages (§5).
- **The public repo's zero-secret posture is preserved and improved** — it sheds
  its one live CF credential on migration (§6); the `owns_container_image_
  production` pin change is flagged for deliberate handling.

## References

- TIN-2541 (this ADR); TIN-2537 (research/corrections brief, infra PR #47);
  TIN-2535 (preview ADR + operator scoping comment 2026-07-05, infra PR #46).
- Site `docs/decisions/0003-hosting-and-remote-posture.md` (production hosting;
  scoped here to static production); `0007-private-repos-rollback-gap.md`
  (Proposed, site PR #74; reconciled §5); `0002-blahaj-substrate-boundary.md`
  (three-layer boundary); `dynamic-spoke-adapter-mode.md` (adapter-node lane).
- `great-falls-tool-bus-infra:docs/research/full-oncluster-web-serving-2026-07.md`
  (evidence base); `docs/decisions/0001-pr-gated-ephemeral-preview-deploys.md`
  (preview ADR); `k8s/form/latoolb-us-production/`, `docs/runbooks/form-intake.md`
  (the live on-cluster serving precedent).
- `Jesssullivan/MassageIthaca:svelte.config.js`, `ContainerFile`,
  `.github/workflows/docker-ghcr.yml` (the app-side pattern).
- `tinyland-inc/blahaj:tofu/stacks/massageithaca/main.tf`,
  `tofu/stacks/mi-portal-deploy/main.tf`, `tofu/stacks/tinyland-dev/main.tf`,
  `deploy/honey/retained-cloudflared.yaml`,
  `tofu/intent/massageithaca/public-edge-routes.json` (the infra-side pattern +
  templates).
