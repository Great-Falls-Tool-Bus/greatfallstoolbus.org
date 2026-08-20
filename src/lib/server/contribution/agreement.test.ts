/**
 * The contribution choice set, exactly spec §5's (TIN-3818; slices §1.10:
 * "$0/$5/$10/$20/$50 monthly, custom $5–$500 monthly, custom $60–$6,000
 * annual, cash, check, with server-side integer-cent validation and boundary
 * tests at each endpoint").
 */

import { describe, expect, it } from 'vitest';
import {
	ContributionChoiceError,
	CUSTOM_ANNUAL_CENTS,
	CUSTOM_MONTHLY_CENTS,
	MONTHLY_PRESETS_CENTS,
	stateForChoice,
	validateChoice,
} from './agreement';

describe('validateChoice', () => {
	it('accepts the non-card rails and $0', () => {
		expect(validateChoice({ kind: 'zero' })).toEqual({ kind: 'zero' });
		expect(validateChoice({ kind: 'cash' })).toEqual({ kind: 'cash' });
		expect(validateChoice({ kind: 'check' })).toEqual({ kind: 'check' });
	});

	it('accepts every monthly preset', () => {
		for (const amountCents of MONTHLY_PRESETS_CENTS) {
			expect(validateChoice({ kind: 'stripe', cadence: 'monthly', amountCents })).toEqual({
				kind: 'stripe',
				cadence: 'monthly',
				amountCents,
			});
		}
	});

	it('accepts both custom bounds inclusively, monthly and annual', () => {
		for (const amountCents of [CUSTOM_MONTHLY_CENTS.min, CUSTOM_MONTHLY_CENTS.max]) {
			expect(validateChoice({ kind: 'stripe', cadence: 'monthly', amountCents }).kind).toBe('stripe');
		}
		for (const amountCents of [CUSTOM_ANNUAL_CENTS.min, CUSTOM_ANNUAL_CENTS.max]) {
			expect(validateChoice({ kind: 'stripe', cadence: 'annual', amountCents }).kind).toBe('stripe');
		}
	});

	it('rejects one cent outside each bound', () => {
		for (const raw of [
			{ cadence: 'monthly', amountCents: CUSTOM_MONTHLY_CENTS.min - 1 },
			{ cadence: 'monthly', amountCents: CUSTOM_MONTHLY_CENTS.max + 1 },
			{ cadence: 'annual', amountCents: CUSTOM_ANNUAL_CENTS.min - 1 },
			{ cadence: 'annual', amountCents: CUSTOM_ANNUAL_CENTS.max + 1 },
		]) {
			expect(() => validateChoice({ kind: 'stripe', ...raw })).toThrow(ContributionChoiceError);
		}
	});

	it('rejects non-integer cents — rounding money is inventing an amount', () => {
		for (const amountCents of [1000.5, Number.NaN, Number.POSITIVE_INFINITY, '1000' as unknown as number]) {
			expect(() => validateChoice({ kind: 'stripe', cadence: 'monthly', amountCents })).toThrow(
				ContributionChoiceError,
			);
		}
	});

	it('rejects unknown kinds and cadences fail-closed', () => {
		expect(() => validateChoice({ kind: 'venmo' })).toThrow(ContributionChoiceError);
		expect(() => validateChoice({ kind: 'stripe', cadence: 'weekly', amountCents: 1000 })).toThrow(
			ContributionChoiceError,
		);
		expect(() => validateChoice({ kind: 'stripe', amountCents: 1000 })).toThrow(ContributionChoiceError);
	});
});

describe('stateForChoice', () => {
	it('lands each rail in its spec §5 state', () => {
		expect(stateForChoice({ kind: 'zero' })).toBe('zero');
		expect(stateForChoice({ kind: 'cash' })).toBe('cash_pending');
		expect(stateForChoice({ kind: 'check' })).toBe('cash_pending');
		expect(stateForChoice({ kind: 'stripe', cadence: 'monthly', amountCents: 1000 })).toBe('stripe_pending');
	});
});
