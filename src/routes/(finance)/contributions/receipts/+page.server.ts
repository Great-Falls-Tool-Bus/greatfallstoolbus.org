/**
 * Finance-only cash/check receipt entry (TIN-3818).
 *
 * This is deliberately a separate write route from /contributions, whose
 * no-actions export remains the structural read-only boundary. The live
 * finance grant is checked inside the same tenant transaction as every
 * write. Tenant, rail, and recorder are derived server-side; no session
 * rotation or payment-processor authority is involved.
 */

import { randomUUID } from 'node:crypto';
import { error as httpError, fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { AuthError } from '$lib/server/auth';
import { getAgreement } from '$lib/server/contribution/agreement';
import {
	listFinanceContributions,
	type FinanceContributionRow,
	requireFinance,
} from '$lib/server/contribution/finance-read';
import {
	IdempotencyConflictError,
	ReceiptValidationError,
	recordCashCheckReceipt,
	reverseReceipt,
} from '$lib/server/contribution/receipt';
import { withTenant } from '$lib/server/db/tenant';
import type { PageServerLoad } from './$types';
import { resolveFinanceActor } from '../actor';

export const prerender = false;

type ReceiptRail = 'cash' | 'check';
type ReceiptCadence = 'monthly' | 'annual' | 'one_time';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_CENTS_RE = /^[1-9][0-9]*$/;

class CashCheckAgreementRequiredError extends Error {}

export interface ReceiptEntrySeams {
	env?: NodeJS.ProcessEnv;
	operationId?: () => string;
}

interface ReceiptFields {
	amountCents: number;
	receivedOn: string;
	cadence: ReceiptCadence;
	note?: string;
	checkRefLast4?: string;
}

function textField(form: FormData, name: string): string | null {
	const value = form.get(name);
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function optionalTextField(form: FormData, name: string): string | undefined {
	return textField(form, name) ?? undefined;
}

function uuidField(form: FormData, name: string): string | null {
	const value = textField(form, name);
	return value && UUID_RE.test(value) ? value : null;
}

function receiptFields(form: FormData): ReceiptFields | null {
	const rawAmount = textField(form, 'amountCents');
	const receivedOn = textField(form, 'receivedOn');
	const cadence = textField(form, 'cadence');
	if (!rawAmount || !POSITIVE_CENTS_RE.test(rawAmount) || !receivedOn) return null;
	if (cadence !== 'monthly' && cadence !== 'annual' && cadence !== 'one_time') return null;

	const amountCents = Number(rawAmount);
	if (!Number.isSafeInteger(amountCents)) return null;

	return {
		amountCents,
		receivedOn,
		cadence,
		note: optionalTextField(form, 'note'),
		checkRefLast4: optionalTextField(form, 'checkRefLast4'),
	};
}

function cashCheckRail(agreement: FinanceContributionRow['view']['agreement']): ReceiptRail | null {
	if (!agreement) return null;
	if (agreement.state !== 'cash_pending' && agreement.state !== 'cash_recorded') return null;
	if (agreement.rail === 'cash' || agreement.rail === 'check') return agreement.rail;
	return null;
}

function serializeRows(rows: FinanceContributionRow[], nextOperationId: () => string) {
	return rows.flatMap((row) => {
		const agreement = row.view.agreement;
		const rail = cashCheckRail(agreement);
		if (!agreement || !rail) return [];

		const reversedIds = new Set(
			row.view.receipts.map((receipt) => receipt.reversesId).filter((id): id is string => id !== null),
		);

		return [
			{
				personId: row.personId,
				displayName: row.displayName,
				state: agreement.state,
				rail,
				recordOperationId: nextOperationId(),
				receipts: row.view.receipts.map((receipt) => {
					const correctable = receipt.reversesId === null && !reversedIds.has(receipt.id);
					return {
						id: receipt.id,
						rail: receipt.rail,
						amountCents: receipt.amountCents,
						receivedOn: receipt.receivedOn,
						cadence: receipt.cadence,
						recordedBy: receipt.recordedBy,
						note: receipt.note,
						checkRefLast4: receipt.checkRefLast4,
						reversesId: receipt.reversesId,
						createdAt: receipt.createdAt.toISOString(),
						correctable,
						correctOperationId: correctable ? nextOperationId() : null,
					};
				}),
			},
		];
	});
}

function mapActionError(error: unknown, operation: 'record' | 'correct') {
	if (error instanceof AuthError) return fail(error.status, { code: error.code });
	if (error instanceof CashCheckAgreementRequiredError) {
		return fail(400, { code: 'cash_check_agreement_required' as const });
	}
	if (error instanceof ReceiptValidationError) {
		return fail(400, { code: 'invalid_receipt' as const });
	}
	if (error instanceof IdempotencyConflictError) {
		return fail(409, { code: 'idempotency_conflict' as const });
	}
	console.error('[finance/receipts] unexpected ' + operation + ' failure');
	return fail(500, { code: 'finance_write_failed' as const });
}

export function _createReceiptEntryLoad(seams: ReceiptEntrySeams = {}) {
	const env = seams.env ?? process.env;
	const nextOperationId = seams.operationId ?? randomUUID;

	return async (event: RequestEvent) => {
		const actor = resolveFinanceActor(event);
		if (!actor) {
			throw httpError(401, 'This page requires a signed-in finance session.');
		}

		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, rows: [] };
		}

		try {
			const rows = await withTenant(tenantId, (tx) => listFinanceContributions(tx, actor.personId));
			return { available: true as const, rows: serializeRows(rows, nextOperationId) };
		} catch (error) {
			if (error instanceof AuthError) throw httpError(error.status, error.message);
			console.error('[finance/receipts] unexpected load failure');
			throw httpError(500, 'Finance receipt entry failed.');
		}
	};
}

export function _createRecordAction(seams: ReceiptEntrySeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const actor = resolveFinanceActor(event);
		if (!actor) return fail(401, { code: 'not_authenticated' as const });

		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return fail(503, { code: 'finance_write_unavailable' as const });
		}

		const form = await event.request.formData();
		const personId = uuidField(form, 'personId');
		const operationId = uuidField(form, 'operationId');
		const fields = receiptFields(form);

		try {
			const result = await withTenant(tenantId, async (tx) => {
				const scopedTenantId = await requireFinance(tx, actor.personId);
				if (!personId || !operationId || !fields) {
					throw new ReceiptValidationError('invalid receipt form');
				}

				const agreement = await getAgreement(tx, personId);
				const rail = cashCheckRail(agreement);
				if (!rail) throw new CashCheckAgreementRequiredError();

				return recordCashCheckReceipt(tx, {
					tenantId: scopedTenantId,
					personId,
					rail,
					amountCents: fields.amountCents,
					receivedOn: fields.receivedOn,
					cadence: fields.cadence,
					recordedBy: actor.personId,
					note: fields.note,
					checkRefLast4: rail === 'check' ? fields.checkRefLast4 : undefined,
					idempotencyKey: ['record', operationId].join(':'),
				});
			});

			return {
				recorded: true as const,
				receiptId: result.receipt.id,
				deduplicated: result.deduplicated,
			};
		} catch (error) {
			return mapActionError(error, 'record');
		}
	};
}

export function _createCorrectAction(seams: ReceiptEntrySeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const actor = resolveFinanceActor(event);
		if (!actor) return fail(401, { code: 'not_authenticated' as const });

		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return fail(503, { code: 'finance_write_unavailable' as const });
		}

		const form = await event.request.formData();
		const receiptId = uuidField(form, 'receiptId');
		const operationId = uuidField(form, 'operationId');
		const fields = receiptFields(form);
		const reversalNote = optionalTextField(form, 'reversalNote');

		try {
			const result = await withTenant(tenantId, async (tx) => {
				const scopedTenantId = await requireFinance(tx, actor.personId);
				if (!receiptId || !operationId || !fields) {
					throw new ReceiptValidationError('invalid correction form');
				}

				const reversal = await reverseReceipt(tx, {
					tenantId: scopedTenantId,
					receiptId,
					recordedBy: actor.personId,
					note: reversalNote,
					idempotencyKey: ['correct', operationId, 'reverse'].join(':'),
				});
				const personId = reversal.receipt.personId;
				const rail = reversal.receipt.rail;
				if (rail !== 'cash' && rail !== 'check') {
					throw new ReceiptValidationError('correction target is not cash or check');
				}

				const agreement = await getAgreement(tx, personId);
				if (!cashCheckRail(agreement)) throw new CashCheckAgreementRequiredError();

				const replacement = await recordCashCheckReceipt(tx, {
					tenantId: scopedTenantId,
					personId,
					rail,
					amountCents: fields.amountCents,
					receivedOn: fields.receivedOn,
					cadence: fields.cadence,
					recordedBy: actor.personId,
					note: fields.note,
					checkRefLast4: rail === 'check' ? fields.checkRefLast4 : undefined,
					idempotencyKey: ['correct', operationId, 'replacement'].join(':'),
				});

				return { reversal, replacement };
			});

			return {
				corrected: true as const,
				reversalId: result.reversal.receipt.id,
				replacementId: result.replacement.receipt.id,
				deduplicated: result.reversal.deduplicated && result.replacement.deduplicated,
			};
		} catch (error) {
			return mapActionError(error, 'correct');
		}
	};
}

export const load: PageServerLoad = _createReceiptEntryLoad();

export const actions = {
	record: _createRecordAction(),
	correct: _createCorrectAction(),
} satisfies Actions;
