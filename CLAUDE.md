# CLAUDE.md: greatfallstoolbus.org (Claude Code overlay)

This is a thin, Claude Code-specific overlay for a sister site spawned from
`tinyland-inc/site.scaffold`. `AGENTS.md` is the canonical, provider-neutral
operating contract; read it first for every operational detail (Just
recipes, Bazel/Flywheel wiring, gitleaks, Skeleton pin, agent routes, and
the parent scaffold link). This file does not duplicate that contract.

Claude Code-specific note:

- Project skills resolve via `.claude/skills/*`, a symlink mirror of the
  canonical `.agents/skills/*`. Edit the canonical copy, not the mirror.
