# 0007 — Private repos break the GH Pages rollback path; pick a rollback posture

- Status: **Proposed** (operator decision required)
- Date: 2026-07-05
- Relates: 0003 (hosting posture — the path this brief re-examines), 0001
  Amendment 2 (the 2026-07-04 "repos PRIVATE" note that opened the gap),
  `docs/runbooks/cf-pages-rollback.md` (the two-level rollback model)
- Boundary: this repo is schema-pinned `owns_cloudflare_mutation=false` and
  `owns_gitops_apply=false` (`tinyland.repo.json`) — it decides posture here,
  it does not apply edge/cluster changes.

> **Annotation - 2026-07-05 (ADR 0010, operator ruling).** The operator ruled
> on-prem is the production host (`0010-on-prem-is-the-production-host.md`,
> **Accepted**). This **narrows** the retained Cloudflare Pages publisher below:
> instead of an open-ended warm standby / single-publisher rollback origin, the
> Pages publisher is kept warm **only during the cutover window** and is then
> decommissioned (project deleted, `Pages:Edit` token retired). Post-cutover the
> rollback primitive is the on-cluster re-pin-previous-`sha-<commit>` (0008 §5),
> not a second live Cloudflare Pages publisher; the site-level-SPOF tradeoff
> (single on-prem location, 0008 §7.1) is the accepted availability posture. The
> options and recommendation below stand as the record of the rollback-gap
> analysis; 0010 supersedes the "keep CF Pages as a standing standby" outcome.
> Nothing here is applied until 0010 §5 completes.

## Context

0003 (Accepted 2026-07-03, operator-approved in-session same day) bound serving
to **Cloudflare Pages** and kept **GitHub Pages** (`great-falls-tool-bus.github.io`)
as the "cold-standby publisher": its Consequences record "rollback = re-point
`pages_host` and restore the retained workflow from git history per the
transscendsurvival runbook." `docs/runbooks/cf-pages-rollback.md` then codified
this as a **two-level** model — a fast path (re-promote a prior immutable
Cloudflare Pages deployment; same origin, DNS, and gate; minutes) and a full
path (move the serving substrate back to GitHub Pages by re-pointing
`var.pages_host` in the infra `edge` stack and restoring `deploy-pages.yml`).
GitHub Pages is named there as the "Rollback publisher of record."

Two things then changed the ground under the full path:

1. **0001 row (a)/(d)** made this a **PUBLIC** monorepo. 0001 **Amendment 2**
   records that on **2026-07-04 the operator flipped both org repos PRIVATE**
   pending launch (consistent with the gated apex + consent-pending names in
   repo content). Re-publicizing joins the TIN-2421 gate-opening sweep.
2. That same amendment already flags the consequence in one line: **"GH Pages
   rollback (ADR 0003) requires public-or-paid — acceptable while CF Pages is
   primary."**

GitHub Pages will not build/serve from a **private** repo on the Free plan
(the house-wide constraint: Tinyland is on GitHub Free). So the documented
substrate-level fallback is currently **inviable** — not broken code, but a
cold-standby that cannot be cold-started in today's repo-privacy state. This
brief surfaces that gap and asks the operator to choose a rollback posture.

## The rollback gap (the decision this brief exists for)

- The **fast path is unaffected.** Cloudflare Pages deployments are immutable
  and re-promotable via dashboard or a `Pages:Edit`-scoped token
  (`cf-pages-rollback.md`, Fast path). Repo privacy has no bearing on it —
  wrangler direct-upload serving is likewise unaffected (Amendment 2).
- The **full path is inviable while the repos are private.** Its step 2/3
  ("restore `deploy-pages.yml`" and "re-enable GitHub Pages … Source = GitHub
  Actions") both require GitHub Pages to build and serve from this repo, which
  the Free plan does not do for a private repo. So today the "two-level" model
  is effectively **one-level**: the substrate-level fallback publisher of record
  does not exist until the repos re-publicize (TIN-2421) or the org buys a paid
  plan.

The narrow question: **do we accept single-publisher rollback, restore a
GH Pages fallback some other way, or stand up a different substrate-level
fallback?**

## On the "is the gitops split-brained / move it on-cluster?" question

The split — static on Cloudflare Pages, mail/runtime on-cluster — is **not
accidental drift; it is a decided posture**, and moving serving onto the
cluster is **not** the answer to this rollback gap. Recording why, so the idea
is parked with reasons rather than silently dropped:

- **0003 explicitly rejected cluster-served static**, by name: "no house
  precedent; honey at 103-104/110 pods per blahaj ADR 005; TIN-991 route
  authority unfinished; its same-origin-form advantage was already forfeited by
  row f/g." Adopting on-cluster serving now would **reverse a fresh (two-day-old),
  operator-approved ADR** against those same still-open blockers.
- **This repo cannot apply it anyway.** `tinyland.repo.json` pins
  `owns_cloudflare_mutation=false` and `owns_gitops_apply=false`; the apply
  plane is `great-falls-tool-bus-infra` (0001 Amendment 1). A decision brief in
  this repo can propose posture but cannot enact an edge/cluster move.
- The pod-cap and TIN-991 route-authority blockers are **substrate facts**, not
  paperwork; nothing in this brief resolves them.

**Parked, not adopted.** On-cluster static could only re-enter as Option (c)
below (rollback-only, gated on those blockers clearing first) — never as the
primary serving change, and never as the fix for repo privacy.

## Options for the rollback gap

### (a) Cloudflare Pages single-publisher — drop the GH Pages full path

Accept the fast path (immutable-deployment re-promotion) as **the** rollback
mechanism and retire the GH Pages substrate-level fallback. Immutable
re-promotion is already a first-class, fast, DNS-and-gate-untouched rollback
property in `cf-pages-rollback.md`; it is the runbook's own default ("Default to
the fast path").

- **Pros:** lowest change; needs no repo-privacy change and no paid plan; keeps
  the boundary pins honest (nothing here has to mutate edge/cluster); matches
  the transscend precedent's "fast path first" discipline.
- **Cons:** removes the "Cloudflare Pages itself is the failure mode" escape
  hatch. Mitigations then live inside Cloudflare (a prior known-good deployment
  is always re-promotable; an account/project-level outage is a support/incident
  matter, not a same-repo action). Single-publisher = no independent second
  origin.

### (b) Keep a GH Pages fallback via a PUBLIC mirror (or GitHub Pro)

Restore the documented full path by giving GitHub Pages something public to
serve: either a **public mirror repo that holds only `build/`** (the compiled
static output, no source, no consent-pending names beyond what the live site
already shows), or move the org to a **paid GitHub plan** that serves Pages from
private repos.

- **Pros:** restores the two-level model exactly as `cf-pages-rollback.md`
  documents it — an independent second publisher on a different substrate.
- **Cons:** a **public artifact surface** re-appears while 0001 Amendment 2's
  whole point was to keep surfaces private pending launch (naming-consent
  policy) — a mirror of `build/` re-exposes rendered content the operator just
  chose to gate. Or it costs money (paid plan). Adds a mirror-sync mechanism to
  maintain. Largely redundant with TIN-2421, which re-publicizes this repo at
  gate-open and restores the path for free.

### (c) On-cluster static origin as ROLLBACK ONLY (not primary)

Stand up a cluster-served static origin used **only** as the substrate-level
fallback, leaving Cloudflare Pages primary.

- **Pros:** a second origin fully inside the house, no GitHub-plan dependency.
- **Cons:** only viable **after** the 0003 blockers clear — honey pod-cap
  headroom (103-104/110 per blahaj ADR 005) and TIN-991 route authority — and
  even then this repo can't apply it (`owns_gitops_apply=false`); it is
  `great-falls-tool-bus-infra` work. Highest effort; re-opens the exact posture
  0003 rejected. Not actionable today.

## Recommendation

**Adopt (a): Cloudflare Pages single-publisher rollback.** It is the lowest-change
path, needs no repo-privacy change and no spend, keeps this repo's boundary pins
intact, and simply promotes the runbook's already-default fast path to the sole
rollback mechanism. (b) re-creates the public surface the operator deliberately
removed on 2026-07-04 and is largely superseded by TIN-2421 anyway; (c) reverses
0003 against unresolved substrate blockers and is out of this repo's authority.

This is an **operator ruling** — 0007 stays **Proposed** until the operator
signs. If the operator prefers an always-available independent second origin
over minimal change, (b)-via-public-`build/`-mirror is the fallback choice; (c)
stays parked behind the 0003 blockers.

## Consequences if (a) is adopted

Three concrete doc changes, and nothing else in this brief mutates the edge or
cluster:

1. **Annotate/supersede 0003.** Replace 0003's "GH Pages retained as rollback
   publisher" framing (Decision 1 + Consequences "cold-standby publisher")
   with single-publisher rollback, under the no-silent-rewrite rule (retain the
   superseded text, cite this ADR).
2. **Update `docs/runbooks/cf-pages-rollback.md`.** Demote the "Full path: move
   the serving substrate back to GitHub Pages" section (and the "Rollback
   publisher of record: GitHub Pages" posture line) to a documented-inviable
   note referencing repo privacy, so the runbook stops instructing a path that
   cannot execute while the repos are private.
3. **Close the 0001 Amendment 2 flag.** Resolve the "GH Pages rollback (ADR
   0003) requires public-or-paid — acceptable while CF Pages is primary" line
   to "resolved by 0007: CF Pages single-publisher rollback adopted," so the
   record shows the gap was decided rather than left dangling.

If instead the operator picks (b) or (c), the follow-on doc set changes
accordingly (b restores the runbook full path + adds a mirror-sync doc; c adds
a rollback-only on-cluster section gated on the 0003 blockers) — but the
default assumption for downstream work is (a).
