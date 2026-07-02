# Claude — greatfallstoolbus.org sister site

This is a sister site spawned from `tinyland-inc/greatfallstoolbus.org`. Read
`AGENTS.md` first for the authoritative operating contract.

Quick reminders:

- Use `just <recipe>` for every operation — do not invoke pnpm/vite/bazelisk
  directly unless extending the Justfile.
- Project skills are available under `.claude/skills/*`; the canonical copies
  live under `.agents/skills/*`.
- GloriousFlywheel-backed Bazel work goes through
  `scripts/gloriousflywheel-bazel.sh`; do not hard-code remote cache or executor
  endpoints in `.bazelrc`.
- Run gitleaks through `just secrets-scan-dir` or `just secrets-scan`.
- Sites are static. No runtime DB, no auth at the edge — federate via
  `tinyland.dev` snapshots.
- Public agent routes: `/agent`, `/llms.txt`, and `/agent-map.md`.
- Skeleton 4.15.2 pinned exact. Tailwind v4 with `skeletonTailwindV4Compat()`
  shim. Do not unpin.
- Bazel registry: `tinyland-inc/bazel-registry` first, then BCR.
- See parent: https://github.com/tinyland-inc/greatfallstoolbus.org
