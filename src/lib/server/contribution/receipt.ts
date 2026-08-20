/**
 * Cash and check receipts — the first-class rails (TIN-3818; ADR 0016 §3.1,
 * spec §5 cash/check path, slices §3.3).
 *
 * Cash and check are RAILS, equal to card in every membership consequence.
 * They are not a Stripe fallback and they never fabricate a Stripe object:
 * an integration test holds a throwing Stripe stub while this module runs.
 *
 * `finance_receipt` is APPEND-ONLY BY GRANT (migration 0004 revokes UPDATE and
 * DELETE from the runtime role), so the correction path here can only ever
 * append: a reversal row pointing at the original via `reverses_id`, then a
 * fresh receipt when a corrected figure exists.
 *
 * Every function takes the `withTenant` transaction handle. Idempotency is
 * structural: `unique (tenant_id, idempotency_key)` plus
 * `on conflict do nothing` means the second delivery of one recording returns
 * the original receipt rather than minting a sibling (spec §6 request
 * contract).
 */

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { contributionAgreement, financeReceipt, type FinanceReceipt } from '../db/schema';

export class ReceiptValidationError extends Error {}

const CHECK_REF_RE = /^\d{1,4}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RecordReceiptInput {
	tenantId: string;
	personId: string;
	rail: 'cash' | 'check';
	amountCents: number;
	/** ISO date the money was received, e.g. '2026-08-19'. */
	receivedOn: string;
	/** Intention, not a schedule (spec §3.3). */
	cadence: 'monthly' | 'annual' | 'one_time';
	/** The finance-role actor entering the receipt. */
	recordedBy: string;
	note?: string;
	/** Last four digits of a check reference at most — never routing/account numbers (§1.10). */
	checkRefLast4?: string;
	/** The caller's Idempotency-Key. Required: a receipt without one cannot be deduplicated. */
	idempotencyKey: string;
	/** Set when this receipt reverses an earlier one. */
	reversesId?: string;
}

export interface RecordReceiptResult {
	receipt: FinanceReceipt;
	/** True when the idempotency key matched an existing receipt and no row was written. */
	deduplicated: boolean;
}

function validate(input: RecordReceiptInput): void {
	if (input.rail !== 'cash' && input.rail !== 'check') {
		throw new ReceiptValidationError(`rail must be cash|check, got ${JSON.stringify(input.rail)}`);
	}
	if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
		throw new ReceiptValidationError('amountCents must be a positive integer number of cents');
	}
	if (!ISO_DATE_RE.test(input.receivedOn)) {
		throw new ReceiptValidationError(`receivedOn must be an ISO date, got ${JSON.stringify(input.receivedOn)}`);
	}
	if (!['monthly', 'annual', 'one_time'].includes(input.cadence)) {
		throw new ReceiptValidationError(`cadence must be monthly|annual|one_time, got ${JSON.stringify(input.cadence)}`);
	}
	if (!input.idempotencyKey?.trim()) {
		throw new ReceiptValidationError('idempotencyKey is required');
	}
	if (input.checkRefLast4 !== undefined) {
		if (input.rail !== 'check') {
			throw new ReceiptValidationError('checkRefLast4 is only meaningful on the check rail');
		}
		if (!CHECK_REF_RE.test(input.checkRefLast4)) {
			// At most four digits. A full check/routing/account number pasted here
			// is a data-minimisation violation, so it is rejected, not truncated —
			// truncating would silently accept the paste.
			throw new ReceiptValidationError('checkRefLast4 must be 1–4 digits (never a full reference)');
		}
	}
}

/**
 * Record one operator-entered cash/check receipt (spec §5: amount, received
 * date, cadence/intention, recorder, immutable audit event).
 *
 * On a fresh recording the person's contribution agreement — when one exists
 * on the cash/check rail — advances to `cash_recorded`. The membership
 * aggregate is never touched from here: spec §5's "membership transitions
 * never query contribution state" has a structural converse, contribution
 * writes never reach membership, pinned by the import-boundary test.
 */
export async function recordCashCheckReceipt(
	tx: DbTransaction,
	input: RecordReceiptInput,
): Promise<RecordReceiptResult> {
	validate(input);

	const inserted = await tx
		.insert(financeReceipt)
		.values({
			tenantId: input.tenantId,
			personId: input.personId,
			rail: input.rail,
			amountCents: input.amountCents,
			receivedOn: input.receivedOn,
			cadence: input.cadence,
			recordedBy: input.recordedBy,
			note: input.note,
			checkRefLast4: input.checkRefLast4,
			reversesId: input.reversesId,
			idempotencyKey: input.idempotencyKey,
		})
		.onConflictDoNothing({ target: [financeReceipt.tenantId, financeReceipt.idempotencyKey] })
		.returning();

	if (inserted.length === 0) {
		// Duplicate request: return the original result (spec §6).
		const [original] = await tx
			.select()
			.from(financeReceipt)
			.where(and(eq(financeReceipt.tenantId, input.tenantId), eq(financeReceipt.idempotencyKey, input.idempotencyKey)))
			.limit(1);
		if (!original) {
			throw new Error('finance_receipt idempotency conflict with no visible original — RLS misrouting?');
		}
		return { receipt: original, deduplicated: true };
	}

	await tx
		.update(contributionAgreement)
		.set({ state: 'cash_recorded' })
		.where(and(eq(contributionAgreement.personId, input.personId), eq(contributionAgreement.state, 'cash_pending')));

	return { receipt: inserted[0], deduplicated: false };
}

export interface ReverseReceiptInput {
	tenantId: string;
	/** The receipt being reversed. */
	receiptId: string;
	recordedBy: string;
	note?: string;
	idempotencyKey: string;
}

/**
 * Append a reversal for an existing receipt (spec §5: "Corrections append a
 * reversal/replacement event"). The reversal row copies the original's
 * person/rail/amount/date/cadence and points back via `reverses_id`; when the
 * corrected figure differs, the caller follows with a fresh
 * `recordCashCheckReceipt`. The original row is never touched — the grant
 * layer would refuse anyway.
 */
export async function reverseReceipt(tx: DbTransaction, input: ReverseReceiptInput): Promise<RecordReceiptResult> {
	const [original] = await tx
		.select()
		.from(financeReceipt)
		.where(and(eq(financeReceipt.tenantId, input.tenantId), eq(financeReceipt.id, input.receiptId)))
		.limit(1);
	if (!original) {
		throw new ReceiptValidationError(`no receipt ${input.receiptId} to reverse`);
	}
	if (original.reversesId) {
		throw new ReceiptValidationError('a reversal row cannot itself be reversed — reverse the replacement instead');
	}
	return recordCashCheckReceipt(tx, {
		tenantId: input.tenantId,
		personId: original.personId,
		rail: original.rail as 'cash' | 'check',
		amountCents: original.amountCents,
		receivedOn: original.receivedOn,
		cadence: original.cadence as 'monthly' | 'annual' | 'one_time',
		recordedBy: input.recordedBy,
		note: input.note ?? `reversal of ${original.id}`,
		checkRefLast4: original.checkRefLast4 ?? undefined,
		idempotencyKey: input.idempotencyKey,
		reversesId: original.id,
	});
}

/** Every receipt for one person, oldest first — the finance reconciliation read. */
export async function listReceipts(tx: DbTransaction, personId: string): Promise<FinanceReceipt[]> {
	return tx
		.select()
		.from(financeReceipt)
		.where(eq(financeReceipt.personId, personId))
		.orderBy(financeReceipt.createdAt);
}
