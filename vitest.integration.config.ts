/**
 * The testcontainers-backed lane (TIN-3817 slice S1).
 *
 * Separate from `vitest.config.ts` on purpose. These suites start a real
 * PostgreSQL 16.15 container, so they need a container daemon, minutes rather
 * than milliseconds, and no parallelism across files that would fight for
 * ports. Folding them into `just check` would make the default gate fail on
 * every machine without Docker — including this repository's ARC pool, which
 * advertises only `tinyland-nix` and has no dind/buildx runner.
 *
 * Entry point: `just test-integration`, which skips loudly rather than
 * silently when no daemon answers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep integration transformation independent of SvelteKit's generated
// `.svelte-kit/tsconfig.json`. Vite 8's Oxc transformer supports an inline
// tsconfig, but Vite intentionally omits that one field from its public Oxc
// type; spreading it beside a typed option preserves type checking for the
// rest of the configuration. `$lib` resolution remains the explicit alias
// below. This makes manual Bazel integration targets hermetic without making
// two actions copy the whole app source tree into the same output paths.
const inlineOxcTsconfig = {
	tsconfig: {
		compilerOptions: {
			strict: true,
			target: 'esnext',
			verbatimModuleSyntax: true,
		},
	},
} as const;

export default defineConfig({
	oxc: {
		target: 'esnext',
		...inlineOxcTsconfig,
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
		},
	},
	// Mirror of vite.config.ts `ssr.noExternal`: bcryptjs@2.4.3 is UMD-only and
	// yields no named exports under plain node ESM, so the auth package must be
	// transformed (CJS interop applied) rather than externalized — here exactly
	// as in the production server build. `@tummycrypt/tinyland-auth-pg` is
	// deliberately NOT inlined: it imports drizzle-orm, and transforming it
	// would give the adapter a second drizzle module instance — the very
	// two-copies failure the 0.39.3 pin exists to prevent.
	ssr: {
		noExternal: ['@tummycrypt/tinyland-auth'],
	},
	test: {
		include: ['src/**/*.integration.test.ts'],
		environment: 'node',
		globals: true,
		// One container per file already; running files in parallel multiplies
		// image pulls and port pressure without shortening the wall clock much.
		fileParallelism: false,
		// A cold `postgres:16.15` pull dominates the first run.
		testTimeout: 300_000,
		hookTimeout: 300_000,
		teardownTimeout: 120_000,
		// Vacuous green is the failure mode this lane cannot afford: if the glob
		// ever stops matching, say so instead of reporting success.
		passWithNoTests: false,
	},
});
