# Evidence — frontend-stack-truth-bump (prompt 34) wave-1 residuals, greatfallstoolbus.org half

Date: 2026-07-02 (UTC). Linear: TIN-2348 (residuals of TIN-2222/TIN-2223, both Done 2026-06-30).

## What this packet proves

- `just-check.txt` — full `just check` green (flywheel enrollment contract 10/10, gitleaks
  clean, prettier+eslint clean, svelte-check 0 errors / 0 warnings on typescript 6.0.3,
  vitest 15/15) INCLUDING the new `src/lib/house-stack-contract.test.ts` exact-pin guard.
- `contract-negative-test.txt` — the guard actually fails CI on drift: with `typescript`
  perturbed to `^6.0.3` and unscoped `lucide-svelte` injected, `just test-unit` exits 1
  (2 failed / 13 passed); the perturbation was then reverted.
- `npm-latest-verification.txt` — the June-2026 matrix re-verified against npm /latest on
  2026-07-02. Skeleton latest is still 4.15.2 (v5 = 5.0.0-next.11 pre-release only).
- `tailwind-audit.md` — the bare-utility + `@source` audit (NOT just a green tsc): found and
  fixed 5 deprecated bare `rounded` usages and a missing `@source` directive for the vendored
  Skeleton markup, with built-CSS proof.

## Honest labeling

- Every check in this packet ran HOST-LOCAL inside `nix develop` (`just check`, `just build`,
  `just test-unit`). No RBE/executor claim is made; no GloriousFlywheel remote execution was
  exercised in this lane. Cache hits are not executor proof and none are claimed.
- `ignoreDeprecations: "6.0"` is deliberately NOT set: svelte-check/tsc are green on 6.0.3
  with zero deprecated options in the tsconfig chain (no `target: es5`, no
  `downlevelIteration`, no import-assertions). Adding the flag would be dead config; add it
  only if a future tsconfig change trips a 6.0 deprecation.
- Out of scope for this lane, by design: build-config (image-opt, cssMinify, manualChunks —
  Prompt B / TIN-2224, already landed separately), runes idioms (Prompt C / TIN-2225),
  RBE-target promotion (GF lane).
