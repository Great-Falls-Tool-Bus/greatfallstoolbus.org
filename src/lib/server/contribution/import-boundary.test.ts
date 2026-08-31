/**
 * The static import boundary (TIN-3818; spec §5 "Membership transitions never
 * query contribution state", slices §1.10/§3.3 enforcement point 3).
 *
 * A grep-shaped assertion: no module under `src/lib/server/membership/` may
 * import from `src/lib/server/contribution/` or `src/lib/server/stripe/`.
 * The membership rows now exist, so both directions bind live. The one
 * application exception is presentation-only: `/apply` may import only the
 * zero-import offer contract, never the parser, writer, schema, Stripe
 * gateway, or checkout path.
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

describe('the application contribution preview is presentation-only', () => {
	it('the canonical offer contract has zero imports or writer/payment dependencies', () => {
		const contract = path.join(serverRoot, 'contribution', 'offer-contract.ts');
		const source = readFileSync(contract, 'utf8');

		// Zero direct imports means there is no transitive path from this
		// application-readable module into the database or payment graph.
		expect(importsIn(contract)).toEqual([]);
		expect(source).toContain('contributionOfferShape');
		expect(source).not.toMatch(
			/\b(?:drizzle|DbTransaction|ContributionAgreement|chooseContribution|parseOfferForm|createStripeGateway)\b|\/db\/|\/stripe\//,
		);
	});

	it('/apply imports only the zero-import contract and no writer or payment rail', () => {
		const applyServer = path.resolve(serverRoot, '../../routes/apply/+page.server.ts');
		const source = readFileSync(applyServer, 'utf8');
		const imports = importsIn(applyServer);

		expect(imports.filter((specifier) => specifier.includes('/contribution/'))).toEqual([
			'$lib/server/contribution/offer-contract',
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
