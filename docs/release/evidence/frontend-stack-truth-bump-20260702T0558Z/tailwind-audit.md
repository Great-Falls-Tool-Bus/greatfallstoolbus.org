# Tailwind v4 bare-utility + @source audit — site.scaffold (2026-07-02, TIN-2348)

A green typecheck proves nothing visual under Tailwind v4 (unknown utilities drop silently).
This audit checked the four house failure classes. All claims below are OBSERVED from command
output and built-CSS inspection on this branch.

## [1] Bare (deprecated/renamed) utilities — 5 hits, FIXED

`grep -rnoE 'class="[^"]*"' src | grep -E '\b(rounded|shadow|blur|ring)(["\ ])'` found 5 bare
`rounded` usages (BindableDrawer.svelte:46, ThemeSwitcher.svelte:35, +layout.svelte:78/112/120).

Empirical truth (build inspection, tailwind 4.3.2): bare `.rounded` currently STILL emits
`border-radius:.25rem` on this stack — i.e. NOT broken today, unlike the MassageIthaca scar
(where bare `rounded` rendered 0 radius). It is however the deprecated bare form; all 5 sites
were converted to explicit `rounded-sm`, which emits `border-radius:var(--radius-sm)` with
`--radius-sm:.25rem` — byte-equivalent radius. Post-fix build: `.rounded{` occurrences = 0.

## [2] `m-y-*` / `p-x-*` typo pattern — CLEAN

`grep -rnE '\b[mp]-[xy]-[0-9]' src` → no hits.

## [3] Dynamic class strings (JIT purge risk) — 1 reviewed, OK

`SaturnMark.svelte:9` uses a template literal, but the utilities inside it are static
(`inline-block align-[-0.125em]`); `extraClass` is caller-supplied and callers pass static
strings visible to the scanner in their own files. No unscanned dynamic construction found.

## [4] `@source` directives — DEFECT FOUND, FIXED

`src/app.css` carried NO `@source` directive while the scaffold renders Skeleton components
(AppBar, Dialog, Navigation, Popover, Portal). Skeleton 4.15.2's dist markup ships its own
Tailwind utilities (`size-4` on listbox/combobox/tree-view item-indicators); without
`@source`, Tailwind never scans that markup and those utilities silently do not exist.
MassageIthaca carries the line; the scaffold did not — exactly the "visually-broken spoke
that still builds green" class.

Fix: added `@source '../node_modules/@skeletonlabs/skeleton-svelte/dist';` to `src/app.css`.
Proof it takes effect: `.size-4{width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}`
now appears in the built CSS (scaffold source itself never uses `size-4`, so it can only come
from the Skeleton dist scan).

## Verdict

Visual surface intact and hardened: `just build` green, bare-utility surface clean, `@source`
present, `.rounded-sm`/`.size-4` OBSERVED in emitted CSS.
