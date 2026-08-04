# 0011 — Membership, money, and the keyholder/steward taxonomy (DRAFT)

- Status: **DRAFT — FOR ANNOTATION, NOT DECIDED**
- Date: 2026-08-04 (drafted for the operator + Alex annotation session,
  Wednesday 2026-08-05)
- Decision ID: **unassigned** — a D-number is minted only if and when a row
  below is signed. Nothing here is in force.
- Amends: **nothing.** This draft amends no decision and changes no live
  copy. Several options below *would* require amendments — each says so, by
  name, at the point it applies.
- Related: TIN-3440 (this document); `0001-gftb-mvp-decisions.md` row (h)
  (TOOLS-ONLY, DECIDED 2026-07-02); `0005-wave1-content-ratification.md`
  rows 2/3/6 (D3, 2026-07-03); `0004-gate-opening-criteria.md` A1 and A5;
  `docs/ux-research.md` §2–§4; `docs/naming-consent.md`;
  `docs/launch/apex-flip-readiness.md`

---

## Problem

Three separate questions have been arriving as one — "membership" — and they
are not the same question:

1. **Vocabulary.** The site uses "keyholder" everywhere and defines a
   *different* three-role ladder on `/stewards`, with no stated relationship
   between them. `docs/ux-research.md:106-127` calls the path to becoming a
   keyholder "the biggest gap found," and §3's checklist item — *"Reconcile
   'keyholder' and the `/stewards` role ladder into one vocabulary, or
   explicitly map them"* (`ux-research.md:155-157`) — is still unchecked.
   **(OBSERVED)**
2. **Membership.** Whether there is a thing to join at all, and whether
   joining costs anything.
3. **"Trust equity."** A phrase that has arrived in conversation and has
   **zero precedent anywhere in this repo** — grepped `docs/`, `src/`,
   `static/`: no hits. **(OBSERVED)** Its three plausible meanings have
   nothing in common with each other.

This document's job is to make those three answerable on Wednesday. It is
**not** a recommendation, and it does not resolve anything. Where a question
belongs to a lawyer, a CPA, an insurance broker, or the operator, it is
marked and handed over rather than answered.

---

## Binding constraints (all OBSERVED — read before annotating)

| # | Constraint | Source | Status |
|---|---|---|---|
| B1 | **TOOLS-ONLY.** The site accepts tool donations only until an entity exists; money conversations happen **off-site, person-to-person**; **zero tax-deductibility claims** | `0001-gftb-mvp-decisions.md:24` row (h) | **DECIDED 2026-07-02, operator sign-off. BINDING.** Changing it requires a written, dated **Amendment 4** in the established form (superseded text retained, operator signature) |
| B2 | **Free-after-orientation access stands as shipped.** *"Free/open after a short safety orientation; donations optional; equity-forward ('nobody turned away for inability to pay')"* | `0005-wave1-content-ratification.md` row 2; outcome: **"PROVISIONALLY RATIFIED … refine in Wave-3 rather than reopening now"** | **RATIFIED 2026-07-03.** Note: this **supersedes** the "not yet operator-confirmed" note at `ux-research.md:84-86, 171-174`, which predates D3 and is stale |
| B3 | **No membership fee, no paperwork wall** is live copy in four places (re-verified 2026-08-04): `src/routes/+page.svelte:236`, `src/routes/tools/+page.svelte:50`, `src/routes/contact/+page.svelte:194-195` (sentence wraps; phrase lands on 195), `src/routes/mission/+page.svelte:48`. Separately, `mission/+page.svelte:31` carries the **fee half only** — "no membership fee, and nobody is turned away for inability to pay" — which is the seam discussed below, not a fourth instance of the full phrase. `contact/+page.svelte:146` states flatly **"Borrowing is free."** | live site source | Live and, per B2, ratified |
| B4 | GFTB is an **unincorporated community project**: no nonprofit entity, no fiscal sponsor, no deductible donation | `src/routes/mission/+page.svelte:60-63`; `static/readme.txt:32`; ratified as row 1 of D3 ("Unincorporated is correct") | Live. `mission/+page.svelte:63` still carries an `OPERATOR-CONFIRM` comment in source, but D3 row 1 ratified the copy |
| B5 | **There is no entity, no fiscal sponsor, and no insurance.** 501(c)(3)/fiscal-sponsor status is an **open operator input already blocking gate criterion A1** | `docs/launch/apex-flip-readiness.md:164` | OPEN |
| B6 | The **steward roster is intentionally EMPTY** and *"Do NOT invent names here"* | `src/routes/stewards/+page.svelte:9-11, 55-61`; D3 row 6 **PENDING**, now also gated by naming consent (A5 / TIN-2421) | Binding on this draft |
| B7 | **Naming consent gates all public naming.** Five org/institution rows are **PENDING**; the gate score is **1 of 5** | `docs/naming-consent.md`; `apex-flip-readiness.md` headline | **A5 NOT MET** |
| B8 | The bus currently sits on **J.**'s property. **J.** has **initial-only** name consent | `docs/naming-consent.md` ("J." row, CONSENTED 2026-07-04, initial-only); `apex-flip-readiness.md:44` | Binding |
| B9 | The keyholders list addresses (`keyholders@`, `-join@`, `-owner@`, `-leave@`) are **live production mail** with a ratified Mailman baseline (A3 MET; TIN-2379/TIN-2380 Done 2026-07-04) | `apex-flip-readiness.md` §4 row A3 | A **vocabulary change is a copy change, not a mail change** |

**Two tensions worth naming out loud before Wednesday (INFERRED from the
sources above, for the operator to resolve or dismiss):**

- B2's ratified phrase *"donations optional"* and *"nobody turned away for
  inability to pay"* is sliding-scale vocabulary; B1 says money conversations
  do not happen on-site. Live copy at `mission/+page.svelte:31` carries the
  "nobody turned away for inability to pay" clause next to "there is no
  membership fee" — a sentence that presupposes a paying concept the project
  does not have. Not a contradiction that breaks anything today, but it is
  the seam any fee discussion will open along.
- `ux-research.md` routinely cites `/access` and `/find-the-bus` as standalone
  routes. They are not: both are now **anchored sections on `/contact`**
  (`#access`, `#find-the-bus`) per the documented nav decision at
  `src/lib/nav-items.ts:73-80`. **(OBSERVED)** Read ux-research's route
  citations as historical.

---

## R — Keyholder / steward taxonomy

### The defect (OBSERVED)

"Keyholder" is the ambient site-wide word for the humans who answer access
requests and share the bus location. It appears across `/`, `/safety`,
`/tools`, `/cells/*`, `/cell-sheets`, `/contact`, `/donate` ("reach a
keyholder"), the `/keyholders` mail guide, `static/readme.txt`, and
`static/llms.txt`, and it names the live mail role list
(`contact/+page.svelte:412`: *"a private access-gating role list: keyholder
membership is curated"*; `src/lib/data/mail-clients.ts:233`: *"Membership is
curated and owner-approved. It is for keyholders who steward access to the
bus, not a public discussion room."*).

`/stewards` defines a *different* three-role ladder —
**Coordinator**, **Cell captains / shop leads**, **Safety steward**
(`src/routes/stewards/+page.svelte:12-25`) — and never mentions keyholders
except inside the Coordinator description ("keyholder communication").
`/stewards` is additionally **footer-only, hard-coded in `+layout.svelte`**
and excluded from the primary nav array by a documented decision
(`src/lib/nav-items.ts:77-78`), and its roster is empty (B6).

So a volunteer cannot tell whether "keyholder" and "cell captain" are the
same commitment, different ones, or how one maps onto the other.

### R1 — Keyholder is an ACCESS GRANT; steward roles are JOBS (orthogonal)

A keyholder is anyone trusted to receive an access request and share the
location — operationally, anyone on `keyholders@`. Coordinator / cell captain
/ safety steward are **jobs**, each held by a keyholder; keyholding itself is
not a job.

- **For:** matches the infrastructure exactly — `keyholders@` *is* the
  access-gating role list (B9). Zero mail changes, minimal copy changes. A
  person can be a keyholder without taking a job, which is the honest current
  state given the empty roster (B6).
- **Against:** two words for two things that people will keep conflating.
  Requires one clarifying sentence wherever "keyholder" first appears on a
  page. Does not by itself create the "interested → onboarded" path
  `ux-research.md:107` says is missing.

### R2 — Keyholder is the ENTRY RUNG of one ladder

Keyholder → cell captain → safety steward → coordinator, as a single named
progression.

- **For:** one vocabulary, and a legible path from "interested" to
  "onboarded" — the exact gap named at `ux-research.md:106-118`.
- **Against:** it is factually wrong about the roles as written. Safety
  steward and coordinator are **lateral specialisms**, not seniority tiers —
  `stewards/+page.svelte:22-24` gives the safety steward program-wide
  authority ("the call on whether a tool or a practice is safe to allow"),
  which is not a promotion from captain. It also makes "keyholder" read as
  junior when it is the trust-bearing role. Implies a hierarchy the project
  may not want.

### R3 — Retire one of the two words

Either (a) drop "steward" and use keyholder-plus-role throughout (keyholder;
keyholder / cell captain; keyholder / safety), or (b) drop "keyholder" from
public prose and use steward vocabulary everywhere, keeping "keyholders@" as
a **list name only**.

- **For:** removes the ambiguity permanently; lowest ongoing explanation cost.
- **Against:** by far the largest copy change — it touches `/`, `/tools`,
  `/safety`, `/donate`, `/cells/*`, `/cell-sheets`, `/contact`,
  `/keyholders`, `static/readme.txt`, and `static/llms.txt`. Under (b), the
  word stays load-bearing in mail regardless, so the site and the
  infrastructure would deliberately speak different languages.

> **Hard constraint on all three (B9):** the keyholders addresses are live
> production mail with DKIM-signed DNS and a MailAccount controller. **Do not
> let a vocabulary decision turn into a mail migration.** Whatever is chosen,
> the list keeps its name.

---

## M — Membership model

Every option below is scored against **B1 (TOOLS-ONLY)**, **B2 (ratified
free-after-orientation)**, and **B3 (live no-fee/no-paperwork copy)**. Where
an option contradicts one, the amendment it would require is named.

### M1 — No membership at all (status quo, formalized)

There is nothing to join. Ask a keyholder, do the safety orientation for the
capability you need, borrow the tool.

- **Cost to borrower:** $0. **Paperwork:** none. **Record kept:** whatever the
  keyholder remembers plus whatever is in the `keyholders@` thread.
- **Against B1/B2/B3:** **fully consistent.** No amendment needed. This is
  what the site says today.
- **For:** the zero-barrier property is the project's strongest equity
  feature and its current voice. Nothing to administer, no personal data
  pile, no money.
- **Against:** no roster, so no way to know who has what; no way to reach a
  borrower if a tool is recalled or a defect is found; **no roster to
  underwrite against** if insurance is ever sought (see L-4); and nothing
  concrete to show a partner org, a grantor, or a chamber. Note the closest
  no-barrier precedent in the research — Berkeley Public Library's tool
  lending library (`ux-research.md:192-206`) — is a *library department*: the
  institution carries the liability. GFTB has no institution (B5).

### M2 — Named membership, free, no tiers (a roster, not a fee)

You become a member by asking and completing a safety orientation. Free,
permanently. One tier. The roster exists so the project knows who its people
are.

- **Against B1:** consistent — no money changes hands.
- **Against B2/B3:** consistent on fee; **"no paperwork wall" needs a ruling.**
  A roster is, minimally, a name and a way to reach you. Whether that counts
  as a paperwork wall is a judgment call, and it is the operator's.
- **For:** keeps the zero-fee property fully intact while creating the roster
  M1 lacks. Slots cleanly under any of R1/R2/R3. Gives the stewards roster
  (B6, D3 row 6) a population to draw from.
- **Against:** **a roster is personal data with no entity to be responsible
  for it (B5).** The keyholders archive is already private precisely because
  access traffic carries names, contact details, tool needs, and scheduling
  context; a membership roster is that data at scale and permanently. Needs a
  written retention/deletion answer and a named data controller **before the
  first name is written down** — see **L-5**.

### M3 — Sliding scale, never turned away (the Station North pattern)

A suggested contribution scaled to income, published inline with a worked
example and an explicit $0 option that requires no explanation.

- **Documented precedent (OBSERVED):** Station North Tool Library —
  *"Sliding-scale $1 per $1,000 of annual income, never turn away for
  inability to pay, mandatory shop-safety orientation"*
  (`src/routes/bibliography/+page.svelte:77`), with the worked example
  *"$50,000 income = start at $50"* and Cost/Benefits/Action in separate
  labeled sections (`ux-research.md:192-206`). Berkeley is the documented
  **negative** example there — it defers loan periods and fines to a separate
  linked page; if any policy is ever adopted it should stay **inline**.
- **Against B1: DIRECT COLLISION.** Row (h) is TOOLS-ONLY *until an entity
  exists*, and money conversations are off-site and person-to-person. A
  published sliding scale is an on-site money conversation. **M3 is not
  adoptable without either an entity existing, or a written, dated
  Amendment 4 to `0001` row (h).**
- **Against B2/B3: DIRECT COLLISION.** "No membership fee" is live in four
  places and provisionally ratified. Adopting M3 means **amending D3 row 2**
  as well as row (h) — two amendments, not one.
- **For:** funds something without a hard gate; a well-tested pattern in
  exactly this sector; the equity language already on `/mission` is
  compatible with it.
- **Against, beyond the amendments:** with no entity, money lands in a natural
  person's account — becoming that person's income, or an untracked pot, with
  a charitable-solicitation question attached (**L-2**).

### M4 — Tiered membership (Basic / Standard / Premium)

Tiers differentiated by access hours, tool classes, and storage.

- **The only tier table available to this project** is one the operator holds
  in a private internal operations repo — Basic (weekday access, basic tools) /
  Standard (full access, all tools) / Premium (24/7 access, storage), with the
  three fees left as literal `$[XX]` placeholders, plus seven
  membership-agreement terms (liability waiver, safety training, equipment
  certification, rules of conduct, insurance, termination, indemnification).
  **(OBSERVED by the operator in that repo; not citable or checkable from this
  one, so treat it as operator-reported.)**
- **⚠ It is a template, not a precedent.** It was drafted for a hypothetical
  fixed-premises makerspace, and the fees were never real numbers — they are
  placeholders that were never filled in. It assumes a building with a server
  room and dedicated storage. Nothing about it is evidence that tiers work, or
  that these tiers work, or that any of it transfers to a bus.
- **Against B1/B2/B3:** every objection to M3, and the same two amendments.
- **Against, structurally:** tiers require differentiable access, and **a bus
  has one door.** "24/7 access" and "dedicated storage" do not exist to sell.
  Artisan's Asylum's individual-membership model
  (`ux-research.md:264-266`) works because it is a building.
- **One thing worth keeping from it even under M1/M2:** the seven agreement
  terms are the checklist of what an access relationship has to address,
  fee or no fee. The **liability waiver** line is the sharpest — see **L-3**.

> **Naming caution (B7):** Station North, Berkeley Public Library, Artisan's
> Asylum, and Ithaca Generator are cited here as **researched precedents**
> from `/bibliography` and `docs/ux-research.md`. Artisan's Asylum and Ithaca
> Generator are **PENDING** in `docs/naming-consent.md`. Nothing decided here
> may describe any of them as a GFTB affiliate, partner, or supporter in
> public copy without a consent row.

---

## T — "Trust equity"

**OBSERVED: zero precedent.** The phrase "trust equity" does not appear
anywhere in this repository — grepped `docs/`, `src/`, `static/`, zero hits
(re-verified 2026-08-04). The only nearby use of the word "trust" anywhere in
the operator's wider material is **estate-planning** trust vocabulary in a
private, unrelated context — a different subject entirely, and **not** a
precedent for anything proposed here.

**This draft will not guess what it means.** The three readings below are
mutually incompatible and lead to three unrelated pieces of work. **The
operator must disambiguate before anything is designed.**

| Reading | What it would mean | What it would require | Risk |
|---|---|---|---|
| **T1 — equity held through a legal trust** | A trust holds the bus and tools; members hold beneficial interests | A trust instrument, a trustee, a corpus, a Maine trust lawyer | **HIGHEST — securities, fiduciary duty, tax** |
| **T2 — "equity" as fairness, extended on trust** | Standing earned by showing up and being vouched for, recorded informally, with no paperwork wall — *equity* as in equity-forward, *trust* as in we trust you | Nothing legal. A written norm and a vouching convention | **LOWEST — adoptable immediately** |
| **T3 — sweat/stake equity in a community asset** | Members accrue a recorded stake in the bus through labour and contribution; the stake carries governance weight and possibly a claim at dissolution | A legal form (co-op, community land trust, member-owned nonprofit), an asset-lock or dissolution clause, and a lawyer | **HIGH — co-op/CLT law, possible securities** |

> **⚠ STOP — securities question for a lawyer.** **T1 and T3 both put members
> in a position where their participation could carry an economic interest or
> a claim on assets. Whether that is a security is a question for a
> securities lawyer.** This draft states the question and stops. It does not
> assess it, does not estimate the answer, and **does not develop T1 or T3
> further** — no structure, no mechanics, no draft language. Recorded as
> **L-1** below.

**Only T2 is designable without counsel.** It is also the reading most
consistent with what the site already says: `/mission` presents
"Equity-forward" as a value (`src/routes/mission/+page.svelte:30-31`) and
pairs it with "no membership fee … nobody is turned away." **(INFERRED:** the
phrase may have been heard as T1/T3-shaped when a T2 sense was meant. Do not
act on this inference — ask.**)**

**The question to put to the operator, verbatim:**

> When you say "membership via trust equity," do you mean **(a)** people earn
> standing by showing up and being vouched for, with no paperwork — equity as
> fairness, trust as trust; **(b)** members actually own a piece of this
> through a legal trust; or **(c)** something in between, where contribution
> is recorded and carries a governance vote? These need completely different
> answers, and (b) and (c) both need a lawyer before another word is written.

---

## P — Payment plane

**⚠ Gate on all three:** B1 is binding and signed. **No payment surface may
be adopted without either (i) an entity existing, or (ii) a written, dated
Amendment 4 to `0001-gftb-mvp-decisions.md` row (h)**, in the same form as
Amendments 1–3 (superseded text retained verbatim, operator signature, date).

### P1 — Status quo: no payment surface

No on-site payment anything. Money conversations off-site, person-to-person,
ad hoc, exactly as row (h) says.

- **For:** zero legal exposure, zero infrastructure, zero amendment. Keeps
  the donate page's tool-only framing coherent. **Currently in force.**
- **Against:** zero funding. Any expense (parking, fuel, a tarp, a
  replacement blade) comes out of an individual's pocket with no way to
  reimburse cleanly, and no record of who is out how much.

### P2 — Fiscal sponsorship

A 501(c)(3) fiscal sponsor holds funds and takes an administrative
percentage. GFTB gains legitimate deductible-donation status **without
forming an entity**.

- **Already on the critical path:** `docs/launch/apex-flip-readiness.md:164`
  records 501(c)(3)/fiscal-sponsor status as an **open operator input
  blocking gate criterion A1**. This decision is being asked for whether or
  not payment is the reason.
- **For:** the fastest route from "no money can be accepted" to "money can be
  accepted lawfully and deductibly." A sponsor typically brings insurance
  conversations and a governance template with it.
- **Against:** needs a *willing* sponsor (an unincorporated bus project is not
  automatically attractive), a written agreement, an administrative cut
  (commonly a percentage of funds raised — **[UNVERIFIED — needs operator]**
  for any specific rate; no sponsor has been identified in the repo), and a
  lawyer's read of the agreement (**L-6**). Also: adopting it means the
  ratified "no 501(c)(3), no fiscal sponsor" copy (B4, D3 row 1) becomes
  false and must be amended, not silently edited.

### P3 — Form an entity

A Maine nonprofit corporation, a co-op, or an LLC. Payment, insurance,
contracts, and grants all become possible in one step.

- **For:** it is the only option that answers **L-2, L-3, L-4, and L-5 at
  once**, because all four are versions of "there is no legal person here."
  It is also the precondition T3 would need if that is what "trust equity"
  turns out to mean.
- **Against:** highest cost, longest lead time, ongoing filing and compliance
  burden, and a governance structure that has to be real (directors, minutes)
  rather than nominal.
## Lawyer / stakeholder register

Nothing in this row set is answered here. Each is routed.

| # | Open question | Who must answer it | Why them |
|---|---|---|---|
| **L-1** | Is any "trust equity" reading (T1 or T3) a **security**? | **Securities lawyer** | Members holding a beneficial interest, an accruing stake, or a claim on assets at dissolution is squarely securities territory. This draft states the question and refuses to opine or design further. |
| **L-2** | If GFTB takes money with **no entity**, whose income is it — and does **Maine charitable-solicitation registration** attach? | **Maine attorney + CPA** | With no legal person, funds land on a natural person. That is simultaneously a tax question (whose 1040) and a state-registration question (soliciting for a charitable purpose). Neither is answerable from this repo. |
| **L-3** | **Liability-waiver enforceability in Maine** for an **unincorporated association** putting **power tools** in members' hands — expressly including **whether individual organizers are personally exposed** | **Maine attorney** | This is the sharpest question in the document. An unincorporated association has no liability shield; the people who organize it may be personally on the hook, and the person whose **property the bus sits on (B8, J.)** may have exposure of a different kind. The M4 template's "liability waiver / indemnification" terms were drafted for an incorporated operator and carry no weight for an unincorporated project. **Do not draft or evaluate waiver language before this is answered.** **Starting material for the broker/lawyer conversation, already on the public site (OBSERVED, re-verified 2026-08-04):** `src/routes/bibliography/+page.svelte:218` — the D.C. Bar Pro Bono Center's *"Securing Waivers of Liability from Volunteers of Nonprofit Organizations"* (2017 update), described there as "free legal-grade guidance on drafting enforceable volunteer waivers, paired with insurance." **Read it as background for the attorney conversation, not as a substitute for it** — it is D.C., not Maine, and it addresses nonprofit *organizations*, which is precisely the thing GFTB is not. |
| **L-4** | Can **any insurance be bound with no entity**, and **who is the named insured**? | **Insurance broker** (licensed, Maine) | With no entity the named insured would have to be a natural person or a group of them — a very different product from commercial GL. Makerspace insurance budgets exist as a reference class, but they are built for an incorporated operator at a fixed premises, not an unincorporated project with a vehicle; **any such figures are third-party quote material, are non-transferable, and are deliberately not reproduced in this document.** Get a real quote rather than reasoning from that budget. Also ask the broker whether a **fiscal sponsor (P2)** can extend coverage — that answer may decide P2 vs P3. Note that `/bibliography` line 218 (D.C. Bar volunteer-waiver guidance, "paired with insurance") is a **waiver** resource and belongs to **L-3**, not here. |
| **L-5** | **Membership-roster personal data**: what is retained, for how long, deleted on what trigger — and **who is the controller** with no entity? | **Attorney** (+ operator for the policy itself) | M2/M3/M4 all create a roster. Access traffic already carries names, contact details, tool needs, and scheduling context, which is why the keyholders archive is private. Without an entity there is no organization to be the controller, so the duty attaches to individuals. **Must be answered before the first name is written down.** |
| **L-6** | Fiscal-sponsor **agreement terms**, if P2 | **Attorney** | Fee percentage, ownership of donor relationships, what happens to funds if the sponsorship ends, and whether the sponsor's insurance reaches GFTB volunteers. Not a template exercise. |
| **L-7** | Does anything decided here need **municipal** sign-off — parking, siting, or use of the property at B8? | **Municipal authority (City of Lewiston / Auburn, as applicable)** | Zoning and permitted-use questions are not answerable from this repo and this draft does not guess at them. Route alongside L-3, since the property host is an interested party. |
| **S-1** | Which taxonomy reconciliation — **R1 / R2 / R3**? | **Operator + Alex** | Pure product/voice call. No legal content. |
| **S-2** | Which membership model — **M1 / M2 / M3 / M4**? | **Operator + Alex** | M1/M2 are theirs alone; M3/M4 are theirs *plus* L-2 and an Amendment 4. |
| **S-3** | What does **"trust equity"** mean — **T1 / T2 / T3**? | **Operator — disambiguate before anything is designed** | Nobody else can answer it. T1/T3 immediately become L-1. |
| **S-4** | **Amend `0001` row (h), or hold TOOLS-ONLY?** | **Operator — written, dated Amendment 4 required** | This draft is explicitly **not authorized** to change row (h). It can only note that an amendment would be required. |
| **S-5** | Does **M2's roster** count as a "paperwork wall" under B3? | **Operator + Alex** | The live copy makes a promise; only the people who made it can say where its edge is. |
| **S-6** | **Populate the steward roster** (D3 row 6; blocks A1, and each name needs consent under A5) | **Operator** | Nothing in R or M has a human attached until this happens. |
| **S-7** | Reconcile the **"nobody turned away for inability to pay"** clause with "no membership fee" | **Operator** | Currently both are live on `/mission`. If M1 holds, the clause may be describing a fee that does not exist. |

---

## Decision slots (all empty — nothing is signed)

- [ ] **R** — R1 ☐  R2 ☐  R3 ☐  none-of-these ☐
- [ ] **M** — M1 ☐  M2 ☐  M3 ☐  M4 ☐  none-of-these ☐
- [ ] **T** — T1 ☐  T2 ☐  T3 ☐  "not what I meant, it means: ______" ☐
- [ ] **P** — P1 ☐  P2 ☐  P3 ☐
- [ ] **Row (h)** — hold TOOLS-ONLY ☐  /  write Amendment 4 ☐
- [ ] Referrals opened: L-1 ☐ L-2 ☐ L-3 ☐ L-4 ☐ L-5 ☐ L-6 ☐ L-7 ☐

Signing any box above does **not** happen in this file's Status line. When a
row is decided, a **new** ADR is written (or this one is promoted with a
minted D-number and a dated operator signature), and any superseded text is
retained verbatim per the house no-silent-rewrite rule.

---

## How to annotate this

Wednesday, 2026-08-05, operator + Alex.

1. **Mark the "never" first.** Go through R, M, T, and P and strike out
   anything that is simply off the table. Eliminating is faster than choosing
   and it is the highest-value thing this session can produce.
2. **Answer T before M.** If "trust equity" means T1 or T3, most of M is moot
   until a lawyer has been. If it means T2, M1 and M2 are both live and the
   session can move.
3. **Write in the margin, do not rewrite the body.** Corrections go beside
   the text they correct, initialled and dated. This file follows the house
   no-silent-rewrite rule: superseded text stays.
4. **Flag anything asserted here that is wrong.** Every factual claim is
   marked OBSERVED (read from a file, path cited) or INFERRED (reasoned).
   **Correct the OBSERVED ones — they are checkable. Argue with the INFERRED
   ones — they are opinions.** Anything marked `[UNVERIFIED — needs
   operator]` needs a fact only the operator has.
5. **For each L-row, mark one of: OPEN IT NOW / LATER / NOT NEEDED BECAUSE
   ___.** "Later" is a legitimate answer; "unanswered" is not. L-3
   (organizer personal exposure) and L-4 (insurance with no entity) are the
   two that should get an explicit call this week.
6. **Two names to keep straight while marking up (B7/B8):** the alderman
   hosting the bus is **J.** — initial only, never the full first name. The
   founding supporter is **Ripley**. Both are consent-bound rulings, and this
   document is written to be quotable.
7. **Do not populate the steward roster in this file.** It goes on
   `/stewards` (B6) and only after each named person consents (A5).
8. **Leave the Status line alone.** This document stays
   **DRAFT — FOR ANNOTATION, NOT DECIDED** until a decision is written up
   separately with a signature and a date.
