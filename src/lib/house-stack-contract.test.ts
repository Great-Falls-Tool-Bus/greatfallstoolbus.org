import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// House frontend-stack contract (TIN-2348; prompt 34-frontend-stack-truth-bump).
//
// site.scaffold carries the house exact pins but — until this test — shipped no
// CI-failing guard for them: the only check was the soft scaffold-doctor warn
// (which reads `dependencies`, not `devDependencies`, so it never fired on the
// real manifest). MassageIthaca asserts the same invariants in
// `src/tests/clinical-refresh-contract.test.ts` + `check:dep-hygiene`; this is
// the scaffold-side twin so the two repos cannot re-diverge silently.
//
// The invariants, per `context/house-frontend-stack.md`:
// - Skeleton + skeleton-svelte are EXACT `4.15.2` — there is NO Skeleton v5 GA
//   (only `5.0.0-next.*`); a "bump to v5" PR must fail here first, before
//   anything visual.
// - `typescript` is EXACT-pinned on the 6.0.x line (the one real manifest
//   major); it must never float behind a caret/tilde.
// - pnpm is `10.13.1` EXACT via corepack — never pnpm 9.
// - The icon identity is the SCOPED `@lucide/svelte` 1.x; the unscoped
//   `lucide-svelte` package is retired and must not reappear in any form.
// - `@zag-js` is consumed transitively through Skeleton, never as a direct dep.
//
// `package.json` and this test move together: an intentional pin change edits
// both in the same commit.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
	packageManager?: string;
	engines?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const allDeclaredDeps: Record<string, string> = {
	...(packageJson.dependencies ?? {}),
	...(packageJson.devDependencies ?? {}),
	...(packageJson.optionalDependencies ?? {}),
	...(packageJson.peerDependencies ?? {}),
};

describe('house frontend-stack exact-pin contract', () => {
	it('keeps Skeleton + skeleton-svelte EXACT at 4.15.2 (no phantom v5)', () => {
		expect(packageJson.devDependencies?.['@skeletonlabs/skeleton']).toBe('4.15.2');
		expect(packageJson.devDependencies?.['@skeletonlabs/skeleton-svelte']).toBe('4.15.2');
	});

	it('keeps typescript EXACT-pinned on the 6.0.x line (no caret/tilde float)', () => {
		expect(packageJson.devDependencies?.typescript).toMatch(/^6\.0\.\d+$/);
	});

	it('keeps pnpm 10.13.1 EXACT via packageManager (never pnpm 9)', () => {
		expect(packageJson.packageManager).toBe('pnpm@10.13.1');
	});

	it('keeps the icon identity on scoped @lucide/svelte 1.x; unscoped lucide-svelte is retired', () => {
		expect(packageJson.dependencies?.['@lucide/svelte']).toMatch(/^\^1\./);
		expect(allDeclaredDeps['lucide-svelte']).toBeUndefined();
	});

	it('never declares @zag-js as a direct dependency (transitive through Skeleton only)', () => {
		const directZag = Object.keys(allDeclaredDeps).filter((name) => name === '@zag-js' || name.startsWith('@zag-js/'));
		expect(directZag).toEqual([]);
	});

	it('keeps the Node 22 engines window', () => {
		expect(packageJson.engines?.node).toBe('>=22 <25');
	});

	it('keeps MODULE.bazel ts_version identical to the package.json typescript pin (TIN-2355)', () => {
		// Spawned sisters inherit MODULE.bazel, so the hub must not distribute a
		// stale Bazel-side TypeScript toolchain while package.json moves on.
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const tsVersion = moduleBazel.match(/ts_version\s*=\s*"([^"]+)"/)?.[1];
		expect(tsVersion).toBe(packageJson.devDependencies?.typescript);
	});
});
