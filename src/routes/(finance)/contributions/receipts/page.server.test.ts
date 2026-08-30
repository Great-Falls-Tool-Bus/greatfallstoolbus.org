/**
 * CI-visible contract for the TIN-3818 cash/check finance-write route.
 * Database append-only and idempotency behavior remains covered by the
 * existing PostgreSQL integration suite; this file pins HTTP composition,
 * live finance authorization, server-owned authority fields, and correction
 * transaction ordering in the ordinary unit/Flywheel lane.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	callOrder: [] as string[],
	tx: { marker: 'same-transaction' },
	withTenant: vi.fn(),
	requireFinance: vi.fn(),
	listFinanceContributions: vi.fn(),
	getAgreement: vi.fn(),
	recordCashCheckReceipt: vi.fn(),
	reverseReceipt: vi.fn(),
}));

vi.mock('$lib/server/db/tenant', () => ({
	withTenant: mocks.withTenant,
}));

vi.mock('$lib/server/contribution/finance-read', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/contribution/finance-read')>();
	return {
		...actual,
		requireFinance: mocks.requireFinance,
		listFinanceContributions: mocks.listFinanceContributions,
	};
});

vi.mock('$lib/server/contribution/agreement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/contribution/agreement')>();
	return { ...actual, getAgreement: mocks.getAgreement };
});

vi.mock('$lib/server/contribution/receipt', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/contribution/receipt')>();
	return {
		...actual,
		recordCashCheckReceipt: mocks.recordCashCheckReceipt,
		reverseReceipt: mocks.reverseReceipt,
	};
});

import { AuthError } from '$lib/server/auth';
import { IdempotencyConflictError, ReceiptValidationError } from '$lib/server/contribution/receipt';
import * as readRoute from '../+page.server';
import * as route from './+page.server';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const FINANCE_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const ORIGINAL_ID = '44444444-4444-4444-8444-444444444444';
const REVERSAL_ID = '55555555-5555-4555-8555-555555555555';
const REPLACEMENT_ID = '66666666-6666-4666-8666-666666666666';
const OPERATION_ID = '77777777-7777-4777-8777-777777777777';

const CONFIGURED_ENV = {
	GFTB_TENANT_ID: TENANT_ID,
	DATABASE_URL: 'postgres://unused',
} as NodeJS.ProcessEnv;

function receipt(overrides: Record<string, unknown> = {}) {
	return {
		id: ORIGINAL_ID,
		tenantId: TENANT_ID,
		personId: MEMBER_ID,
		rail: 'cash',
		amountCents: 1200,
		receivedOn: '2026-08-30',
		cadence: 'one_time',
		recordedBy: FINANCE_ID,
		note: null,
		checkRefLast4: null,
		reversesId: null,
		idempotencyKey: 'existing',
		createdAt: new Date('2026-08-30T12:00:00.000Z'),
		...overrides,
	};
}

function event(fields: Record<string, string>, personId: string | null = FINANCE_ID): RequestEvent {
	const url = new URL('http://localhost/contributions/receipts');
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields),
		}),
		locals: { authSession: personId ? { userId: personId } : null },
		url,
	} as unknown as RequestEvent;
}

const RECORD_FORM = {
	personId: MEMBER_ID,
	operationId: OPERATION_ID,
	amountCents: '1200',
	receivedOn: '2026-08-30',
	cadence: 'one_time',
	note: 'front desk',
};

const CORRECT_FORM = {
	receiptId: ORIGINAL_ID,
	operationId: OPERATION_ID,
	amountCents: '1000',
	receivedOn: '2026-08-30',
	cadence: 'one_time',
	note: 'corrected amount',
	reversalNote: 'entry correction',
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callOrder.length = 0;
	mocks.withTenant.mockImplementation(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn(mocks.tx));
	mocks.requireFinance.mockImplementation(async () => {
		mocks.callOrder.push('finance');
		return TENANT_ID;
	});
	mocks.listFinanceContributions.mockResolvedValue([]);
	mocks.getAgreement.mockImplementation(async () => {
		mocks.callOrder.push('agreement');
		return { personId: MEMBER_ID, state: 'cash_pending', rail: 'cash' };
	});
	mocks.recordCashCheckReceipt.mockImplementation(async (_tx: unknown, input: Record<string, unknown>) => {
		mocks.callOrder.push('record');
		return {
			receipt: receipt({
				id: input.reversesId ? REVERSAL_ID : REPLACEMENT_ID,
				...input,
			}),
			deduplicated: false,
		};
	});
	mocks.reverseReceipt.mockImplementation(async () => {
		mocks.callOrder.push('reverse');
		return {
			receipt: receipt({ id: REVERSAL_ID, reversesId: ORIGINAL_ID }),
			deduplicated: false,
		};
	});
});

describe('/contributions/receipts route surface', () => {
	it('exports only the two named actions, factories, load, and prerender', () => {
		expect(Object.keys(route).sort()).toEqual([
			'_createCorrectAction',
			'_createReceiptEntryLoad',
			'_createRecordAction',
			'actions',
			'load',
			'prerender',
		]);
		expect(Object.keys(route.actions).sort()).toEqual(['correct', 'record']);
		expect(route.prerender).toBe(false);
	});

	it('does not add actions to the existing read-only /contributions route', () => {
		expect(Object.keys(readRoute).sort()).toEqual(['_createFinanceLoad', 'load', 'prerender']);
	});

	it('has no payment-processor, fresh-reauthentication, direct update, or direct delete path', () => {
		const source = readFileSync(fileURLToPath(new URL('./+page.server.ts', import.meta.url)), 'utf8');
		expect(source).not.toMatch(/(?:from\s+|import\s*\(\s*)['"][^'"]*\/stripe(?:\/|['"])/i);
		expect(source).not.toMatch(/\b(?:reauthenticate|verifyPassword|SESSION_COOKIE)\b/);
		expect(source).not.toMatch(/\.\s*(?:update|delete)\s*\(/);
	});
});

describe('authentication and availability ordering', () => {
	it('anonymous load and POST return 401 before unconfigured env can disclose another shape', async () => {
		const load = route._createReceiptEntryLoad({ env: {} });
		await expect(load(event({}, null))).rejects.toMatchObject({ status: 401 });

		const record = route._createRecordAction({ env: {} });
		const correct = route._createCorrectAction({ env: {} });
		await expect(record(event(RECORD_FORM, null))).resolves.toMatchObject({
			status: 401,
			data: { code: 'not_authenticated' },
		});
		await expect(correct(event(CORRECT_FORM, null))).resolves.toMatchObject({
			status: 401,
			data: { code: 'not_authenticated' },
		});
		expect(mocks.withTenant).not.toHaveBeenCalled();
	});

	it('an authenticated actor sees 503 when the runtime is unconfigured', async () => {
		const record = route._createRecordAction({ env: {} });
		await expect(record(event(RECORD_FORM))).resolves.toMatchObject({
			status: 503,
			data: { code: 'finance_write_unavailable' },
		});
		expect(mocks.withTenant).not.toHaveBeenCalled();
	});

	it('a non-finance session is 403 and neither write is reachable', async () => {
		mocks.requireFinance.mockRejectedValueOnce(
			new AuthError(403, 'not_finance', 'This action requires a live finance grant.'),
		);
		const action = route._createRecordAction({ env: CONFIGURED_ENV });
		await expect(action(event(RECORD_FORM))).resolves.toMatchObject({
			status: 403,
			data: { code: 'not_finance' },
		});
		expect(mocks.getAgreement).not.toHaveBeenCalled();
		expect(mocks.recordCashCheckReceipt).not.toHaveBeenCalled();
		expect(mocks.reverseReceipt).not.toHaveBeenCalled();
	});
});

describe('record action authority and idempotency', () => {
	it('checks finance first in the same transaction and binds tenant, rail, and recorder server-side', async () => {
		mocks.getAgreement.mockImplementationOnce(async () => {
			mocks.callOrder.push('agreement');
			return { personId: MEMBER_ID, state: 'cash_recorded', rail: 'check' };
		});
		const action = route._createRecordAction({ env: CONFIGURED_ENV });
		const result = await action(
			event({
				...RECORD_FORM,
				tenantId: 'attacker-tenant',
				rail: 'stripe',
				recordedBy: 'attacker-recorder',
				checkRefLast4: '1234',
			}),
		);

		expect(result).toMatchObject({ recorded: true, receiptId: REPLACEMENT_ID, deduplicated: false });
		expect(mocks.withTenant).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
		expect(mocks.requireFinance).toHaveBeenCalledWith(mocks.tx, FINANCE_ID);
		expect(mocks.getAgreement).toHaveBeenCalledWith(mocks.tx, MEMBER_ID);
		expect(mocks.recordCashCheckReceipt).toHaveBeenCalledWith(
			mocks.tx,
			expect.objectContaining({
				tenantId: TENANT_ID,
				personId: MEMBER_ID,
				rail: 'check',
				recordedBy: FINANCE_ID,
				amountCents: 1200,
				receivedOn: '2026-08-30',
				cadence: 'one_time',
				note: 'front desk',
				checkRefLast4: '1234',
				idempotencyKey: 'record:' + OPERATION_ID,
			}),
		);
		expect(mocks.callOrder).toEqual(['finance', 'agreement', 'record']);

		const input = mocks.recordCashCheckReceipt.mock.calls[0][1] as Record<string, unknown>;
		expect(input).not.toHaveProperty('attacker-tenant');
		expect(input.tenantId).not.toBe('attacker-tenant');
		expect(input.rail).not.toBe('stripe');
		expect(input.recordedBy).not.toBe('attacker-recorder');
	});

	it.each([
		['missing', undefined],
		['Stripe', { state: 'stripe_pending', rail: 'stripe' }],
		['zero', { state: 'zero', rail: 'zero' }],
	])('refuses a %s standing agreement before a receipt write', async (_label, agreement) => {
		mocks.getAgreement.mockResolvedValueOnce(agreement);
		const action = route._createRecordAction({ env: CONFIGURED_ENV });
		await expect(action(event(RECORD_FORM))).resolves.toMatchObject({
			status: 400,
			data: { code: 'cash_check_agreement_required' },
		});
		expect(mocks.recordCashCheckReceipt).not.toHaveBeenCalled();
	});

	it('reuses the server-rendered operation id so a replay reaches the domain with the same key', async () => {
		mocks.recordCashCheckReceipt
			.mockResolvedValueOnce({ receipt: receipt({ id: REPLACEMENT_ID }), deduplicated: false })
			.mockResolvedValueOnce({ receipt: receipt({ id: REPLACEMENT_ID }), deduplicated: true });
		const action = route._createRecordAction({ env: CONFIGURED_ENV });
		await expect(action(event(RECORD_FORM))).resolves.toMatchObject({ recorded: true, deduplicated: false });
		await expect(action(event(RECORD_FORM))).resolves.toMatchObject({ recorded: true, deduplicated: true });

		const keys = mocks.recordCashCheckReceipt.mock.calls.map((call) => call[1].idempotencyKey);
		expect(keys).toEqual(['record:' + OPERATION_ID, 'record:' + OPERATION_ID]);
	});

	it.each([
		[new ReceiptValidationError('bad receipt'), 400, 'invalid_receipt'],
		[new IdempotencyConflictError('different payload'), 409, 'idempotency_conflict'],
	])('maps a domain refusal without echoing its message', async (domainError, status, code) => {
		mocks.recordCashCheckReceipt.mockRejectedValueOnce(domainError);
		const action = route._createRecordAction({ env: CONFIGURED_ENV });
		const result = await action(event(RECORD_FORM));
		expect(result).toMatchObject({ status, data: { code } });
		expect(JSON.stringify(result)).not.toContain(domainError.message);
	});
});

describe('correct action append-only composition', () => {
	it(
		'runs reversal then replacement in one transaction with stable distinct keys and server-derived identity',
		async () => {
			const action = route._createCorrectAction({ env: CONFIGURED_ENV });
			const malicious = {
				...CORRECT_FORM,
				personId: '88888888-8888-4888-8888-888888888888',
				tenantId: 'attacker-tenant',
				rail: 'stripe',
				recordedBy: 'attacker-recorder',
			};

			await expect(action(event(malicious))).resolves.toMatchObject({
				corrected: true,
				reversalId: REVERSAL_ID,
				replacementId: REPLACEMENT_ID,
				deduplicated: false,
			});

			expect(mocks.requireFinance).toHaveBeenCalledWith(mocks.tx, FINANCE_ID);
			expect(mocks.reverseReceipt).toHaveBeenCalledWith(mocks.tx, {
				tenantId: TENANT_ID,
				receiptId: ORIGINAL_ID,
				recordedBy: FINANCE_ID,
				note: 'entry correction',
				idempotencyKey: 'correct:' + OPERATION_ID + ':reverse',
			});
			expect(mocks.getAgreement).toHaveBeenCalledWith(mocks.tx, MEMBER_ID);
			expect(mocks.recordCashCheckReceipt).toHaveBeenCalledWith(
				mocks.tx,
				expect.objectContaining({
					tenantId: TENANT_ID,
					personId: MEMBER_ID,
					rail: 'cash',
					recordedBy: FINANCE_ID,
					idempotencyKey: 'correct:' + OPERATION_ID + ':replacement',
				}),
			);
			expect(mocks.callOrder).toEqual(['finance', 'reverse', 'agreement', 'record']);
		},
	);

	it('keeps both correction keys stable on replay and reports domain deduplication', async () => {
		mocks.reverseReceipt
			.mockResolvedValueOnce({
				receipt: receipt({ id: REVERSAL_ID, reversesId: ORIGINAL_ID }),
				deduplicated: false,
			})
			.mockResolvedValueOnce({
				receipt: receipt({ id: REVERSAL_ID, reversesId: ORIGINAL_ID }),
				deduplicated: true,
			});
		mocks.recordCashCheckReceipt
			.mockResolvedValueOnce({ receipt: receipt({ id: REPLACEMENT_ID }), deduplicated: false })
			.mockResolvedValueOnce({ receipt: receipt({ id: REPLACEMENT_ID }), deduplicated: true });

		const action = route._createCorrectAction({ env: CONFIGURED_ENV });
		await expect(action(event(CORRECT_FORM))).resolves.toMatchObject({ corrected: true, deduplicated: false });
		await expect(action(event(CORRECT_FORM))).resolves.toMatchObject({ corrected: true, deduplicated: true });

		expect(mocks.reverseReceipt.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
			'correct:' + OPERATION_ID + ':reverse',
			'correct:' + OPERATION_ID + ':reverse',
		]);
		expect(mocks.recordCashCheckReceipt.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
			'correct:' + OPERATION_ID + ':replacement',
			'correct:' + OPERATION_ID + ':replacement',
		]);
	});

	it('lets replacement failure escape the transaction callback before mapping it to a 400', async () => {
		const domainError = new ReceiptValidationError('replacement rejected');
		let escaped: unknown;
		mocks.withTenant.mockImplementationOnce(async (_tenantId: string, fn: (tx: unknown) => unknown) => {
			try {
				return await fn(mocks.tx);
			} catch (error) {
				escaped = error;
				throw error;
			}
		});
		mocks.recordCashCheckReceipt.mockRejectedValueOnce(domainError);

		const action = route._createCorrectAction({ env: CONFIGURED_ENV });
		await expect(action(event(CORRECT_FORM))).resolves.toMatchObject({
			status: 400,
			data: { code: 'invalid_receipt' },
		});
		expect(escaped).toBe(domainError);
		expect(mocks.callOrder).toEqual(['finance', 'reverse', 'agreement', 'record']);
	});
});

describe('load serialization', () => {
	it('uses the guarded listing in one tenant transaction and emits one operation id per form', async () => {
		mocks.listFinanceContributions.mockResolvedValueOnce([
			{
				personId: MEMBER_ID,
				displayName: 'Member One',
				view: {
					agreement: { personId: MEMBER_ID, state: 'cash_pending', rail: 'cash' },
					receipts: [receipt()],
				},
				netReceiptsCents: 1200,
			},
			{
				personId: '99999999-9999-4999-8999-999999999999',
				displayName: 'Card Member',
				view: {
					agreement: { state: 'stripe_pending', rail: 'stripe' },
					receipts: [],
				},
				netReceiptsCents: 0,
			},
		]);
		const ids = [
			'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		];
		const load = route._createReceiptEntryLoad({
			env: CONFIGURED_ENV,
			operationId: () => ids.shift() ?? OPERATION_ID,
		});
		const result = await load(event({}));

		expect(mocks.withTenant).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
		expect(mocks.listFinanceContributions).toHaveBeenCalledWith(mocks.tx, FINANCE_ID);
		expect(result).toMatchObject({
			available: true,
			rows: [
				{
					personId: MEMBER_ID,
					rail: 'cash',
					recordOperationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
					receipts: [
						{
							id: ORIGINAL_ID,
							correctable: true,
							correctOperationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
						},
					],
				},
			],
		});
	});
});
