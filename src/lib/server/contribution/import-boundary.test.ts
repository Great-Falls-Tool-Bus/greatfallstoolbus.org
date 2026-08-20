/**
 * The static import boundary (TIN-3818; spec §5 "Membership transitions never
 * query contribution state", slices §1.10/§3.3 enforcement point 3).
 *
 * A grep-shaped assertion: no module under `src/lib/server/membership/` may
 * import from `src/lib/server/contribution/` or `src/lib/server/stripe/`.
 * Membership does not exist yet (S4–S7 own it) — today the rows bind
 * VACUOUSLY ON PURPOSE, so the boundary is already law the day the first
 * membership module lands, rather than a retrofit. The converse direction is
 * NOT vacuous and is asserted for real: the payment packages never reach into
 * membership either.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourcesUnder(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) return sourcesUnder(full);
		return /\.(ts|js|svelte)$/.test(entry) && !entry.includes('.test.') ? [full] : [];
	});
}

function importsIn(file: string): string[] {
	const source = readFileSync(file, 'utf8');
	return [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('membership must never see contribution state', () => {
	it('no membership module imports contribution or stripe code', () => {
		const offenders: string[] = [];
		for (const file of sourcesUnder(path.join(serverRoot, 'membership'))) {
			for (const specifier of importsIn(file)) {
				if (
					/(\/|^\$lib\/)?server\/(contribution|stripe)\//.test(specifier) ||
					/\.\.\/(contribution|stripe)\//.test(specifier)
				) {
					offenders.push(`${path.relative(serverRoot, file)} imports ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe('cash/check never fabricate a Stripe object', () => {
	it('no contribution module imports stripe code — the dependency only points the other way', () => {
		// stripe/checkout.ts and stripe/project.ts may import contribution
		// validation and state; the cash/check rail must have no path to a
		// Stripe client at all (spec §5, §3.3).
		const offenders: string[] = [];
		for (const file of sourcesUnder(path.join(serverRoot, 'contribution'))) {
			for (const specifier of importsIn(file)) {
				if (specifier.includes('stripe')) {
					offenders.push(`${path.relative(serverRoot, file)} imports ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

describe('and the payment rails never reach into membership', () => {
	it('no contribution or stripe module imports membership code', () => {
		const offenders: string[] = [];
		for (const dir of ['contribution', 'stripe']) {
			for (const file of sourcesUnder(path.join(serverRoot, dir))) {
				for (const specifier of importsIn(file)) {
					if (specifier.includes('membership')) {
						offenders.push(`${path.relative(serverRoot, file)} imports ${specifier}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it('is not vacuous in this direction: the payment modules exist and import things', () => {
		const files = [
			...sourcesUnder(path.join(serverRoot, 'contribution')),
			...sourcesUnder(path.join(serverRoot, 'stripe')),
		];
		expect(files.length).toBeGreaterThanOrEqual(8);
		expect(files.flatMap(importsIn).length).toBeGreaterThan(0);
	});
});
