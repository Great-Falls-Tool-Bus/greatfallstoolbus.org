# 0004 — Gate-opening criteria (D2, REV-3 packet)

- Status: **PROPOSED** — operator signs; until signed, gate-opening remains
  UNOWNED
- Date: 2026-07-03 (drafted in the grounding-audit wf_0118a02c DOC-TRUTH wave)
- Decision ID: D2
- Amends when signed: 0001 (row f gate-open end-state gets an owned trigger),
  0003 ("SEO remains deferred by decision (REV-2) until the gate opens" gets
  an exit condition)
- Related: TIN-2378 (closed Done 2026-07-03T17:25Z — NS cutover executed),
  TIN-2419 (Wave-3 prose), TIN-2420 (Anubis origin placement, deferred), D4
  (Kate Pulham wording sign-off), 0005 (Wave-1 content ratification, D3)

## Problem

The **founding ask was a public, indexable site** (prompt-50). REV-2 gated the
launch behind Cloudflare Access — a sound interim posture — but assigned **no
exit owner and no exit condition**. Today the apex, `www`, and `pages.dev`
hosts all serve from Cloudflare Pages and all 302 to Access login, with an
allowlist of exactly one person (jess@sulliwood.org). An open-ended gate with
no owner is structurally indistinguishable from "gated forever."

## Cost of gated-forever

Every day the gate stays closed with no exit condition, the site accrues the
opposite of its founding ask: **zero SEO** (nothing is crawlable, so the
site's search presence never starts compounding); **donors can't see the
donate page** (the tools-only ask of 0001 row (h) is invisible to the people
it addresses); **designers can't see the site** (the Wave-3 logotype and prose
work must be reviewed through screenshots or allowlist churn instead of a
URL); and the **og-image is useless** (link previews cannot render behind an
Access 302, so every share of greatfallstoolbus.org is a blank card). None of
this is an argument against having gated — it is the argument for deciding
how the gate opens.

## Option A (RECOMMENDED) — criteria-based opening

The gate opens when **all four** criteria hold; no date is set, and no
criterion may be waived silently.

| # | Criterion | Evidence of "done" |
| --- | --- | --- |
| A1 | Wave-3 prose sign-off | TIN-2419 closed Done |
| A2 | Kate Pulham wording sign-off (D4) | the open checkbox in 0001's sign-off record is checked, with the agreed copy landed |
| A3 | Mail/list smoke green | TIN-2379 CRs applied and a keyholders@latoolb.us round-trip + list smoke passes |
| A4 | Allowlist expanded (Alex/Kate/Joe) | the three named reviewers have seen the gated site through their own Access logins before the flip |

**Execution on the day the last criterion lands (small by design):**

1. **One-line Access-policy flip** — the apex/`www`/`pages.dev` Access
   application goes from allowlist to public (or is removed).
2. **og/SEO activation** — robots/sitemap/indexing posture flips from the
   deferred REV-2 stance to public; og cards start rendering.
3. **latoolb.us 301 target becomes real** — the dormant Cloudflare redirect
   ruleset finally points at a page anyone can load (NS delegation for
   latoolb.us remains a separate decision, D1).

## Option B — hard date

Pick a calendar date now; the gate opens then regardless of criteria state.
Rejected as recommended because A2–A3 are not operator-schedulable alone, and
a date that arrives before mail smoke passes would open a site whose contact
path doesn't work.

## Option C — gated-until-notice, monthly review

Keep the gate closed indefinitely; the operator re-reviews monthly. Honest
about the present, but it re-creates the exact defect this packet exists to
fix: no exit condition, and the cost-of-gated-forever paragraph keeps
accruing.

## Sign-off (operator)

- [ ] Option A (criteria-based, recommended) — the four criteria above become
      binding and gate-opening is thereby OWNED
- [ ] Option B (hard date: \_\_\_\_\_\_\_\_)
- [ ] Option C (gated-until-notice, monthly review)
- [ ] Amendments to the criteria set (note inline)
