/**
 * Offer-shape and form-parsing unit rows (TIN-3818 slice S7; spec §5:230–233;
 * ADR 0014 §5).
 *
 *   - the offer serves EXACTLY the ratified choice set: $0/$5/$10/$20/$50
 *     monthly presets, custom monthly $5–$500, custom annual $60–$6,000,
 *     cash, check — a changed number fails here before it ships;
 *   - dollar parsing is exact: sub-cent fractions, negatives, and garbage
 *     are rejections, never roundings;
 *   - every parsed path terminates in `validateChoice`, so the form cannot
 *     loosen the server bounds;
 *   - the member self-view is a closed shape (structural key assertion, the
 *     visibility.ts discipline applied to the member read).
 */

import { describe, expect, it } from 'vitest';
import { ContributionChoiceError } from './agreement';
import { contributionOfferShape, memberContributionView, parseDollarsToCents, parseOfferForm } from './offer';
import type { ContributionAgreement } from '../db/schema';

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

describe('contributionOfferShape (TIN-3818 choice set)', () => {
	it('serves exactly $0/$5/$10/$20/$50 monthly, $5–$500 custom monthly, $60–$6,000 custom annual, cash, check', () => {
		const shape = contributionOfferShape();
		expect(shape.presetsCents).toEqual([0, 500, 1000, 2000, 5000]);
		expect(shape.customMonthlyCents).toEqual({ min: 500, max: 50_000 });
		expect(shape.customAnnualCents).toEqual({ min: 6_000, max: 600_000 });
		expect(shape.rails).toEqual(['cash', 'check']);
		// Structural: the shape itself is closed — a new field is a spec change.
		expect(Object.keys(shape).sort()).toEqual(['customAnnualCents', 'customMonthlyCents', 'presetsCents', 'rails']);
	});
});

describe('parseDollarsToCents', () => {
	it('parses whole dollars, $-prefixed figures, and two-decimal cents exactly', () => {
		expect(parseDollarsToCents('5')).toBe(500);
		expect(parseDollarsToCents('$5')).toBe(500);
		expect(parseDollarsToCents('12.50')).toBe(1250);
		expect(parseDollarsToCents('12.5')).toBe(1250);
		expect(parseDollarsToCents(' 60 ')).toBe(6000);
		expect(parseDollarsToCents('6000')).toBe(600000);
		expect(parseDollarsToCents('4.99')).toBe(499);
	});

	it('rejects sub-cent fractions, negatives, and non-figures instead of rounding', () => {
		for (const bad of ['5.005', '-5', 'abc', '', '5,00', '1e3', 'NaN', 'Infinity', '5.', '.5']) {
			expect(() => parseDollarsToCents(bad), bad).toThrow(ContributionChoiceError);
		}
	});
});

describe('parseOfferForm', () => {
	it('maps $0 — as pick=zero and as the zero preset — to the zero kind', () => {
		expect(parseOfferForm(form({ pick: 'zero' })).choice).toEqual({ kind: 'zero' });
		expect(parseOfferForm(form({ pick: 'preset:0' })).choice).toEqual({ kind: 'zero' });
	});

	it('maps the monthly presets to stripe/monthly and refuses invented presets', () => {
		expect(parseOfferForm(form({ pick: 'preset:500' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'monthly',
			amountCents: 500,
		});
		expect(parseOfferForm(form({ pick: 'preset:5000' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'monthly',
			amountCents: 5000,
		});
		// $7 is not a preset even though it is inside the custom bounds: the
		// preset path admits only the ratified five.
		expect(() => parseOfferForm(form({ pick: 'preset:700' }))).toThrow(ContributionChoiceError);
	});

	it('parses custom monthly and annual through the server bounds (boundary rows)', () => {
		expect(parseOfferForm(form({ pick: 'custom_monthly', amount: '5' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'monthly',
			amountCents: 500,
		});
		expect(parseOfferForm(form({ pick: 'custom_monthly', amount: '500' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'monthly',
			amountCents: 50_000,
		});
		expect(parseOfferForm(form({ pick: 'custom_annual', amount: '60' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'annual',
			amountCents: 6_000,
		});
		expect(parseOfferForm(form({ pick: 'custom_annual', amount: '6000' })).choice).toEqual({
			kind: 'stripe',
			cadence: 'annual',
			amountCents: 600_000,
		});
		// One cent outside each bound is a refusal (spec §5:230–232).
		for (const [pick, amount] of [
			['custom_monthly', '4.99'],
			['custom_monthly', '500.01'],
			['custom_annual', '59.99'],
			['custom_annual', '6000.01'],
		] as const) {
			expect(() => parseOfferForm(form({ pick, amount })), `${pick} ${amount}`).toThrow(ContributionChoiceError);
		}
	});

	it('parses cash and check as first-class rails and helpRequested independently', () => {
		expect(parseOfferForm(form({ pick: 'cash' }))).toEqual({ choice: { kind: 'cash' }, helpRequested: false });
		expect(parseOfferForm(form({ pick: 'check', helpRequested: 'true' }))).toEqual({
			choice: { kind: 'check' },
			helpRequested: true,
		});
	});

	it('refuses an unknown pick and a missing pick', () => {
		expect(() => parseOfferForm(form({ pick: 'stripe' }))).toThrow(ContributionChoiceError);
		expect(() => parseOfferForm(form({}))).toThrow(ContributionChoiceError);
	});
});

describe('memberContributionView', () => {
	const agreement = {
		id: 'x',
		tenantId: 't',
		personId: 'p',
		state: 'cash_pending',
		rail: 'cash',
		cadence: null,
		amountCents: null,
		helpRequested: true,
		offeredAt: new Date(),
		version: 3,
		createdAt: new Date(),
	} as unknown as ContributionAgreement;

	it("no agreement → state 'none', nothing else", () => {
		expect(memberContributionView(undefined)).toEqual({
			state: 'none',
			rail: null,
			cadence: null,
			amountCents: null,
			helpRequested: false,
			version: null,
		});
	});

	it('is a CLOSED shape: a new agreement column cannot leak by spread', () => {
		const view = memberContributionView(agreement);
		expect(Object.keys(view).sort()).toEqual(['amountCents', 'cadence', 'helpRequested', 'rail', 'state', 'version']);
		expect(view.state).toBe('cash_pending');
		expect(view.helpRequested).toBe(true);
	});
});
