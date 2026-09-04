import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
		},
	},
	test: {
		include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts', 'scripts/**/*.test.mts'],
		// The testcontainers-backed suite (TIN-3817 S1) is a separate lane:
		// vitest.integration.config.ts, behind `just test-integration`. It needs a
		// container daemon, which neither this repository's ARC pool nor a typical
		// laptop has — so it must never be reachable from `just check`, and
		// `just check` must never be quietly weakened by its absence.
		exclude: ['**/node_modules/**', '**/build/**', '**/.svelte-kit/**', 'src/**/*.integration.test.ts'],
		environment: 'node',
		globals: true,
		passWithNoTests: false,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				lines: 50,
				functions: 50,
				branches: 50,
				statements: 50,
			},
			include: ['src/**/*.{ts,svelte.ts}', 'scripts/**/*.mts'],
			exclude: [
				'**/*.test.ts',
				'**/*.test.mts',
				'**/*.test.svelte.ts',
				// Fixture code for the integration lane, which this config never runs.
				'src/lib/server/db/integration-support.ts',
			],
		},
	},
});
