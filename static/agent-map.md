# greatfallstoolbus.org Agent Map

## Read Order

1. `AGENTS.md`
2. `CLAUDE.md` when running under Claude
3. `tinyland.repo.json` for machine-readable repo shape
4. `docs/agent-adoption.md` when adopting this contract in another repo
5. `docs/CI-SCHEMA.md` before v4 action or owner-transaction changes
6. The relevant `.agents/skills/*/SKILL.md`
7. `Justfile`

## Skills

Five repository-local tinyland-* skills:

- `.agents/skills/tinyland-whoami/SKILL.md`
- `.agents/skills/tinyland-spawn-sister-site/SKILL.md`
- `.agents/skills/tinyland-scaffold-doctor/SKILL.md`
- `.agents/skills/tinyland-repo-contract/SKILL.md`
- `.agents/skills/tinyland-static-spoke/SKILL.md`

GloriousFlywheel v4 adoption follows the upstream
`tinyland-inc/GloriousFlywheel/.agents/skills/tinyland-flywheel-enroll/SKILL.md`;
this consumer does not vendor the retired cache/profile skill.

The spawn entry is a discovery shim only. The executable creation transaction,
adapter selection, and rebrand implementation live in `tinyland-inc/site.scaffold`.

Seven generated mail lace-up skills (`.agents/skills/gftb-mail-laceup-*` for
gmail, thunderbird, apple-mail, kmail, geary, sieve, outlook), produced by
`scripts/build-agent-skills.mjs` via `just skills-build`; do not hand-edit.

Claude-compatible project skill entrypoints are symlinked from
`.claude/skills/*` to the canonical `.agents/skills/*` directories.

## Paste-To-Agent

Use `docs/agent-adoption.md` as the canonical prompt source. It tells agents to
triage worktrees first, classify repo shape, map enforceable layers, flag smells,
preserve dirty work, patch minimal conformance gaps, and validate through Just.

## Core Recipes

- `just setup`
- `just check`
- `just build`
- `just ci`
- `just secrets-scan-dir`
- `just secrets-scan`
- `just sbom`
- `just bazel-graph`
- `just repo-manifest-validate`
- `just conformance`

## Flywheel v4

- `.github/lanes.json` is the complete application-side ActionPlan.
- `spoke-ci-v4.yml@32e39ced0008edf4564ebeb173a5e8fbf069e28f`
  (`v5.1.0`, carrying ActionPlan/v4 schema 3) invokes only the image-custodied
  `gf-action-client`.
- `great-falls-tool-bus-infra` owns signed installation and demand instances.
- Missing App, overlay, binding, OIDC, client, or REAPI authority fails closed;
  there is no local, cache-only, hosted, profile, or endpoint fallback.

## Taxonomy

- Static spokes consume checked-in projections and do not own runtime app
  behavior.
- `tinyland.dev` is the mothership/content authority and is not governed by
  static-spoke conformance.
- Application repos own product behavior and finite Bazel actions; their
  consumer overlays own signed demand and non-action owner transactions.

## Prohibited

- Runtime database or backend in a spoke.
- Browser or edge fetches back to `tinyland.dev` for projections.
- Hard-coded Bazel cache, executor, token, or header values.
- OpenTofu, devserver, or image-push targets marked RBE eligible.
- Committed ad hoc validation scripts. Promote to a named script plus Just/Bazel target. Durable working output (findings, notes, plans) goes to a git-tracked docs/ location, never `/tmp` or a harness scratchpad dir; only genuinely transient single-command scratch may stay ephemeral.
