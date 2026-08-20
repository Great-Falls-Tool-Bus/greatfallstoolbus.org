/**
 * Receipt validation happens BEFORE any database access (TIN-3818).
 *
 * The transaction handle below is a proxy that throws on any touch, so every
 * green row here is also a proof of ordering: a validation failure never
 * reaches the database. The write paths themselves (idempotency, append-only
 * grants, reversal chains) run against real PostgreSQL in
 * `payment-rails.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { DbTransaction } from '../db/client';
import { netAmountCents, ReceiptValidationError, recordCashCheckReceipt } from './receipt';

const untouchableTx = new Proxy({} as DbTransaction, {
	get(_target, property) {
		throw new Error(`validation must precede db access — tx.${String(property)} was touched`);
	},
});

const valid = {
	tenantId: '33333333-3333-4333-8333-333333333333',
	personId: '11111111-1111-4111-8111-111111111111',
	rail: 'cash' as const,
	amountCents: 2000,
	receivedOn: '2026-08-20',
	cadence: 'monthly' as const,
	recordedBy: '44444444-4444-4444-8444-444444444444',
	idempotencyKey: 'unit-key-1',
};

describe('recordCashCheckReceipt validation', () => {
	it('rejects a rail that is neither cash nor check', async () => {
		await expect(recordCashCheckReceipt(untouchableTx, { ...valid, rail: 'stripe' as never })).rejects.toThrow(
			ReceiptValidationError,
		);
	});

	it('rejects zero, negative, and non-integer amounts', async () => {
		for (const amountCents of [0, -500, 10.5, Number.NaN]) {
			await expect(recordCashCheckReceipt(untouchableTx, { ...valid, amountCents })).rejects.toThrow(
				ReceiptValidationError,
			);
		}
	});

	it('rejects a malformed received date and cadence', async () => {
		await expect(recordCashCheckReceipt(untouchableTx, { ...valid, receivedOn: '08/20/2026' })).rejects.toThrow(
			ReceiptValidationError,
		);
		await expect(recordCashCheckReceipt(untouchableTx, { ...valid, cadence: 'weekly' as never })).rejects.toThrow(
			ReceiptValidationError,
		);
	});

	it('requires an idempotency key — an unkeyed receipt cannot be deduplicated', async () => {
		await expect(recordCashCheckReceipt(untouchableTx, { ...valid, idempotencyKey: '  ' })).rejects.toThrow(
			ReceiptValidationError,
		);
	});

	it('rejects checkRefLast4 on the cash rail, non-digits, and anything longer than four digits', async () => {
		await expect(recordCashCheckReceipt(untouchableTx, { ...valid, checkRefLast4: '1234' })).rejects.toThrow(
			/only meaningful on the check rail/,
		);
		for (const checkRefLast4 of ['12345', 'abcd', '12-3', '']) {
			await expect(recordCashCheckReceipt(untouchableTx, { ...valid, rail: 'check', checkRefLast4 })).rejects.toThrow(
				ReceiptValidationError,
			);
		}
	});
});

describe('netAmountCents — the reversal-aware sum (S6)', () => {
	it('nets the reviewer example: $100 corrected down to $10 is $10, never $210', () => {
		const trail = [
			{ id: 'a', amountCents: 10_000, reversesId: null },
			{ id: 'b', amountCents: 10_000, reversesId: 'a' },
			{ id: 'c', amountCents: 1_000, reversesId: null },
		];
		const naive = trail.reduce((sum, r) => sum + r.amountCents, 0);
		expect(naive).toBe(21_000); // what a bare SUM(amount_cents) misreports
		expect(netAmountCents(trail)).toBe(1_000);
	});

	it('sums an uncorrected trail plainly and an all-reversed trail to zero', () => {
		expect(
			netAmountCents([
				{ id: 'a', amountCents: 500, reversesId: null },
				{ id: 'b', amountCents: 2_000, reversesId: null },
			]),
		).toBe(2_500);
		expect(
			netAmountCents([
				{ id: 'a', amountCents: 500, reversesId: null },
				{ id: 'b', amountCents: 500, reversesId: 'a' },
			]),
		).toBe(0);
		expect(netAmountCents([])).toBe(0);
	});
});
