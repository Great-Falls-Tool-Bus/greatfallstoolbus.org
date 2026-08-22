/**
 * `buildFinanceRows` — the pure grouping/join half of the S10 finance read
 * (split out of `listFinanceContributions` so this logic is pinned without a
 * database, the `netAmountCents` precedent).
 */

import { describe, expect, it } from 'vitest';
import type { ContributionAgreement, FinanceReceipt } from '../db/schema';
import { FINANCE_ROLE, buildFinanceRows } from './finance-read';

function agreement(over: Partial<ContributionAgreement> = {}): ContributionAgreement {
	return {
		id: '55555555-5555-4555-8555-555555555555',
		tenantId: '33333333-3333-4333-8333-333333333333',
		personId: '11111111-1111-4111-8111-111111111111',
		state: 'stripe_pending',
		rail: 'stripe',
		cadence: 'monthly',
		amountCents: 2000,
		helpRequested: false,
		offeredAt: new Date('2026-08-20T12:00:00Z'),
		version: 1,
		...over,
	};
}

function receipt(over: Partial<FinanceReceipt> = {}): FinanceReceipt {
	return {
		id: '66666666-6666-4666-8666-666666666666',
		tenantId: '33333333-3333-4333-8333-333333333333',
		personId: '11111111-1111-4111-8111-111111111111',
		rail: 'cash',
		amountCents: 1000,
		receivedOn: '2026-08-19',
		cadence: 'one_time',
		recordedBy: '77777777-7777-4777-8777-777777777777',
		note: null,
		checkRefLast4: null,
		reversesId: null,
		idempotencyKey: 'idem-1',
		createdAt: new Date('2026-08-19T12:00:00Z'),
		...over,
	};
}

describe('FINANCE_ROLE', () => {
	it('is the ratified sitting-2 vocabulary, "finance" — no other spelling', () => {
		expect(FINANCE_ROLE).toBe('finance');
	});
});

describe('buildFinanceRows', () => {
	it('joins each agreement to its own receipts and the reversal-aware net, not a naive SUM', () => {
		const personA = agreement({ personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rail: 'cash', amountCents: null });
		const original = receipt({
			id: 'r1',
			personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			amountCents: 10_000,
		});
		const reversal = receipt({
			id: 'r2',
			personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			amountCents: 10_000,
			reversesId: 'r1',
		});
		const corrected = receipt({
			id: 'r3',
			personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			amountCents: 1_000,
		});

		const rows = buildFinanceRows(
			[personA],
			[original, reversal, corrected],
			[{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Alex Applicant' }],
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].displayName).toBe('Alex Applicant');
		expect(rows[0].view.receipts).toHaveLength(3);
		expect(rows[0].netReceiptsCents).toBe(1_000);
	});

	it('never crosses receipts between two different people', () => {
		const alex = agreement({ personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
		const bailey = agreement({ personId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
		const alexReceipt = receipt({ id: 'r1', personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amountCents: 500 });

		const rows = buildFinanceRows([alex, bailey], [alexReceipt], []);
		const byPerson = new Map(rows.map((r) => [r.personId, r]));
		expect(byPerson.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')?.view.receipts).toHaveLength(1);
		expect(byPerson.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')?.view.receipts).toHaveLength(0);
		expect(byPerson.get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')?.netReceiptsCents).toBe(0);
	});

	it('falls back to a placeholder name rather than failing when no person row exists yet', () => {
		const rows = buildFinanceRows([agreement()], [], []);
		expect(rows[0].displayName).toBe('(no person record)');
	});

	it('lists an agreement with no receipts at all — the pure-Stripe case', () => {
		const rows = buildFinanceRows([agreement({ amountCents: 5000, cadence: 'annual' })], [], []);
		expect(rows[0].view.agreement?.amountCents).toBe(5000);
		expect(rows[0].netReceiptsCents).toBe(0);
	});

	it('carries the amount and rail — this is exactly what the keyholder view withholds', () => {
		const rows = buildFinanceRows([agreement({ amountCents: 4200, rail: 'stripe' })], [], []);
		expect(rows[0].view.agreement?.amountCents).toBe(4200);
		expect(rows[0].view.agreement?.rail).toBe('stripe');
	});
});
