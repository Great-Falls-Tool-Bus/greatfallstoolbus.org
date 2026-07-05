# 0003 — Hosting cutover to Cloudflare Pages; remote-build posture stated truthfully

- Status: Accepted
- Date: 2026-07-03
- Operator approval: 2026-07-03 (in-session, verbatim "approved throughout, lets dive in"; ledger item 21)
- Amends: 0001 (adds the hosting row that packet never contained; row g REV/REV-2 recorded in Amendment 2), 0002 (no boundary changes)
- Evidence: adversarial recheck wf_13f12359 (2026-07-03)

> **Annotation — 2026-07-05 (TIN-2541, ADR 0008).** This ADR is retained
> verbatim as the **static-production-era** hosting record. ADR 0008
> (`0008-oncluster-production-hosting.md`, Proposed) scopes it to the
> static-production surface only and, on a 2026-07-05 read-only live cluster
> probe (0008 §7.1), **retires the three premises of Decision 1's "Rejected:
> cluster-served static" clause** (below):
> 1. **"honey at 103-104/110 pods, ~6 free" — OBSOLETE.** honey is now a
>    150-pod cap; the cluster carries ~176 free pod slots. A `replicas=2` web
>    Deployment fits with margin.
> 2. **"no house precedent" — FALSE.** MassageIthaca serves its public
>    production fully on-cluster (adapter-node → image → K8s → cloudflared);
>    Vercel / Neon / CF Pages were retired for it.
> 3. **"TIN-991 route authority unfinished / sting SPOF" — REFRAMED.** Routes
>    are dashboard / token-managed (a process constraint MI operates inside
>    daily, not a feasibility bar); the sting SPOF is CI-runner concentration
>    (deploy-velocity), NOT a serving risk.
>
> **No text below is changed.** Decision 1 (Cloudflare Pages for static
> production) still STANDS until the operator rules ADR 0008 Decision 2. This
> annotation records that the *rejection rationale* is superseded by fresh
> evidence; the *ruling* is unchanged pending that operator decision.

## Decision 1: Serving host — Cloudflare Pages, GH Pages retained as rollback publisher

GitHub Pages was never ADR-bound as this site's host: prompt 50 (lines 240-242)
left it "a step-1/step-3 decision," and 0001 contains no hosting row. We now
bind it: `greatfallstoolbus.org` serves from **Cloudflare Pages**, deployed by
the sanctioned opt-in workflow in `docs/deploy/cloudflare-pages.md`, following
the live `transscendsurvival.org` precedent (cutover 2026-06-23; wrangler-action
+ dns-drift / production-health guards; two-level rollback runbook in
`jesssullivan.github.io`).

**Why:** under the REV-2 gated posture, our own CI unbinds the GH Pages custom
domain on every main push — `deploy-pages.yml` classified an Access-gated or
unpropagated apex as not-ready and actively cleared the cname binding. Live
evidence 2026-07-03: cname re-bound by operator but `https_enforced=false`,
`protected_domain_state=null`; apex publicly unresolvable during NS propagation;
a PR-context settings-mutation 403 was also latent. Architecture A structurally
cannot hold its binding while gated, and the gated phase is open-ended. Wrangler
deploys succeed while gated; the `pages-domain-ready` / dual-`BASE_PATH` /
cname-clear machinery is **deleted, not ported**.

**Rejected:** cluster-served static behind the blahaj tunnel (no house
precedent; honey at 103-104/110 pods per blahaj ADR 005; TIN-991 route authority
unfinished; its same-origin-form advantage was already forfeited by row f/g).

**Mechanics:** create the Pages project (`greatfallstoolbus-org`); attach the
custom domain; flip `tofu/stacks/edge` `var.pages_host` from
`great-falls-tool-bus.github.io` to the `.pages.dev` host; replace
`deploy-pages.yml` with the shared `ci-templates` Cloudflare Pages lane (the
proven shape preserved behind a reusable wrapper: checkout, nix, `just check`,
`just build`, `wrangler pages deploy`; nothing invented). The Access gate,
allowlist, and `latoolb.us` redirect carry over
unchanged. `static/CNAME` is removed (CF Pages sets the custom domain at the
project level; the file was a GH Pages artifact concept). The GH Pages workflow
remains retrievable from git history as the rollback path; `pages.dev` preview
hostnames get Access-gated.

**Credential doctrine extension (deliberate, recorded here):** `wrangler pages
deploy` requires an account-scoped token; TIN-2385's zone-scoped stance is
extended with ONE additional account token restricted to **`Pages:Edit` only**,
held as a repo/environment GitHub secret alongside `CLOUDFLARE_ACCOUNT_ID`,
never in source. The spoke still never holds long-lived CF creds in-repo;
blahaj / the overlay still own DNS, Access, and Tunnel. (Ledger item 21.)

## Decision 2: Form/Anubis origin — unchanged, and explicitly NOT CF Pages Functions

CF Pages Functions is a runtime and is sanctioned nowhere in house doctrine;
adopting it would silently relocate form authority out of the decided plane and
violate the static-spoke contract (`owns_runtime_backend=false` is schema-hard-
pinned). The form endpoint remains per 0001 row (f) / Amendment 1 / 0002 Layer 2:
Anubis behind the blahaj Cloudflare tunnel, CHALLENGE scoped to the join/contact
form route only, on a separate hostname (e.g. `gftb-forms.tinyland.dev`),
implemented as `tofu/stacks/*` in `great-falls-tool-bus-infra`. It activates
after TIN-2379/2380 mail lands and the Access gate opens; dormancy until then is
decided (TIN-2378 comment b25465d8), not drift. This plan is origin-agnostic and
is unaffected by Decision 1.

## Decision 3: Remote-build posture — truthful status line, no change of course

This spoke is **CACHE-FIRST by written doctrine** (TIN-1997 Option D;
AGENTS.md), not "remote-everything." Canonical status: CI cache-first attach is
LIVE with native cache-hit proof (main run 28633449414: 368 + 45 remote cache
hits against the legacy in-cluster `:9092` endpoint); zero remote execution by
design (`docs/CI-SCHEMA.md` forbids counting cache hits as RBE; flywheel-runner-
selftest enforces fail-closed); local dev is pnpm-first with Bazel CAS wrappers.
Today's cache attach is unregistered tenancy-blind use of the shared default
namespace; org-grained tenancy and public-exchange mint are gated on **TIN-2364
L5** (Backlog). Ladder when unblocked: L5 lands cell-first → owners[] registry
row → org-tenant mint proof → `substrateMode` executor flip with flywheel-
eligible tags and `remote_processes>0` proof — accepting the recorded cold-cache
regression at flip, with RBE capacity constrained by the honey/sting pod-cap
incident class. Housekeeping bound to this ADR: AGENTS.md spoke-ci pin corrected
to v2.9.0 (PR #22); the `flywheel-test` job clarified as the template's matrix
name for the pnpm `just check` lane.

## Consequences

- `deploy-pages.yml` machinery (domain probe, dual builds, cname clear) is
  removed; deploys succeed while gated.
- One new narrow account-scoped CF secret exists at repo level; rotation owned
  by the operator/overlay lane.
- GH Pages remains a cold-standby publisher; rollback = re-point `pages_host`
  and restore the retained workflow from git history per the transscendsurvival
  runbook.
- SEO remains deferred by decision (REV-2) until the gate opens; nothing in this
  ADR changes that.
