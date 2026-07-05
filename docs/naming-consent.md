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

## Pre-flip audit addendum (TIN-2421, 2026-07-04)

Appended by the apex-flip readiness pack
(`docs/launch/apex-flip-readiness.md`). This section **records newly-found
surfaces**; it does not restate or overrule the tracker rows above. No consent
status is changed here — these are operator escalations.

### A. New surfaces found for already-tracked names (Surface column is stale)

- **Ripley** also appears on **`/cells`** ("Captain: Ripley." via
  `src/lib/data/cells.ts:73`) and **`/cells/welding`** ("Ripley's cell",
  `src/routes/cells/welding/+page.svelte:32`). The tracker row lists only
  `/shout-outs`. Ripley is CONSENTED, so this is a documentation gap, not a
  blocker — but the Surface column should be updated to include `/cells*`.
- **Jess Sullivan** also appears on **`/cells`** ("Captain: Jess." via
  `src/lib/data/cells.ts:66`) and **`/plans`** ("webmaster Jess"). SELF consent
  covers these; noted for completeness.

### B. LIVE CONSENT LEAK — blocks A5 (redaction required before flip)

- **`static/readme.txt:29`** publishes **"Joe (Lewiston alderman -- the bus
  lives on his property)"**. The operator ruling (2026-07-04) consented this
  person **only to the initial-only credit "J."** (see the "J." row above and
  `/shout-outs`). `static/readme.txt` is a public, indexable file served at
  `/readme.txt`. Publishing the full first name exceeds the recorded consent.
  **Action: redact "Joe" → "J." before the Access gate opens.** (PR #69 fixed
  the Kate→Ripley leak in this same file but did not catch "Joe".)

### C. PENDING org/reference rows still block A5 as written

The five PENDING rows above (Portland makerspace community, Ithaca Generator,
Artisan's Asylum, Cornell CALS Landscape Architecture makerspace, Plymouth State
D&M Makerspace) are neither agreed-and-dated nor redacted. Per the policy
("stakeholder / **reference**") and rule 3 above, they must be resolved or
**escalated to the operator** before the flip — they cannot be left to block
silently.

### D. Open operator confirm (do not resolve here)

The Ripley-vs-Kate-Pulham **D4 wording sign-off** remains open and is shared
with **TIN-2516** (copy-audit P1); it gates gate-opening criteria **A2 and A5**.
Verified separately: "Kate" / "Pulham" / "krosepulham" appear on **no** public
route or static file — the on-site redaction to "Ripley" is complete, so the
open item is the wording sign-off, not a live leak.
