# Naming-consent tracker

- Status: LIVE tracker (not a decision packet) — update in place as consent
  lands
- Date opened: 2026-07-03 (DECISION-APPLICATION wave)
- Related: 0004 (gate-opening criteria, A5), TIN-2421 (gate-opening owner)

## Policy (verbatim, operator, 2026-07-03)

> Will withhold all shoutouts / names publicly until each stakeholder /
> reference has agreed to be named.

Names may exist on the site while it is **gated** (Cloudflare Access,
allowlist of one). They must not survive into the **public** flip unless the
row below is marked agreed. The pre-flip naming-consent sweep — confirming
every row below is either agreed-and-dated or redacted — is gate-opening
criterion **A5** in `docs/decisions/0004-gate-opening-criteria.md`, tracked
under **TIN-2421**. An unconsented name is not an oversight to fix later; it
is a blocker to the gate opening at all.

## Tracker

| Name / org | Surface | Asked? | Agreed? | Date | Notes |
| --- | --- | --- | --- | --- | --- |
| Ripley (gh: krosepulham) | /shout-outs (Founding supporter) | Yes | CONSENTED | 2026-07-04 | Operator ruling 2026-07-04: public name = Ripley (was Kate Pulham). D4 wording sign-off still tracked separately. |
| J. (Alderman, Lewiston) | /shout-outs (hosts the bus) | Yes | CONSENTED | 2026-07-04 | Operator ruling 2026-07-04: initial-only credit approved. |
| Alex | /shout-outs (Founder) | Yes | CONSENTED | 2026-07-04 | Operator ruling 2026-07-04: first-name credit approved. |
| Jess Sullivan | /shout-outs, /stewards (footer/links) | N/A | SELF | 2026-07-03 | Operator's own name/bio; self-consent stands, listed here for completeness only |
| The Portland makerspace community | /shout-outs (Friends of the bus) | No | PENDING | — | Community reference, not an individual — confirm who can speak for it before public flip |
| Ithaca Generator | /shout-outs (Friends of the bus) | No | PENDING | — | Added per D10; org reference (501(c)(3) makerspace), needs org-level consent before public flip |
| Artisan's Asylum | /shout-outs (Friends of the bus + About-Jess bio) | No | PENDING | — | Referenced twice (friends list + bibliography credit); one consent covers both |
| Cornell CALS Landscape Architecture makerspace | /shout-outs (About-Jess bio) | No | PENDING | — | Institutional reference in Jess's own bio; lower priority but still in scope of the policy |
| Plymouth State D&M Makerspace | /shout-outs (About-Jess bio) | No | PENDING | — | Institutional reference in Jess's own bio; lower priority but still in scope of the policy |

## How to update this tracker

1. When a name is asked, set "Asked?" to Yes and note the channel (email,
   Linear comment, verbal + written follow-up).
2. When agreement lands, set "Agreed?" to YES, fill in the date, and note
   where the agreement is recorded (Linear comment link, email thread, etc.).
3. If a name is declined or unreachable before the gate-opening date, redact
   it from the live site in the pre-flip sweep rather than leaving it PENDING
   indefinitely — do not let a stale PENDING row block the flip silently;
   escalate to the operator instead.
4. This file is the single source of truth for A5. Do not duplicate the
   tracker elsewhere.
