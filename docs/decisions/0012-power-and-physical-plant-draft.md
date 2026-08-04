# 0012 — Power and physical plant (DRAFT for annotation)

- Status: **DRAFT — FOR ANNOTATION, NOT DECIDED.** No option below is chosen,
  no dollars are committed, no sign-off block is checked. This document exists
  to be marked up in one sitting and handed back.
- Date: 2026-08-04 (second Wednesday annotation document)
- Decision ID: **none assigned.** An ID is minted at sign-off, not at draft.
- Linear anchor: **TIN-3441**
- Amends: **nothing.** This draft has no authority to amend any prior packet.
  Where it touches a live decision it says so and stops.
- Related: `0001-gftb-mvp-decisions.md` row (h) (tools-only donation framing —
  binding, see "What is already decided" below); `0004-gate-opening-criteria.md`
  (A1 is operator-blocked partly on 501(c)(3)/fiscal-sponsor status);
  `docs/launch/apex-flip-readiness.md`; `docs/naming-consent.md`;
  `docs/ux-research.md`; **`0011-membership-and-money-draft.md`** — the
  companion draft, same directory, written the same day. **It is not an
  insurance ADR:** it is the membership-and-money packet, and the insurance
  question lives inside it as row **L-4** of its lawyer/stakeholder register
  (waiver enforceability is the separate row **L-3**). Insurance
  cross-references below point at **`0011-membership-and-money-draft.md`,
  L-4**. (OBSERVED, re-verified 2026-08-04. An earlier draft of this header
  asserted that no 0011 file existed "at commit 7d1e23e" — that was wrong twice
  over: 0011 sits in `docs/decisions/` as an untracked working-tree sibling,
  and the same commit-tree test would equally have "proved" that *this* file
  does not exist.)
- Grounding outside this repo: `~/git/LA-Mesh/hardware/deployment/`
  (`solar-calculations.md`, `site-survey-checklist.md`,
  `weatherproofing-guide.md`) — same geography (Lewiston-Auburn, 44.1°N,
  70.2°W), same operator, so the environmental figures transfer. Also a
  makerspace facility-safety checklist held in the operator's internal
  operations repo (private; not citable from this repo), lifted as a generic
  checklist in P4.

---

## Problem

GFTB has a bus and no plant. There is no written answer to *where the bus
goes*, *what it plugs into*, or *who is liable when someone is hurt inside it*.
Every capability idea downstream of those three questions — lighting, heat, a
charging bench, a radio node, a server — is currently being reasoned about
before the questions that gate it have been asked.

This draft does two things and nothing else:

1. Orders the questions so that each one is a genuine precondition for the
   next, with an owner and a cost.
2. Puts real numbers next to the "stretch" ideas so the operator can see what
   they actually cost against a plant that does not exist yet.

Nothing here is decided. Where a question needs a licensed professional or a
municipal authority, it is marked and named, not answered.

---

## What is already decided, and is not up for grabs in this draft

These are live constraints. An annotation that contradicts one of them is a
request to amend that packet, not an annotation of this one.

- **Donation framing is TOOLS-ONLY** (OBSERVED: `0001` row (h), DECIDED
  2026-07-02 with operator sign-off — "the site accepts tool donations only
  until an entity exists; money conversations happen off-site person-to-person.
  Zero tax-deductibility claims and lab-as-aspiration framing remain binding").
  Nothing in this draft may be read as opening a cash ask, a build fund, or a
  materials drive. **Changing that would require a written, dated Amendment 4
  in the established form** — superseded text retained, operator signature —
  and this document is **not** authorized to write it.
- **No membership fee, no paperwork wall.** The site says, in its own words,
  "Anyone can ask to borrow: no membership fee, no paperwork wall." (OBSERVED,
  re-verified 2026-08-04: `src/routes/+page.svelte:236`; echoed at
  `src/routes/tools/+page.svelte:50`, `src/routes/mission/+page.svelte:48`, and
  `src/routes/contact/+page.svelte:194-195` — the sentence wraps there, the
  phrase itself lands on 195; analyzed throughout `docs/ux-research.md`).
  **Any tiered, paid, or
  dues-based model for shop access contradicts a live decision.** Saying it
  plainly: if an annotation proposes "members pay $X toward power," that is a
  reversal of site-published policy and belongs in its own packet, not here.
- **"Keyholder" vs the `/stewards` role ladder is an unreconciled taxonomy**
  (OBSERVED: `docs/ux-research.md` §2 "Become a keyholder" and the open
  checklist item "Reconcile 'keyholder' and the `/stewards` role ladder").
  This matters below because P3 and P4 assign owners, and the vocabulary for
  "who owns the electrical shutoff" is not settled. Owners below are written
  as **operator** or **named human**, deliberately, rather than as a role.
- **The bus sits on J.'s property today** (OBSERVED:
  `src/routes/shout-outs/+page.svelte:15-17` — "J.", "Alderman, Lewiston",
  "Hosts the bus on his property: the home base a keyholder shares with you on
  request."; corroborated by `docs/naming-consent.md`, J. row, CONSENTED
  2026-07-04, **initial-only**). Per `docs/naming-consent.md` this person is
  consented to the initial-only credit; write **J.**
- **There is no entity, no fiscal sponsor, and no insurance.** 501(c)(3)/
  fiscal-sponsor status is recorded as an open operator input blocking
  gate-opening criterion **A1** (OBSERVED:
  `docs/launch/apex-flip-readiness.md:164` — TIN-2419 "explicitly blocked on
  operator-only inputs: source photography, logo direction …, stewards roster,
  and 501(c)(3)/fiscal-sponsor status"). A case-insensitive grep of `src/` for
  "insurance" returns **four** hits, all in
  `src/routes/bibliography/+page.svelte` — lines **107**, **111**, **114**,
  **218** (OBSERVED, re-verified 2026-08-04; note a case-*sensitive* grep
  misses 111, which is title-case "Insurance", and returns three). Three of the
  four are lending-library operations reading. **The fourth, line 218, is the
  one that matters, and it is not a P5 item:** the D.C. Bar Pro Bono Center's
  "Securing Waivers of Liability from Volunteers of Nonprofit Organizations" —
  "free legal-grade guidance on drafting enforceable volunteer waivers, paired
  with insurance." That is **waiver enforceability**, which is
  `0011-membership-and-money-draft.md` row **L-3**, not this document's P5.
  Route it there. GFTB itself carries no insurance.

---

## The operator's own prior ruling this draft must not quietly reverse

`~/git/LA-Mesh/hardware/deployment/solar-calculations.md:64`, verbatim:

> **Note**: The Pi gateway should be powered from mains with UPS backup, not
> solar. Solar is only practical for Station G2 and small relay nodes.

That is an OBSERVED prior ruling by the same operator, for the same geography,
about the same class of hardware. **A "solar-powered server on the bus"
contradicts it.** This draft does not overturn it and does not pretend it is
compatible. The arithmetic that produced the ruling is reproduced in the
stretch section below (S2) so the annotation can be made against numbers rather
than against a memory of a note.

If the annotation pass wants a solar server anyway, the honest form of that is:
"I am overriding the mains-with-UPS ruling, here is why" — written down, dated,
in the same file that carries the ruling. Not a silent re-derivation here.

---

## Priorities

Ordered. Each is a genuine precondition for the next: P2 is meaningless without
P1's answer, P3 has no address without P2's survey, P4 has nothing to bond
without P3's circuit, and P5 prices a risk that P1–P4 define. Owners and costs
are stated. Where a number is unknown it is marked, not guessed.

---

### P1 — Where is the bus going, and who said yes

**Owner:** operator (this cannot be delegated — it is a relationship, not a
task). **Cost: $0.** No dollars appear at this step by design.

**What "done" looks like:** one written page naming (a) the destination
address or parcel, (b) the property owner, (c) a **term** (how long), and (d) a
**termination notice period** (how much warning either side gives). Signed or
at minimum acknowledged in writing by both parties.

**Why this is first and not third:** today the bus is on J.'s property
(OBSERVED, cited above) under an arrangement that has no written term and no
written notice period in this repo. Every dollar spent on P3–P5 is spent on a
site the project can be asked to leave with zero notice. Cheap steps stay cheap
if they are portable; a circuit is not portable.

There is already an open ask on the public site for exactly this work:
`/wants` carries a `helpWanted` entry, slug **`bus-setup`**, eyebrow "The bus",
titled **"Help getting the bus situated"** — "We won the bus. Now it needs
hands to move it, park it, and outfit the inside. Handy with any of that? A
keyholder wants to hear from you." (OBSERVED:
`src/routes/wants/+page.svelte:16-22`). That ask is live and unowned. P1 is the
decision that turns it from a wish into a destination.

**Framed options:**

| # | Option | One line of context |
| --- | --- | --- |
| A | **Formalize where it already is** — a written agreement with J. for the current spot | Cheapest and least disruptive; converts a favor into a term and a notice period, which is the whole point. Costs a conversation, not money. |
| B | **Move to a different private host** | Buys a better site (level ground, existing outdoor outlet, less winter drift) at the cost of the move itself and a new relationship to build from zero. |
| C | **Pursue a municipal or institutional host** | Highest legitimacy and the most durable term; also the slowest, and it will surface the "who is legally accountable" question that P5 and the entity decision have not answered yet. |
| D | **Explicitly defer** — leave it informal, revisit at a stated date | Honest about capacity; the cost is that P2–P5 stay blocked and the `bus-setup` want stays open indefinitely. If chosen, write the revisit date down. |

**Professional boundary:** anything that reads like a **lease, license, or
easement** — rent, exclusive possession, a multi-year term, improvements to the
land — is a **lawyer** question (Maine real-property/land-use). A plain written
statement between neighbors with a term and a notice period is not, but the
line between the two is exactly the kind of thing a lawyer should draw. Not
answered here.

---

### P2 — Run the existing site survey as-is

**Owner:** operator plus one other person (two people, one afternoon).
**Cost: $0.** **This is the highest-value cheap action in the document.**

`~/git/LA-Mesh/hardware/deployment/site-survey-checklist.md` already exists,
was written for this geography, and is a fill-in-the-blanks form. Run it
against the bus's site **without modifying it first**. The point of running it
as-is is that the blanks it fails to fit are themselves findings.

What it already asks that GFTB has not written down anywhere (all OBSERVED from
that file):

- **Access** — "Permission obtained (written/verbal): from ________________",
  key/code required, hours of access, emergency contact for site. Note that the
  very first Access row is P1's question in checklist form.
- **Power** — "**Mains power available**: distance to outlet: _____ m",
  "Outdoor-rated outlet: Y/N", "**GFCI protected: Y/N**", "Extension cord
  needed: Y/N (length: _____m)". Three of the four rows that P3 turns into a
  decision are already blanks on this form.
- **Solar viability** — "panel mounting area available (min 30cm × 40cm)", sun
  exposure full/partial/shaded, "Panel orientation: _____ degrees (south-facing
  ideal)", "**Panel angle: _____ degrees (45-60° for Maine)**".
- **Environmental** — wind exposure sheltered/moderate/exposed, "Snow load
  concern: Y/N", "Ice buildup risk: Y/N", "**Vandalism risk: low / medium /
  high**", "Animal concern (squirrels chewing cables, birds perching): Y/N".
- **Photos** — five specified shots: mounting location wide angle, view N/E/S/W
  from it, power source, access path, cable routing path.
- **Recommendation** — APPROVED / CONDITIONAL / REJECTED, plus recommended
  power source and estimated installation time.

**Known misfits to annotate rather than silently fix** (INFERRED — my reading
of the form against a bus):

- The Mounting Location section offers "Rooftop / Tower / Wall / Pole (circle
  one)" (OBSERVED). **A bus roof is none of these.** It is a moving,
  vibration-loaded, curved, thin-gauge surface. Circle nothing and write "bus
  roof"; the mismatch is the finding.
- The RF section asks "Airport proximity: _____ km from Auburn-Lewiston (LEW)"
  and "FAA Form 7460-1 needed (structure >60ft or within airport zone): Y/N"
  (OBSERVED). For a mast on a bus this is almost certainly N/A — but the row
  should be filled in as N/A with the distance noted, not skipped, because
  "skipped" and "N/A" look identical six months later.
- The form assumes a fixed site. The whole P1 question — is this site
  permanent — is the form's unstated premise.

**Framed options:**

| # | Option | One line of context |
| --- | --- | --- |
| A | **Run it as-is this month, unmodified** | Zero cost, produces the photo set and the power distances that every later step needs; the misfits become annotations. |
| B | **Fork a bus-specific variant first, then run it** | Cleaner artifact at the end; costs an evening of editing before any data is collected, and risks editing out a row that mattered. |
| C | **Run only the Power + Environmental sections now** | Fastest path to unblocking P3; loses the photo set and the RF/access rows, which are the parts nobody will go back for. |

---

### P3 — Shore power before anything else

**Owner:** operator to decide; **execution owner is a licensed electrician.**
**Cost: not estimated here** — see the boundary note; any figure this document
produced would be invented.

**The proposal to annotate:** exactly **one outdoor-rated GFCI-protected 120V
circuit** reaching the bus. Not a subpanel, not a generator, not solar. One
circuit.

**Why shore power first, before any solar or battery capability:** the
operator's own sizing document already draws this line for the heavier load
class — mains with UPS backup, not solar, for anything Pi-sized and up
(OBSERVED, quoted in full above). A bus with lights, a charging bench, and a
heater is not a lighter load than a Raspberry Pi. Solar sized for that load is
priced in S2 below and it is not close.

**Questions that are MUST-ASK and are NOT answered here** — each is named with
who owns it:

- **Licensed electrician (Maine-licensed):**
  - Whether the run is feasible at the surveyed distance (P2 fills in "distance
    to outlet: _____ m").
  - **Bonding and grounding of a metal vehicle body** fed from a building
    circuit. This is the single highest-consequence unknown in the document. It
    is not a thing to reason about from first principles in a markdown file,
    and this draft states no opinion on it.
  - Whether a temporary/extension-cord arrangement is acceptable at all, or
    whether the only correct answer is a permanent installed circuit.
  - GFCI device type and placement.
- **City of Lewiston (code enforcement / electrical inspector / permitting
  desk — the municipal authority, contacted directly):**
  - Whether an electrical permit is required for the run, and by whom it must
    be pulled.
  - **Zoning**: whether a parked bus used as a shared workshop is a permitted
    use at the P1 site at all. This question is upstream of the wiring and may
    invalidate it.
  - Whether the bus is treated as a vehicle, a structure, or an accessory
    structure for these purposes.

This draft **does not** opine on code sections, permit thresholds, zoning
classifications, or enforceability. Those belong to the electrician and the
City. Write down their answers; do not write down a guess and then cite it
later.

**Framed options:**

| # | Option | One line of context |
| --- | --- | --- |
| A | **One permanent outdoor-rated GFCI 120V circuit** | The proposal above; real, inspectable, and the precondition for everything in P4 — but it is an improvement to someone else's property, which loops back to P1's term. |
| B | **Cord-and-plug from an existing outdoor outlet, no new work** | Costs almost nothing and is reversible on the day the bus moves; whether it is acceptable, and under what conditions, is an electrician question, not a preference. |
| C | **No electrical service — battery/tool-pack only, indefinitely** | Fully portable, no permits, no bonding question; caps the plant at hand tools and whatever charges elsewhere, which may be the honest scope for year one. |
| D | **Defer pending P1** | If the site is not settled, buying a circuit is buying an improvement for a landlord; explicitly parking P3 until P1 lands is a legitimate answer. |

---

### P4 — Safety before capability

**Owner:** named human, recorded (see the taxonomy caveat above — do **not**
write "the safety steward" until `/stewards` and "keyholder" are reconciled).
**Cost: low, and it is the one place in this document where spending is
uncontroversial.** No dollar figures are asserted here; none were verified.

The minimum set, in the order it becomes possible:

1. **Bonding and GFCI** — falls out of P3, per the electrician. Not restated.
2. **Fire extinguisher, accessible and mounted.**
3. **Smoke and CO detectors.** CO specifically: an enclosed metal vehicle with
   any combustion appliance or a generator anywhere near it.
4. **A written lockout rule** — a plain sentence naming who de-energizes the
   bus, how, and when, and where the shutoff is.

**Lifted from a makerspace "Safety Requirements" checklist in the operator's
internal operations repo** (OBSERVED there; that source is private and is not
citable from this repo). It was drafted for a Maine LLC makerspace and is
reproduced here **only** as a generic checklist to adapt — **not** as a claim
that GFTB is that entity, is affiliated with it, or has those facilities:

From its **Equipment Safety** list — safety training required before use;
equipment certification system; **lockout/tagout procedures**; PPE requirements
posted; emergency stop locations marked; **first aid kit accessible**;
**fire extinguisher accessible**.

From its **Facility Safety** list — emergency exits marked; fire suppression
system; **smoke/CO detectors**; eye wash station; **emergency contact posted**;
**incident reporting procedure**; regular safety inspections.

From its **Documentation** list — equipment manuals accessible; safety data
sheets (SDS) for chemicals; training records maintained; **incident reports
filed**; equipment maintenance logs.

**What transfers and what does not** (INFERRED): the bolded items above are
bus-scale and cheap. "Fire suppression system", "eye wash station", and the
certification-system machinery are leased-building-scale and assume an entity
with a facility; they do not transfer to an unincorporated bus and should not
be copied over as if they did. Note also that the source document's whole
membership framing — tiers, dues, waivers as a condition of access — is exactly
the tiered/paid model that GFTB's published "no membership fee, no paperwork
wall" rules out. Lift the safety checklist. Do not lift the membership model.

**Framed options:**

| # | Option | One line of context |
| --- | --- | --- |
| A | **All four minimums before any new capability is added** | Cleanest rule, easy to hold; delays anything fun by however long the extinguisher and detectors take to buy and mount. |
| B | **Extinguisher + detectors now; bonding and lockout land with P3** | Sequences safety to what is actually possible pre-circuit, at the cost of a period where the bus is occupied but not de-energizable by rule. |
| C | **Write the lockout rule first, hardware after** | Free, immediate, and forces the "who owns the shutoff" naming question that the keyholder/steward taxonomy gap has been deferring. |

---

### P5 — Insurance: opened, not answered

**Owner:** operator, working with a **licensed insurance broker.**
**Cost: unknown — deliberately not estimated in this document.**

**Cross-reference: see `0011-membership-and-money-draft.md`, row L-4** —
*"Can any insurance be bound with no entity, and who is the named insured?"*,
routed to a licensed Maine insurance broker. That draft exists, in this same
directory, written the same day (OBSERVED, re-verified 2026-08-04). **L-4 is
the canonical home of the insurance question; do not resolve it in two
places.** Waiver enforceability is a *different* question and lives at **L-3**
of the same register — the `/bibliography` volunteer-waiver resource noted
above belongs there, not here.

What is established and must frame the conversation:

- GFTB is **unincorporated**. There is no entity to be the named insured.
- There is **no fiscal sponsor**, and fiscal-sponsor status is itself an open
  operator input blocking A1 (OBSERVED: `docs/launch/apex-flip-readiness.md:164`).
- The bus sits on **someone else's property** (J.'s), which means somebody
  else's homeowner's policy is currently the de facto and probably unwitting
  backstop. That is a fact to put in front of a broker, and — separately — in
  front of J.

A comparable makerspace insurance budget already exists in the operator's
internal planning material — it has line items for general liability,
equipment breakdown, and cyber, with an annual total (OBSERVED there). **Its
figures are deliberately not reproduced in this document.** They were built
for a Maine LLC operating a leased makerspace with a server room, they are
third-party quote material rather than anything GFTB was quoted, and
publishing them here would invite them to be mistaken for GFTB's numbers.

The only thing that transfers is the **shape** of the question: a real budget
for a roughly comparable operation has line items of that kind, so the
conversation is a normal one to have and a broker will recognise it. **Ask the
broker for a real quote against GFTB's actual shape** — unincorporated, no
named insured, a vehicle rather than a premises. A licensed insurance broker
owns the real answer; this document does not opine on coverage, exclusions,
pricing, or whether any policy would respond. See
`0011-membership-and-money-draft.md`, **L-4**.

**Framed options:**

| # | Option | One line of context |
| --- | --- | --- |
| A | **Ask a broker now, before an entity exists** | A broker will say what is and is not insurable in the current shape, which may itself be the argument for or against forming; costs one phone call. |
| B | **Sequence it behind the entity/fiscal-sponsor decision** | Avoids paying for a conversation that changes the day the legal shape changes; leaves the exposure open for however long that takes. |
| C | **Tell J. plainly what is on the property and let him check his own policy** | Costs nothing, is the decent thing regardless of which option wins, and may surface a hard constraint on P1 immediately. |

---

## Stretch — explicitly not funded before P1–P5

Nothing in this section gets money, attention, or a purchase order until P1
through P5 have answers. It is here because the arithmetic is already done and
the operator should be able to see it while annotating, not because it is next.

### S1 — Solar-charged LoRa node (lead item: genuinely cheap, arithmetic already done)

This leads the stretch list because it is the one capability whose numbers are
already computed, in this geography, by this operator — and because GFTB
**already has the radio**. The network cell lists **"G2 base-station LoRa
radio"**, `status: 'in-kit'`, blurb "In kit. A long-range, low-power radio base
station for off-grid sensor and mesh experiments." (OBSERVED:
`src/content/tools/network/g2-lora-base-station.svx`). The owning cell is the
"Network and tracing cell" (OBSERVED: `src/lib/data/cells.ts:64-69`). So this
is a power question, not a hardware-acquisition question.

**The computation, verbatim from `solar-calculations.md`** (all OBSERVED):

Load — Station G2 in router mode:

| Parameter | Value |
| --- | --- |
| Active TX (30 dBm) | ~600 mA @ 5V = 3.0W |
| Active RX | ~80 mA @ 5V = 0.4W |
| Average (10% TX duty) | ~130 mA @ 5V = 0.65W |
| **Daily consumption** | 0.65W × 24h = **15.6 Wh/day** |

Design parameters — autonomy 3 days; system voltage 5V (USB); **panel
efficiency loss 20%** (angle, dirt, temperature); **battery charge/discharge
efficiency 85%**; **design PSH 2.5 (worst-case winter)**.

Panel:

```
Required panel output = 15.6 Wh / (2.5h × 0.80) = 7.8W
Recommendation: 10W panel (provides margin)
```

Battery:

```
Required capacity = 15.6 Wh × 3 / 0.85 = 55 Wh
At 5V:   55 Wh / 5V   = 11,000 mAh
At 3.7V: 55 Wh / 3.7V = 14,865 mAh
Recommendation: 20,000 mAh USB power bank (~74 Wh usable) = ~4.7 days autonomy
```

Kit and cost, as published:

| Component | Specification | Est. Cost |
| --- | --- | --- |
| Solar panel | 10W, 5V USB output | $20–25 |
| Charge controller | MPPT, USB-C in/out | $15 |
| Battery | 20,000 mAh USB power bank | $25–30 |
| Cables | USB-C, outdoor-rated | $5–10 |
| **Total** | | **$65–80** |

Add the enclosure from `weatherproofing-guide.md` — IP65 minimum, listed
options $8–15 (OBSERVED) — and the all-in is **$73–95** (INFERRED: sum of two
OBSERVED ranges).

The December check, also from the source (OBSERVED): "Battery must bridge 15.5
hours of darkness in December … With 20,000 mAh battery: 15.5h × 130mA = 2,015
mAh used overnight (well within capacity)."

**Why it still does not jump the queue:** it mounts to something, in weather,
at a site that P1 has not chosen. Mounting it before P1 means mounting it
twice.

### S2 — "A solar server on the bus": the tension, shown in numbers

The operator's ruling (mains with UPS, not solar, for the gateway class) is
quoted in full above. Here is the arithmetic behind it, so the annotation can
argue with figures rather than with a note.

Load — Raspberry Pi 4 + MeshAdv-Mini gateway (OBSERVED): Pi 4 idle ~3.0W; Pi 4
active ~5.0W; MeshAdv-Mini ~0.5W; **average ~4.0W; daily consumption 4.0W × 24h
= 96 Wh/day.**

Applying the **same formulas and the same derates** the source file uses for the
G2 (INFERRED — my arithmetic, the inputs are OBSERVED):

```
Panel   = 96 Wh / (2.5h × 0.80)  = 48 W        (vs 7.8 W for the G2)
Battery = 96 Wh × 3 / 0.85       = ~339 Wh     (vs 55 Wh for the G2)
        = ~67,800 mAh at 5V  /  ~91,600 mAh at 3.7V
```

That is **roughly 6× the panel and 6× the battery** of the S1 kit, for one
Raspberry Pi — and a "server" worth the name is a heavier load than a Pi 4, not
a lighter one. This is before the winter-temperature derate below, which the
source file does **not** apply to its own sizing math and which this document
therefore will not apply either — but the direction is unambiguous.

**Temperature effect on battery capacity** (OBSERVED, `solar-calculations.md`):

| Temperature | LiPo capacity | Effect |
| --- | --- | --- |
| 25°C (77°F) | 100% | Optimal |
| 0°C (32°F) | ~80% | Mild winter |
| **-10°C (14°F)** | **~60%** | **Typical Maine winter** |
| -20°C (-4°F) | ~40% | Extreme cold snap |
| -30°C (-22°F) | ~20% | Rare but possible |

Published mitigations (OBSERVED): insulated enclosure with thermal mass; keep
the battery inside the weatherproof box, not exposed to wind; consider a
battery heater pad for extreme cold; **LiFePO4 tolerates cold better than LiPo
but is heavier.**

**What to annotate here:** whether the solar-server idea is (a) dropped, (b)
kept but explicitly re-scoped to a mains-fed machine on a UPS per the existing
ruling, or (c) pursued as a deliberate, written override of that ruling. Option
(c) is legitimate — it just has to be written in the file that carries the
ruling, dated, not re-derived quietly here.

### S3 — Environmental envelope any outdoor electronics must meet

Not a project. A constraint sheet, so that S1 or anything like it is not
specced twice. All OBSERVED from `weatherproofing-guide.md` unless marked.

- **Climate**: Southern Maine, USDA Zone 5b; temperature range **-29°C to 38°C
  (-20°F to 100°F)**; "Rain, snow, ice, fog — significant year-round."
- **Enclosure**: **IP65 minimum** (dust-tight + water-jet protection);
  UV-stabilized ABS or polycarbonate; rated **-40°C to +85°C operating**;
  150×100×70mm minimum; **light gray or white** to reflect heat. Listed options
  run $8–15 (Bud PN-1332 IP65 $10; Polycase WC-22 IP65 $12; Hammond 1554J IP66
  $15).
- **The bottom-entry cable rule**, verbatim: "**Critical rule**: All cables must
  enter from the **bottom** of the enclosure. … This prevents water from running
  down cables into the enclosure." Plus **drip loops** — "Form a U-shape in
  cables before they enter glands. Water follows gravity and drips off the loop
  bottom instead of entering the enclosure."
- **Cable glands**: every penetration sealed; M16 or PG9 for USB-C; SMA bulkhead
  feedthrough for antenna; marine-grade or outdoor-rated clear silicone, **24h
  cure time before deployment.**
- **Condensation**: 2–3 silica gel packets inside, replaced every 6 months;
  conformal coating on boards (MG Chemicals 419D or similar) — "**Do NOT coat
  antenna connector or USB port**"; IP68 Gore-Tex breather vent where
  temperature cycling is severe.
- **Panel angle**: **45–60°** — "steeper = snow slides off"; south-facing ideal
  (the latter from `site-survey-checklist.md`). Snow albedo "can actually
  increase output on clear days."
- **Peak sun hours by month**, the table this whole section is sized against:

| Month | PSH/day | | Month | PSH/day |
| --- | --- | --- | --- | --- |
| January | 2.5 | | July | 5.5 |
| February | 3.3 | | August | 5.0 |
| March | 4.1 | | September | 4.2 |
| April | 4.8 | | October | 3.2 |
| May | 5.3 | | November | 2.4 |
| June | 5.6 | | December | 2.1 |
| **Annual Avg** | **3.9** | | **Winter Avg** | **2.5 — design for this** |

  Source given as NREL NSRDB data for central Maine. Note the **2.7× swing**
  between the June peak (5.6) and the December minimum (2.1) — INFERRED from
  the OBSERVED table; this is why the design figure is the winter average and
  not the annual one.

- **Seasonal maintenance** already specified: Spring (April) inspect for winter
  damage, replace desiccant, check glands, clean panels; Summer (July) verify
  internal temperature stays below 50°C; Fall (October) tighten fasteners,
  verify battery health; Winter (January) remote monitoring, clear snow from
  the panel if accessible. **Whoever owns S1 owns this calendar** — that is a
  named-human commitment, not a purchase.

**A caveat on transfer** (INFERRED): the *environmental* figures above — PSH,
temperature, snow, enclosure ratings — transfer to GFTB directly, because they
are properties of Lewiston-Auburn. The *device* figures (15.6 Wh/day, 96
Wh/day) transfer only for those exact devices. Any other load must be measured,
not assumed.

---

## How to annotate this

This document expects to come back marked up. Suggested method:

1. **Read the two constraint sections first** — "What is already decided" and
   "The operator's own prior ruling." If an annotation you want to write
   contradicts something there, write it as *"amend X"* rather than as a note
   here. Two things specifically: any cash ask needs **Amendment 4** to `0001`
   row (h); any solar-server override belongs in `solar-calculations.md`, dated.
2. **Go priority by priority. For each, circle one option letter** — or write a
   new one. An option that is not listed is a fine answer; a priority with no
   circle is the signal that it needs a conversation, not a decision.
3. **For P1, write the four fields even if provisionally**: destination, owner,
   term, notice period. A pencil answer beats a blank.
4. **Mark anything that is wrong.** Every factual claim above carries an
   OBSERVED file citation or an INFERRED tag. If a citation is stale or a
   figure has changed, strike it and say so — do not work around it.
5. **Add names to owners.** Owners above are "operator" or "named human"
   because the keyholder/steward vocabulary is unreconciled. Where you know the
   person, write the person.
6. **Flag anything you want a professional to answer** that this draft did not
   already route. Currently routed out: **licensed electrician** (feasibility,
   bonding/grounding a metal vehicle body, GFCI, temporary-vs-permanent);
   **City of Lewiston** code enforcement and zoning (permit, permitted use,
   vehicle-vs-structure); **lawyer** (anything lease-shaped in P1);
   **licensed insurance broker** (all of P5).
7. **Do not resolve the naming-consent PENDING rows here.** Five org/reference
   rows in `docs/naming-consent.md` are PENDING and block gate-opening
   criterion A5. If a partner, host, or supplier organization comes up while
   annotating P1 or P3, add it to that tracker as a new PENDING row — do not
   name it as a GFTB affiliate or supporter anywhere until its row is
   agreed-and-dated.
8. **When the marked-up copy comes back**, the next version splits: whatever
   got circled becomes a real ADR with a Decision ID and a sign-off block;
   whatever did not stays here as a draft. This file is not upgraded in place.

**Sign-off: none.** There is deliberately no signature block in this document.
A draft that can be signed is a decision wearing a draft's label.
