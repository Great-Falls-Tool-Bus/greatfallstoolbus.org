# 0006 — Interim logo: Wikimedia Commons mark (INTERIM, pending TIN-2419)

- **Lane:** G3 (Wikimedia interim logo)
- **Linear anchor:** TIN-2419 (designer-delivered logo work, not yet landed)
- **Status:** **CANDIDATES STAGED, awaiting operator pick** — not decided.

## Context

The site currently uses the generic SaturnMark scaffold placeholder as its
brand glyph. This lane sources a freely-licensed, attribution-clean SVG from
Wikimedia Commons to stand in as an **interim** logo — closer to the GFTB
brand (bus / tools / Great Falls of the Androscoggin) than the placeholder —
until the recruited designers deliver a bespoke mark under TIN-2419.

Three candidates are staged in `static/logo/` with full license detail in
`docs/attribution.md`:

1. `bus-silhouette.svg` — CC0, generic bus silhouette
2. `sinnbild-lastwagenbus.svg` — CC0, truck-as-bus utility pictogram
3. `waterfall-delapouite.svg` — CC BY 3.0 (attribution required to Delapouite
   / game-icons.net), waterfall glyph tying to "Great Falls"

## Scope of this change

This PR touches **only**:

- `static/logo/` — the three candidate SVGs
- `docs/attribution.md` — per-file source/author/license record
- this decisions note

It does **not** wire any candidate into `+layout.svelte` or any other UI
surface. The UI wave owns `+layout.svelte`; once the operator picks a winner
from this PR, the UI wave should reference the chosen file from
`static/logo/` in the header/nav brand slot.

## Handoff

- Operator: pick one of the three candidates (or reject all and request a
  fresh Commons search).
- Once picked: UI wave wires the chosen SVG into `+layout.svelte`'s brand
  slot; the other two candidates can stay in `static/logo/` as alternates or
  be removed in a follow-up cleanup PR.
- This is explicitly **interim** — supersede with the TIN-2419 designer mark
  when it lands; this decision note should be marked superseded at that
  point.
