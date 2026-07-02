---
name: tinyland-repo-contract
description: Bring a Tinyland repository into the standard agent/developer contract, including Justfile as the only entrypoint, minimal Nix flake/devshell, gitleaks secret scanning, no committed ad hoc validation scripts, Bazel graphability, and repo-local validation recipes. Use when bootstrapping, auditing, or repairing repo DX/AX, CI validation, security scanning, or command documentation.
---

# Tinyland Repo Contract

## Overview

Use this skill to make a Tinyland repo predictable for humans and agents. Every
operation should be discoverable through `just`, reproducible through
`nix develop`, guarded by gitleaks, and backed by named validation targets
rather than one-off scripts.

## Non-Negotiables

1. `Justfile` is the single authoritative DX/AX entrypoint.
2. `flake.nix` exists, even if minimal, and exposes tools required by Just
   recipes and CI.
3. `tinyland.repo.json` exists when the repo participates in Tinyland house
   conformance; it declares repo role, contract surfaces, authority boundaries,
   and SBOM posture.
4. Gitleaks is configured and runnable through `just`.
5. Tests, checks, builds, and compile steps have stable recipes. If the repo is
   Bazel-enabled, CI-relevant validation must also have Bazel targets.
6. Do not commit loose ad hoc validation files. Use `/tmp` for one-time
   experiments, or promote the file into `scripts/` plus a Just recipe or Bazel
   target.
7. Do not commit `.env`, credentials, decrypted SOPS data, tokens, kubeconfigs,
   private keys, `.netrc`, or cache auth material.

## Justfile Shape

Prefer these recipe names unless the repo has a documented equivalent:

- `setup`: install dependencies with lockfile discipline.
- `dev`: start the local developer server or watcher.
- `build`: produce the main artifact.
- `typecheck`, `lint`, `format-check`, `test-unit`, `test-e2e`, `test`.
- `check`: pre-commit quality gate.
- `ci`: local approximation of CI.
- `secrets-scan`: gitleaks scan of git history.
- `secrets-scan-dir`: gitleaks scan of the working tree.
- `conformance`: repo-specific contract check when present.
- `repo-manifest-validate`: validate `tinyland.repo.json` when present.
- `flywheel-*`: only for wrapper-mediated Bazel cache/RBE operations.

When documenting commands, document `just <recipe>`, not underlying `pnpm`,
`vite`, `pytest`, `bazelisk`, or other tool invocations.

## Nix Shape

A minimal flake is acceptable, but it must include the tools the Justfile uses.
For Tinyland web/static repos, that usually includes `nodejs_22`, `pnpm`,
`just`, `git`, `gh`, `bazelisk`, `gitleaks`, `python3`, `jq`, and any schema or
infra tools called by recipes.

Use `nix develop --command just <recipe>` in CI. Do not assume host toolchains.

## Gitleaks Shape

Use gitleaks default rules and add narrow Tinyland rules for known provider
token formats. Prefer `[[allowlists]]` entries with descriptions. Do not blanket
allow all docs or tests unless the repo has a reviewed reason.

Minimum recipes:

```just
secrets-scan:
    cd {{ root }} && gitleaks git --config .gitleaks.toml --redact --verbose .

secrets-scan-dir:
    cd {{ root }} && gitleaks dir --config .gitleaks.toml --redact --verbose .
```

Run at least the directory scan after changing gitleaks config. Run the git
history scan before shipping security-sensitive changes.

## Bazel And Test Shape

If Bazel is present, every CI-relevant test family needs a Bazel label:

- Vitest or JS property tests: Bazel `vitest_test`/`js_test`.
- Python tests: Bazel `py_test`.
- Rust tests: Bazel `rust_test`.
- Zig/C/C++ tests: Bazel-native test rules or bounded wrapper targets.
- Browser tests: finite `js_test` smoke targets, candidate-only until proved
  RBE eligible.

Keep local `just check` ergonomic, but do not leave CI or RBE without Bazel
targets for the same validation surface.

## Completion Checklist

- `just --list --unsorted` shows the required recipes.
- `nix develop --command just info` or equivalent works.
- `tinyland.repo.json` validates if the repo has adopted the manifest contract.
- `just secrets-scan-dir` succeeds, or findings are fixed.
- `just check` and relevant tests/builds run.
- `just conformance` runs when the repo provides it.
- No new one-off files were committed outside a real source, script, test, doc,
  or config role.
