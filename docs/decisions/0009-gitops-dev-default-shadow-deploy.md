# 0009 — GitOps: dev-default branch with shadow-deploy; main is the CF production branch

- Status: **PROPOSED** (Option 3) — trigger delta applied; the operator-gated
  steps below are NOT taken in this PR
- Date: 2026-07-04
- Linear anchor: TIN-2515
- Amends: 0003 (Decision 1 hosting posture — adds the branch/promotion model
  that 0003 left implicit: `deploy-pages.yml` there triggered on `main` only)
- Related: 0004 (gate-opening criteria — the beta host stays Access-gated until
  the same five criteria open the apex)

> **Annotation - 2026-07-05 (ADR 0010, operator ruling).** The operator ruled
> on-prem is the production host and Cloudflare Pages spins down
> (`0010-on-prem-is-the-production-host.md`, **Accepted**). The
> Cloudflare-Pages-branch model below (main = CF production branch, `dev` =
> CF beta branch) is **retired at cutover** with the Pages project. Its intent
> (a dev-default flow with a private pre-production preview, promotion by a
> deliberate `dev` -> `main` merge) carries forward, but the preview substrate
> moves to the **on-cluster reaper pattern** (0010 §4), which needs an infra-side
> companion decision (TIN-2535 reopened in spirit). This ADR stays **PROPOSED**
> and is superseded in its serving substrate by 0010; nothing here is applied
> until 0010 §5 completes and the preview lane is re-decided infra-side.

## Problem

0003 bound serving to Cloudflare Pages and rebuilt `deploy-pages.yml` to trigger
on `main` push / `main` PR only. That gives one branch and one deploy target:
every change reaches the production branch directly, and there is no
pre-production surface to preview a change on its own Access-gated URL before it
is promoted. We want a **dev-default GitOps flow**: routine work lands on `dev`
and shadow-deploys to a beta URL; `main` stays the deliberate production branch.

## Decision (Option 3) — dev-default + shadow-deploy, main = CF production branch

The trigger set of the spoke's thin `deploy-pages.yml` becomes:

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [dev]
  workflow_dispatch:
```

- **Shadow-deploy:** a push to `dev` deploys to the beta preview branch on the
  same Cloudflare Pages project; a push to `main` deploys the production branch.
  Both go through the *unchanged* `tinyland-inc/ci-templates` reusable lane with
  the *unchanged* explicit `secrets:` mapping — CF creds are passed explicitly,
  not inherited (0003 Decision 1 credential doctrine; do not switch to
  `secrets: inherit`).
- **main = CF production branch, independent of the GitHub default branch.**
  Cloudflare Pages' "production branch" is a project-level setting; it stays
  `main` regardless of what GitHub's default branch is set to. Retargeting the
  GitHub default to `dev` (a separate, operator-gated step — see below) does
  **not** move CF's production branch, and must not be assumed to.
- **Promotion = a deliberate `dev` → `main` merge.** Production changes happen
  only by merging `dev` into `main`; there is no direct-to-`main` routine path
  once the default flips. Promotion is an explicit, reviewed act.
- **Beta URL is already Access-gated.** `dev.greatfallstoolbus-org.pages.dev` is
  covered by the existing `*.greatfallstoolbus-org.pages.dev` Cloudflare Access
  application (the same wildcard that gates every `pages.dev` preview host per
  0003 / 0004). No new Access work is needed to keep the shadow surface private;
  it inherits the gate.

## GitHub-Free constraint (recorded, not worked around)

The promotion gate — "production changes only via `dev` → `main` merge" — is
**convention, not an enforceable rule**. Branch protection (required reviews,
required status checks, restrict-who-can-push) is unavailable on **private repos
on the GitHub Free plan**, which is this repo's plan. There is therefore no
server-side control preventing a direct push to `main`; the discipline is
social/procedural and lives in this ADR and in reviewer habit. If the repo moves
off Free (or public), the convention should be hardened into an actual branch
protection rule on `main`.

## Scope of the applying PR

This PR touches **only**:

- `.github/workflows/deploy-pages.yml` — the two-line trigger delta above.
- this decisions note.

It does **not** touch the reusable `uses:` pin, the explicit `secrets:` mapping,
infra / Access / Cloudflare / the `ci-templates` reusable workflow, or any UI
surface.

## Operator-gated follow-ups (NOT done here)

1. **Swap the GitHub default branch to `dev`.** Operator-gated: it retargets the
   base of everyone's open and future PRs. Not done in this PR.
2. **Create the `dev` branch.** Not created here; the trigger is inert until a
   `dev` branch exists. (Pushing `dev` starts the shadow-deploy on next push.)
3. **Confirm the Cloudflare Pages production branch is `main`.** A Pages
   project-level setting; confirming/adjusting it is infra work outside this
   repo and is operator-owned (0003 keeps DNS/Access/Tunnel and CF project
   settings in the overlay/infra lane, never in the spoke).

## Consequences

- Once `dev` exists and the default flips, routine work previews on the
  Access-gated beta host before promotion; `main` deploys only on a deliberate
  merge.
- No enforceable server-side promotion gate exists on GitHub Free; the model
  depends on convention until the plan/visibility changes.
- The credential doctrine and reusable-lane pin from 0003 are unchanged; this
  ADR only widens the trigger set.
