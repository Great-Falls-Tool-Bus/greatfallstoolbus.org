/**
 * The keyholder view is a CLOSED shape (TIN-3818; spec §5, slices §1.10:
 * "asserted by shape, so an added field fails the test").
 */

import { describe, expect, it } from 'vitest';
import type { ContributionAgreement } from '../db/schema';
import { financeContributionView, keyholderContributionView } from './visibility';

const agreement: ContributionAgreement = {
	id: '55555555-5555-4555-8555-555555555555',
	tenantId: '33333333-3333-4333-8333-333333333333',
	personId: '11111111-1111-4111-8111-111111111111',
	state: 'cash_recorded',
	rail: 'cash',
	cadence: 'monthly',
	amountCents: 2000,
	helpRequested: true,
	offeredAt: new Date('2026-08-20T12:00:00Z'),
	version: 3,
};

describe('keyholderContributionView', () => {
	it('returns EXACTLY {offered, helpRequested} — an added key fails here before it leaks', () => {
		const view = keyholderContributionView(agreement);
		expect(Object.keys(view).sort()).toEqual(['helpRequested', 'offered']);
		expect(view).toEqual({ offered: true, helpRequested: true });
	});

	it('never carries amount, rail, or processor state under any spelling', () => {
		const serialized = JSON.stringify(keyholderContributionView(agreement));
		for (const forbidden of ['amount', 'rail', 'cadence', 'stripe', 'cash', '2000', 'state', 'version']) {
			expect(serialized).not.toContain(forbidden);
		}
	});

	it('reads an absent agreement as not-offered, no-help-requested', () => {
		expect(keyholderContributionView(undefined)).toEqual({ offered: false, helpRequested: false });
	});
});

describe('financeContributionView', () => {
	it('keeps the rails visible without collapsing them', () => {
		const view = financeContributionView(agreement, []);
		expect(view.agreement?.rail).toBe('cash');
		expect(view.agreement?.amountCents).toBe(2000);
		expect(view.receipts).toEqual([]);
	});
});
