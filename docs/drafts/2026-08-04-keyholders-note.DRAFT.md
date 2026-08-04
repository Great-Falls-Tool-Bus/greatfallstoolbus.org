# DRAFT — keyholders@ note to Alex (2026-08-04)

- Status: **DRAFT for operator send. Not sent. Agents never send email.**
- Date: 2026-08-04
- Draft ID: TIN-3437
- Amends: nothing. This is a message draft, not a decision packet — it changes
  no decided row and cannot.
- Related: `docs/decisions/0001-gftb-mvp-decisions.md` row (h) (TOOLS-ONLY,
  binding), `docs/ux-research.md` (no fee / no paperwork), `docs/naming-consent.md`
  (Alex + J. consent rows), `docs/launch/apex-flip-readiness.md` §A1
  (501(c)(3)/fiscal-sponsor status is an open operator input),
  `great-falls-tool-bus-infra/docs/runbooks/list-operations.md` (routing + roster)

---

## Operator preamble — NOT part of the message

Everything above the `====` separator is for you. Send only what is below it.

### Routing: `keyholders@latoolb.us`, not `discuss@latoolb.us`

All four reasons **OBSERVED** in
`great-falls-tool-bus-infra/docs/runbooks/list-operations.md`
§1 and §5 (ratified 2026-07-04 baseline, verified live against GNU Mailman
3.3.10 in `latoolb-us-production`):

1. **Archive.** `keyholders@` is `archive_policy=private`; `discuss@` is
   `archive_policy=public`. This note describes an outside conversation the
   operator has not had or scheduled, and documents that are not written yet.
   That does not belong in a permanent public archive.
2. **Audience is curated.** `keyholders@` is `subscription_policy=moderate`
   (owner-approved); `discuss@` is `confirm` — anyone can self-subscribe with an
   email confirmation. The intended readers here are the keyholder set, not the
   general public.
3. **Not advertised.** `keyholders@` is `advertised=false`; `discuss@` is
   `advertised=true`. The list is deliberately unlisted.
4. **Fan-out works without a moderation hold.** `keyholders@` has
   `default_member_action=accept` and `default_nonmember_action=accept`, so the
   note reaches every keyholder on send. On `discuss@`, `default_nonmember_action`
   is `hold` — a non-member send would sit in the moderation queue instead.

### Provenance of the message's factual claims

| Claim in the message | Status |
| --- | --- |
| Bus sits on J.'s property today | **OBSERVED** — `docs/naming-consent.md` ("J. … hosts the bus"), `docs/launch/apex-flip-readiness.md` |
| No entity / no fiscal-sponsor answer yet | **OBSERVED** — `docs/launch/apex-flip-readiness.md` §A1 lists 501(c)(3)/fiscal-sponsor status as an open operator input blocking A1; `0001` row (h) is TOOLS-ONLY *until an entity exists* |
| Access is currently no-fee, no-paperwork | **OBSERVED** — `docs/ux-research.md` §2 (`/access` free, donations optional, still `OPERATOR-CONFIRM`) and §1 ("Anyone can ask to borrow" posture) |
| Bus location is shared privately on request | **OBSERVED** — `docs/ux-research.md` update 2026-07-05 (`/find-the-bus`, PR #64) |
| The economic-development conversation is an **intent, not a booking** | **OBSERVED** — operator ruling 2026-08-04 (TIN-3438 resolved): nothing is scheduled. The message says so explicitly. An earlier revision of this draft announced a "Friday" trip; that was wrong and has been removed. |
| Wednesday document delivery; the physical-infra intents | **[UNVERIFIED — needs operator]** — operator-supplied intent; no in-repo record exists in either `greatfallstoolbus.org` or `great-falls-tool-bus-infra` (grepped 2026-08-04, zero hits for "chamber", either economic-development org acronym, or "solar") |
| Wednesday resolves to 2026-08-05 | **INFERRED** from today's date (2026-08-04, a Tuesday). Confirm before sending; no other date appears in the message. |
| The solar server is an **open question**, not a want | **OBSERVED** — `docs/decisions/0012-power-and-physical-plant-draft.md` exists to make it annotatable as (a) dropped, (b) re-scoped to mains-fed-on-UPS, or (c) a written dated override of the operator's prior mains+UPS ruling. The message must not, and now does not, pre-commit to (c). |

### Guardrails this draft is written to respect

- **No dollar figures, no membership prices, no legal claims** appear below.
  The membership/money draft carries the options; this note must not pre-empt it.
- **`0001` row (h) is TOOLS-ONLY and stays that way.** If the membership/money
  document ends up proposing anything other than tool donations, that requires a
  written, dated **Amendment 4** in the established form (superseded text
  retained, operator signature). Nothing in this note changes it, and no agent
  is authorized to.
- **No membership fee, no paperwork wall** is a live position
  (`docs/ux-research.md`). Any tiered or paid model contradicts it; the drafts
  should say so plainly rather than quietly working around it.
- **"Keyholder" vs the `/stewards` role ladder is still an unreconciled
  taxonomy** (`docs/ux-research.md` §2, open checklist item). The note uses
  "keyholders" only as the list name, and does not assign anyone a role.
- **No address.** Bus location is request-gated; the message says nothing about
  where the bus is beyond naming J. (initial-only consent, granted 2026-07-04).
- **Org naming — NO organization is named in the message.** The two
  economic-development organizations the operator mentioned verbally are **not**
  on the `docs/naming-consent.md` tracker and are **not** GFTB affiliates or
  supporters. **This repo is PUBLIC** (OBSERVED 2026-08-04: `gh repo list
  Great-Falls-Tool-Bus` returns all four repos `PUBLIC`; anonymous `curl` of the
  repo URL returns HTTP 200 — see `0001` Amendment 4), so a draft committed here
  is world-readable and the earlier "private list" rationale no longer covers it.
  Both names were therefore **dropped** rather than kept-with-a-caveat; "a local
  economic-development conversation" carries the same meaning and names no one.
  Do not reintroduce either name into this repo, onto the site, into
  `/shout-outs`, or into any archive without a consent row.
- **Professional boundaries you'll hit in the two documents, not here:** entity
  formation and fiscal sponsorship are a **lawyer** question (Maine nonprofit /
  fiscal-sponsor counsel); any deductibility statement is a **CPA** question;
  routing power to the bus is a **licensed electrician** question plus a
  **municipal code/permitting authority** question; anything about who is covered
  if someone is hurt is an **insurance broker** question. Do not let the drafts
  answer any of those internally.

====

## MESSAGE — send this part only

**To:** keyholders@latoolb.us
**Subject:** Two drafts for you Wednesday

Alex —

Short one.

At some point I want to have a local economic-development conversation and
introduce the tool bus that way. Nothing is booked — no date, no meeting, nobody
expecting me. It's an intention, not a calendar entry, and I'd rather say that
plainly. When it happens it's exploratory only: I'm not asking anyone for money,
space, or a letter, and I won't describe us as more settled than we are — we
still don't have an entity. Mostly I want to find out who around here is already
doing something adjacent, and where a tool bus fits. I'll write up whatever I
learn.

Wednesday you'll have two documents to mark up:

1. **Membership and money** — how someone gets access, and what if anything we
   ever ask of them.
2. **Power and physical plant** — where the bus lives and what it takes to run
   real equipment there.

Both are drafts with the hard questions marked, not proposals. Where there's a
real decision I've written the options instead of picking one. If you think an
option shouldn't even be on the list, say that in the margin — that's the most
useful kind of note.

On the physical side, two of the three things I want are settled in my head:
move the bus, and get power properly routed to it. Those unblock everything
else. The third — whether we stand up a solar server at all — is the open
question the second document argues about, and I'm not answering it here. I've
held that servers run on mains with a UPS; choosing solar would be me overriding
myself, and that belongs in a dated decision we both looked at, not an email.
Treat it as open and tell me where you land.

Two things I need back:

- **Annotations on both drafts.** Rough is fine. Disagreement is better than
  approval.
- **Where the bus is going.** It's on J.'s property today, and I can't scope the
  power work — or much else — until that's answered. That one isn't mine to
  decide alone.

Nothing else is urgent this week. Thanks for staying in this.

— Jess

====

## Operator checklist before sending

- [ ] **Confirm the two documents are actually committed and pushed.** The note
      promises them Wednesday; do not send it against uncommitted work. Check
      both repos are clean and the drafts are on a pushed branch before the note
      goes out. (`greatfallstoolbus.org` was on
      `docs/adr-0010-pages-decommission-executed` @ `7d1e23e`, clean, as of
      2026-08-04.)
- [ ] **Verify Alex is on the `keyholders@` roster before sending.** Per
      `great-falls-tool-bus-infra/docs/runbooks/list-operations.md` §3 — REST is
      bound to the pod IP, so `kubectl exec`, not `port-forward`. The exact
      roster-read command lives in
      `great-falls-tool-bus-infra/docs/runbooks/list-operations.md` §3 — run it
      from there rather than copying cluster coordinates into this repo, whose
      ADR 0001 row (d) forbids cluster hostnames and endpoints here.

      If Alex is not on it, add with consent — either the candidate-initiated
      `keyholders-join@latoolb.us` flow, or an owner-initiated REST add with all
      three `pre_*` flags (§3 of the runbook). Do not subscribe anyone who hasn't
      agreed to be subscribed.
- [ ] **Confirm a meeting exists at all.** As of 2026-08-04 nothing is
      scheduled (TIN-3438) and the message says so. If a meeting *has* since
      been booked, that is a change of fact — update the message before sending
      rather than letting "nothing is booked" go out stale.
- [ ] **Confirm the Wednesday delivery date** (drafted assuming 2026-08-05).
- [ ] **Re-read for leaks before send:** no address, no organization names, no
      dollar figures, no membership price, no claim about deductibility, entity
      status, insurance, or electrical code.
- [ ] **Do not cross-post to `discuss@latoolb.us`** — its archive is public and
      permanent.
