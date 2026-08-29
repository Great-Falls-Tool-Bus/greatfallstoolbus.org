#!/usr/bin/env -S pnpm exec tsx
/**
 * Thin entrypoint for the S1 synthetic membership rehearsal harness.
 *
 * All the harness logic lives in `first-membership-impl.mts`; this file
 * exists only to register `bcryptjs-esm-hook.mjs` (see that file's header)
 * BEFORE the implementation — and, transitively, the real auth package — is
 * imported. A module hook registered via `node:module`'s `register()` only
 * takes effect for imports that happen after the call returns, so the
 * implementation must be loaded with a dynamic `import()` here rather than a
 * static top-level `import`, which Node would otherwise hoist and resolve
 * ahead of the `register()` call below.
 */
import { register } from 'node:module';

register('./bcryptjs-esm-hook.mjs', import.meta.url);

await import('./first-membership-impl.mts');
