---
name: tinyland-flywheel-bazel
description: Implement or review Tinyland cache-first Bazel, Bzlmod, GloriousFlywheel remote cache, remote execution, and RBE-ready test/build wiring. Use when changing BUILD.bazel, MODULE.bazel, .bazelrc, .bazelrc.flywheel, Justfile flywheel recipes, CI runner classes, Bazel test/build targets, or any Tinyland repo that must run checks, tests, builds, or graph proofs through Bazel and GloriousFlywheel.
---

# Tinyland Flywheel Bazel

## Overview

Use this skill to make Tinyland repositories graphable, cache-first, and ready
for GloriousFlywheel remote execution without leaking cache endpoints or
credentials into source. Prefer repo-local contracts over memory: read
`AGENTS.md`, `docs/CI-SCHEMA.md`, `Justfile`, `.bazelrc`, `.bazelrc.flywheel`,
and `scripts/gloriousflywheel-bazel.sh` before editing.

## Cold Start (run first when env may be missing)

If `just flywheel-build` / `flywheel-test` / `flywheel-info` would fast-fail
with missing profile/cache environment, run the advertised enrollment checks
FIRST:

```bash
just flywheel-enroll
just flywheel-doctor
just flywheel-verify
```

`flywheel-enroll` names the canonical GloriousFlywheel fleet profile path and
can materialize an ignored `.env.flywheel.local` fallback only from explicit
operator-provided endpoint data. `flywheel-doctor` checks `bazelisk` on PATH,
validates `GF_FLYWHEEL_PROFILE_STATE`, `BAZEL_REMOTE_CACHE`, and
`GF_BAZEL_SUBSTRATE_MODE`, audits `.bazelrc.flywheel` for forbidden hard-coded
endpoints, and runs a 2-second TCP reachability probe. `flywheel-verify` is the
fail-closed gate agents should pass before cache-backed Bazel work.

Do not paste a `BAZEL_REMOTE_CACHE` value into committed files. The endpoint
must come from the GloriousFlywheel fleet profile, CI runtime, operator shell,
or ignored `.env.flywheel.local` fallback. The wrapper rejects rc-file-embedded
endpoints.

## Operating Rules

1. Route every developer and agent command through `just <recipe>`. Add a
   Justfile recipe before documenting or using a new operation.
2. Keep endpoint authority out of rc files. `.bazelrc.flywheel` may define safe
   behavior, but must not define `remote_cache`, `remote_executor`, or upload
   authority.
3. Require `BAZEL_REMOTE_CACHE` for every Flywheel-backed Bazel operation.
   Missing cache means fail fast, not heavy local fallback.
4. Require `GF_FLYWHEEL_PROFILE_STATE` to be one of `unattached`,
   `shared-cache-backed`, `executor-backed`, or `local-proof` before an agent
   claims enrollment is healthy.
5. Use `GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed` for remote cache only.
   Use `executor-backed` only on cluster runners with `BAZEL_REMOTE_EXECUTOR`.
6. Leave `GF_BAZEL_REMOTE_UPLOAD` false or unset on PRs. Set it true only in
   trusted default-branch or operator cache-writing lanes.
7. Treat remote cache hits, ARC dispatch, and GitHub-hosted execution as not
   RBE. RBE means remote execution evidence, such as remote processes greater
   than zero for an allowed target class.
8. Never make OpenTofu, dev servers, or image-push targets executor eligible.
   Playwright/Puppeteer browser smoke tests stay candidate-only until the
   GloriousFlywheel eligibility manifest promotes them.

## Required Files

For a Tinyland repo with Bazel support, ensure these exist:

- `MODULE.bazel` with Bzlmod enabled and Tinyland registry before BCR.
- `.bazelrc` with `--enable_bzlmod`, registry order, safe local behavior, and
  `try-import %workspace%/.bazelrc.flywheel`.
- `.bazelrc.flywheel` with endpoint-free `common:flywheel` and
  `common:flywheel-executor` behavior only.
- `scripts/gloriousflywheel-bazel.sh` or the repo-approved equivalent wrapper.
- `Justfile` recipes that call the wrapper for all `flywheel-*` operations.
- `BUILD.bazel` targets for every CI-relevant check, test, and build.

## Target Rules

Wire test and build tools as Bazel targets, then make Justfile recipes call
those targets. For SvelteKit/TypeScript repos:

- Use Aspect `js_run_binary` for bounded build/type-generation actions.
- Use `vitest_test` or `js_test` for unit tests.
- Use `js_test` for Playwright/Puppeteer only as a candidate target unless the
  repo's CI schema says the browser class is proved.
- Tag only proved static-spoke classes with `flywheel-eligible`:
  `sveltekit-app-build`, `sveltekit-unit-tests`,
  `deployment-bundle-packaging`, and `docs-site-static-build`.
- Keep target names finite and explicit. Do not rely on broad `//...` as the
  primary RBE proof surface.

Use these default Justfile shapes unless the repo has a stricter local contract:

```just
flywheel-info:
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh info

flywheel-enroll *args:
    cd {{ root }} && bash scripts/flywheel-enroll.sh {{ args }}

flywheel-doctor:
    cd {{ root }} && bash scripts/flywheel-doctor.sh

flywheel-verify:
    cd {{ root }} && bash scripts/flywheel-verify.sh

flywheel-build target="//:build":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh build {{ target }}

flywheel-test target="//:ci_validation_suite":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh test {{ target }}

flywheel-fetch target="//...":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh fetch {{ target }}
```

## Authentication

Do not commit cache endpoints, executor endpoints, tokens, API keys, `.netrc`,
credential-helper state, or headers. The CI template, Blahaj, runner
environment, or operator shell supplies them through environment variables.

When a repo needs header-based auth, add wrapper support for a narrowly named
environment variable and pass it as a Bazel flag at runtime. Do not place the
value in `.bazelrc`, workflow YAML, examples, or docs.

## Validation

Before claiming completion:

- Run `just conformance` when present.
- Run `just lanes-validate` after lane schema changes.
- Run `just flywheel-enroll`, `just flywheel-doctor`, and
  `just flywheel-verify` before claiming a consumer is attached to the shared
  substrate.
- Run local Bazel graph checks such as `just bazel-graph` when changing
  `MODULE.bazel`, registries, lockfiles, or in-house dependency versions.
- Run `just flywheel-info`, `just flywheel-build`, or `just flywheel-test` only
  when a real `BAZEL_REMOTE_CACHE` is available.
- If remote cache/executor env is absent, report that RBE validation could not
  be performed. Do not substitute raw `bazelisk build` and call it equivalent.
