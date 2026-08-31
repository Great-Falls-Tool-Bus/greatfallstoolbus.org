/**
 * The static import boundary (TIN-3818; spec §5 "Membership transitions never
 * query contribution state", slices §1.10/§3.3 enforcement point 3).
 *
 * A grep-shaped assertion: no module under `src/lib/server/membership/` may
 * import from `src/lib/server/contribution/` or `src/lib/server/stripe/`.
 * The membership rows now exist, so both directions bind live. The one
 * pre-approval exception is presentation-only: `/apply` may import the pure
 * `contributionOfferShape`, but never the parser, writer, Stripe gateway, or
 * checkout path.
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

describe('the pre-approval contribution preview is presentation-only', () => {
	it('/apply imports only the canonical pure shape and no writer or payment rail', () => {
		const applyServer = path.resolve(serverRoot, '../../routes/apply/+page.server.ts');
		const source = readFileSync(applyServer, 'utf8');
		const imports = importsIn(applyServer);

		expect(imports.filter((specifier) => specifier.includes('/contribution/'))).toEqual([
			'$lib/server/contribution/offer',
		]);
		expect(imports.filter((specifier) => specifier.includes('/stripe/'))).toEqual([]);
		expect(source).toContain('contributionOfferShape()');
		for (const forbidden of [
			'parseOfferForm',
			'chooseContribution',
			'createStripeGateway',
			'createContributionCheckout',
		]) {
			expect(source).not.toContain(forbidden);
		}
	});
});

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
