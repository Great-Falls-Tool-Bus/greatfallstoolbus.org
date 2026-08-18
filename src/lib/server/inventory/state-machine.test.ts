import { describe, expect, it } from 'vitest';
import {
	ASSET_STATES,
	DEFAULT_LOAN_DAYS,
	LOAN_STATES,
	RETURN_DISPOSITIONS,
	InventoryModelError,
	assetId,
	assetShortId,
	defaultExpectedReturnAt,
	legacyIdentifier,
	loanId,
	memberId,
	receiptId,
	repairCaseId,
	type InventoryCustody,
} from './model';
import { finalizeCheckout, finalizeReturn, type FinalizeCheckoutCommand } from './state-machine';

function draftCustody(): InventoryCustody {
	const id = assetId('asset-opaque-01');
	return {
		asset: {
			id,
			shortId: assetShortId('SEW-01'),
			legacyIdentifier: legacyIdentifier('B0-OPAQUE-LEGACY'),
			kind: null,
			ownerCustodyBasis: 'operator-recorded',
			state: 'available',
			version: 4,
			checklistVersion: 'sewing-v1',
			parentKitId: null,
		},
		loan: {
			id: loanId('loan-01'),
			assetId: id,
			memberId: memberId('member-01'),
			state: 'draft',
			version: 2,
			checkoutChecklistVersion: 'sewing-v1',
			returnChecklistVersion: null,
			checkedOutAt: null,
			expectedReturnAt: null,
			returnedAt: null,
		},
		openRepairCase: null,
		receipts: [],
	};
}

function checkoutCommand(overrides: Partial<FinalizeCheckoutCommand> = {}): FinalizeCheckoutCommand {
	return {
		kind: 'finalize-checkout',
		receiptId: receiptId('receipt-checkout-01'),
		idempotencyKey: 'checkout-device-a',
		checkedOutAt: '2026-09-15T14:00:00.000Z',
		checkoutChecklistVersion: 'sewing-v1',
		expectedAssetVersion: 4,
		expectedLoanVersion: 2,
		...overrides,
	};
}

function checkedOutCustody(): InventoryCustody {
	const result = finalizeCheckout(draftCustody(), checkoutCommand());
	if (!result.ok) throw new Error(result.conflict.message);
	return result.custody;
}

describe('ratified inventory vocabulary', () => {
	it('keeps the exact asset, loan, and return state sets', () => {
		expect(ASSET_STATES).toEqual(['available', 'checked_out', 'repair', 'quarantined', 'retired']);
		expect(LOAN_STATES).toEqual(['draft', 'active', 'overdue', 'returned', 'cancelled']);
		expect(RETURN_DISPOSITIONS).toEqual(['clean', 'needs-repair', 'missing-content', 'damage']);
	});

	it('preserves an unknown legacy identifier without inferring a product', () => {
		const custody = draftCustody();
		expect(custody.asset.legacyIdentifier).toBe('B0-OPAQUE-LEGACY');
		expect(custody.asset.kind).toBeNull();
	});

	it('rejects normalization-prone identifiers instead of guessing', () => {
		expect(() => assetId(' asset-01')).toThrow(InventoryModelError);
		expect(() => assetShortId('')).toThrow(InventoryModelError);
		expect(() => legacyIdentifier('legacy\n01')).toThrow(InventoryModelError);
	});

	it('derives the seven-day default from the injected checkout time', () => {
		expect(DEFAULT_LOAN_DAYS).toBe(7);
		expect(defaultExpectedReturnAt('2026-09-15T14:00:00.000Z')).toBe('2026-09-22T14:00:00.000Z');
		expect(defaultExpectedReturnAt('+275760-09-06T00:00:00.000Z')).toBe('+275760-09-13T00:00:00.000Z');
		expect(() => defaultExpectedReturnAt('+275760-09-13T00:00:00.000Z')).toThrow(InventoryModelError);
		expect(() => defaultExpectedReturnAt('not-a-time')).toThrow(InventoryModelError);
		expect(() => defaultExpectedReturnAt('2026-09-15')).toThrow(InventoryModelError);
		expect(() => defaultExpectedReturnAt('2026-09-15T10:00:00-04:00')).toThrow(InventoryModelError);
	});
});

describe('finalizeCheckout', () => {
	it('commits custody and one receipt without mutating the draft', () => {
		const before = draftCustody();
		const snapshot = structuredClone(before);
		const result = finalizeCheckout(before, checkoutCommand());

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.replayed).toBe(false);
		expect(result.custody.asset).toMatchObject({ state: 'checked_out', version: 5 });
		expect(result.custody.loan).toMatchObject({
			state: 'active',
			version: 3,
			checkedOutAt: '2026-09-15T14:00:00.000Z',
			expectedReturnAt: '2026-09-22T14:00:00.000Z',
			checkoutChecklistVersion: 'sewing-v1',
		});
		expect(result.receipt).toMatchObject({ checkoutChecklistVersion: 'sewing-v1' });
		expect(result.custody.receipts).toEqual([result.receipt]);
		expect(before).toEqual(snapshot);
	});

	it('returns the original result for an exact idempotent replay', () => {
		const first = finalizeCheckout(draftCustody(), checkoutCommand());
		if (!first.ok) throw new Error(first.conflict.message);
		const replay = finalizeCheckout(first.custody, checkoutCommand());

		expect(replay.ok).toBe(true);
		if (!replay.ok) return;
		expect(replay.replayed).toBe(true);
		expect(replay.custody).toBe(first.custody);
		expect(replay.receipt).toBe(first.receipt);
		expect(replay.custody.receipts).toHaveLength(1);
		expect(finalizeCheckout(first.custody, checkoutCommand({ expectedAssetVersion: 5 }))).toMatchObject({
			ok: false,
			conflict: { code: 'idempotency-conflict' },
		});
		expect(
			finalizeCheckout(first.custody, checkoutCommand({ checkoutChecklistVersion: 'sewing-v2' })),
		).toMatchObject({
			ok: false,
			conflict: { code: 'idempotency-conflict' },
		});
	});

	it('requires the completed checklist version to match the loan draft', () => {
		const custody = draftCustody();
		const result = finalizeCheckout(custody, checkoutCommand({ checkoutChecklistVersion: 'sewing-v2' }));

		expect(result).toMatchObject({ ok: false, conflict: { code: 'state-conflict' } });
		if (!result.ok) expect(result.custody).toBe(custody);
	});

	it('rejects a noncanonical checkout checklist version', () => {
		expect(
			finalizeCheckout(draftCustody(), checkoutCommand({ checkoutChecklistVersion: ' sewing-v1' })),
		).toMatchObject({ ok: false, conflict: { code: 'invalid-command' } });
	});

	it('makes the second concurrent finalization an explicit conflict', () => {
		const first = finalizeCheckout(draftCustody(), checkoutCommand());
		if (!first.ok) throw new Error(first.conflict.message);
		const secondDevice = checkoutCommand({
			receiptId: receiptId('receipt-checkout-02'),
			idempotencyKey: 'checkout-device-b',
		});
		const loser = finalizeCheckout(first.custody, secondDevice);

		expect(loser).toMatchObject({ ok: false, conflict: { code: 'version-conflict' } });
		if (loser.ok) return;
		expect(loser.custody).toBe(first.custody);
		expect(loser.custody.receipts).toHaveLength(1);
	});

	it('rejects reuse of an idempotency key for a different mutation', () => {
		const first = finalizeCheckout(draftCustody(), checkoutCommand());
		if (!first.ok) throw new Error(first.conflict.message);
		const reused = finalizeCheckout(first.custody, checkoutCommand({ receiptId: receiptId('different-receipt') }));
		expect(reused).toMatchObject({ ok: false, conflict: { code: 'idempotency-conflict' } });
	});

	it('rejects a receipt id collision even under a fresh idempotency key', () => {
		const first = finalizeCheckout(draftCustody(), checkoutCommand());
		if (!first.ok) throw new Error(first.conflict.message);
		const collision = finalizeCheckout(
			first.custody,
			checkoutCommand({ idempotencyKey: 'fresh-key', expectedAssetVersion: 5, expectedLoanVersion: 3 }),
		);
		expect(collision).toMatchObject({ ok: false, conflict: { code: 'receipt-conflict' } });
	});

	it.each(['', ' checkout-device-a', 'checkout\ndevice-a'])(
		'rejects a noncanonical idempotency key %j',
		(idempotencyKey) => {
			expect(finalizeCheckout(draftCustody(), checkoutCommand({ idempotencyKey }))).toMatchObject({
				ok: false,
				conflict: { code: 'invalid-command' },
			});
		},
	);

	it('rejects a noncanonical checkout timestamp', () => {
		expect(finalizeCheckout(draftCustody(), checkoutCommand({ checkedOutAt: '2026-09-15' }))).toMatchObject({
			ok: false,
			conflict: { code: 'invalid-command' },
		});
	});

	it('returns invalid-command when the seven-day default crosses the maximum JS instant', () => {
		expect(
			finalizeCheckout(draftCustody(), checkoutCommand({ checkedOutAt: '+275760-09-13T00:00:00.000Z' })),
		).toMatchObject({ ok: false, conflict: { code: 'invalid-command' } });
	});

	it('rejects an expectation whose successful increment would be unsafe', () => {
		expect(
			finalizeCheckout(draftCustody(), checkoutCommand({ expectedAssetVersion: Number.MAX_SAFE_INTEGER })),
		).toMatchObject({ ok: false, conflict: { code: 'invalid-command' } });
	});

	it('refuses a loan attached to a different scanned asset', () => {
		const custody = draftCustody();
		const mismatched: InventoryCustody = {
			...custody,
			loan: { ...custody.loan, assetId: assetId('asset-other') },
		};
		expect(finalizeCheckout(mismatched, checkoutCommand())).toMatchObject({
			ok: false,
			conflict: { code: 'identity-conflict' },
		});
	});
});

describe('finalizeReturn', () => {
	it('appends one return receipt without mutating the checked-out custody', () => {
		const custody = checkedOutCustody();
		const snapshot = structuredClone(custody);
		const result = finalizeReturn(custody, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-return-immutable'),
			idempotencyKey: 'return-immutable',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(custody).toEqual(snapshot);
		expect(result.custody.receipts).toEqual([...custody.receipts, result.receipt]);
		expect(result.custody.receipts.filter((receipt) => receipt.kind === 'return-finalized')).toHaveLength(1);
	});

	it('makes only a clean return available and closes the loan', () => {
		const custody = checkedOutCustody();
		const result = finalizeReturn(custody, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-return-clean'),
			idempotencyKey: 'return-clean',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.custody.asset).toMatchObject({ state: 'available', version: 6 });
		expect(result.custody.loan).toMatchObject({ state: 'returned', version: 4 });
		expect(result.custody.openRepairCase).toBeNull();
		expect(result.receipt).toMatchObject({ disposition: 'clean', repairCaseId: null });
	});

	it.each(['needs-repair', 'missing-content', 'damage'] as const)(
		'quarantines a %s return and opens a repair case',
		(disposition) => {
			const custody = checkedOutCustody();
			const caseId = repairCaseId(`case-${disposition}`);
			const result = finalizeReturn(custody, {
				kind: 'finalize-return',
				receiptId: receiptId(`receipt-return-${disposition}`),
				idempotencyKey: `return-${disposition}`,
				returnedAt: '2026-09-18T15:00:00.000Z',
				returnChecklistVersion: 'sewing-v1',
				disposition,
				repairCaseId: caseId,
				expectedAssetVersion: 5,
				expectedLoanVersion: 3,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.custody.asset.state).toBe('quarantined');
			expect(result.custody.loan.state).toBe('returned');
			expect(result.custody.openRepairCase).toEqual({
				id: caseId,
				assetId: custody.asset.id,
				loanId: custody.loan.id,
				state: 'open',
				disposition,
				openedAt: '2026-09-18T15:00:00.000Z',
			});
			const serialized = JSON.stringify(result.custody);
			expect(serialized).not.toMatch(/charge|amount|payment/i);
		},
	);

	it('allows an overdue loan to return through the same transition', () => {
		const active = checkedOutCustody();
		const overdue: InventoryCustody = { ...active, loan: { ...active.loan, state: 'overdue' } };
		const result = finalizeReturn(overdue, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-overdue-return'),
			idempotencyKey: 'return-overdue',
			returnedAt: '2026-09-23T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		});
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.custody.loan.state).toBe('returned');
	});

	it('rejects a return before checkout and a noncanonical return timestamp', () => {
		const custody = checkedOutCustody();
		const command = {
			kind: 'finalize-return' as const,
			receiptId: receiptId('receipt-invalid-return'),
			idempotencyKey: 'return-invalid',
			returnedAt: '2026-09-14T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean' as const,
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		};
		expect(finalizeReturn(custody, command)).toMatchObject({
			ok: false,
			conflict: { code: 'invalid-command' },
		});
		expect(finalizeReturn(custody, { ...command, returnedAt: '2026-09-18' })).toMatchObject({
			ok: false,
			conflict: { code: 'invalid-command' },
		});
	});

	it('binds return checklist semantics into an idempotent replay', () => {
		const custody = checkedOutCustody();
		const command = {
			kind: 'finalize-return' as const,
			receiptId: receiptId('receipt-return-replay'),
			idempotencyKey: 'return-replay',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean' as const,
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		};
		const first = finalizeReturn(custody, command);
		if (!first.ok) throw new Error(first.conflict.message);
		const exactReplay = finalizeReturn(first.custody, command);
		expect(exactReplay).toMatchObject({ ok: true, replayed: true });
		const changedChecklist = finalizeReturn(first.custody, {
			...command,
			returnChecklistVersion: 'sewing-v2',
		});
		expect(changedChecklist).toMatchObject({
			ok: false,
			conflict: { code: 'idempotency-conflict' },
		});
		const changedExpectation = finalizeReturn(first.custody, {
			...command,
			expectedLoanVersion: 4,
		});
		expect(changedExpectation).toMatchObject({
			ok: false,
			conflict: { code: 'idempotency-conflict' },
		});
	});

	it('replays an exact non-clean return and rejects a changed repair case', () => {
		const custody = checkedOutCustody();
		const command = {
			kind: 'finalize-return' as const,
			receiptId: receiptId('receipt-return-repair-replay'),
			idempotencyKey: 'return-repair-replay',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'damage' as const,
			repairCaseId: repairCaseId('case-damage-a'),
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		};
		const first = finalizeReturn(custody, command);
		if (!first.ok) throw new Error(first.conflict.message);

		const exactReplay = finalizeReturn(first.custody, command);
		expect(exactReplay).toMatchObject({ ok: true, replayed: true });
		if (exactReplay.ok) {
			expect(exactReplay.custody).toBe(first.custody);
			expect(exactReplay.receipt).toBe(first.receipt);
			expect(exactReplay.custody.receipts).toHaveLength(custody.receipts.length + 1);
		}
		expect(
			finalizeReturn(first.custody, { ...command, repairCaseId: repairCaseId('case-damage-b') }),
		).toMatchObject({ ok: false, conflict: { code: 'idempotency-conflict' } });
	});

	it('makes a fresh-key concurrent return an unchanged version-conflict loser', () => {
		const custody = checkedOutCustody();
		const first = finalizeReturn(custody, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-return-device-a'),
			idempotencyKey: 'return-device-a',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		});
		if (!first.ok) throw new Error(first.conflict.message);

		const loser = finalizeReturn(first.custody, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-return-device-b'),
			idempotencyKey: 'return-device-b',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 5,
			expectedLoanVersion: 3,
		});

		expect(loser).toMatchObject({ ok: false, conflict: { code: 'version-conflict' } });
		if (loser.ok) return;
		expect(loser.custody).toBe(first.custody);
		expect(loser.custody.receipts).toHaveLength(custody.receipts.length + 1);
	});

	it('keeps custody byte-for-byte unchanged after a stale return', () => {
		const custody = checkedOutCustody();
		const before = JSON.stringify(custody);
		const result = finalizeReturn(custody, {
			kind: 'finalize-return',
			receiptId: receiptId('receipt-stale-return'),
			idempotencyKey: 'return-stale',
			returnedAt: '2026-09-18T15:00:00.000Z',
			returnChecklistVersion: 'sewing-v1',
			disposition: 'clean',
			expectedAssetVersion: 4,
			expectedLoanVersion: 3,
		});
		expect(result).toMatchObject({ ok: false, conflict: { code: 'version-conflict' } });
		expect(JSON.stringify(result.custody)).toBe(before);
	});
});
