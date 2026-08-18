import {
	canonicalInstant,
	defaultExpectedReturnAt,
	isCanonicalOpaqueToken,
	type AssetState,
	type CheckoutReceipt,
	type CustodyReceipt,
	type InventoryCustody,
	type LoanState,
	type OpenRepairCase,
	type QuarantineDisposition,
	type RepairCaseId,
	type ReturnReceipt,
} from './model';

export type InventoryConflictCode =
	| 'identity-conflict'
	| 'idempotency-conflict'
	| 'invalid-command'
	| 'receipt-conflict'
	| 'state-conflict'
	| 'version-conflict';

export interface InventoryConflict {
	readonly code: InventoryConflictCode;
	readonly message: string;
}

export interface TransitionSuccess {
	readonly ok: true;
	readonly custody: InventoryCustody;
	readonly receipt: CustodyReceipt;
	readonly replayed: boolean;
}

export interface TransitionFailure {
	readonly ok: false;
	/** The exact input aggregate; a conflict never creates ambiguous custody. */
	readonly custody: InventoryCustody;
	readonly conflict: InventoryConflict;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

interface VersionExpectation {
	readonly expectedAssetVersion: number;
	readonly expectedLoanVersion: number;
}

export interface FinalizeCheckoutCommand extends VersionExpectation {
	readonly kind: 'finalize-checkout';
	readonly receiptId: CheckoutReceipt['id'];
	readonly idempotencyKey: string;
	readonly checkedOutAt: string;
	readonly checkoutChecklistVersion: string;
}

interface FinalizeReturnBase extends VersionExpectation {
	readonly kind: 'finalize-return';
	readonly receiptId: ReturnReceipt['id'];
	readonly idempotencyKey: string;
	readonly returnedAt: string;
	readonly returnChecklistVersion: string;
}

export type FinalizeReturnCommand =
	| (FinalizeReturnBase & {
			readonly disposition: 'clean';
			readonly repairCaseId?: never;
	  })
	| (FinalizeReturnBase & {
			readonly disposition: QuarantineDisposition;
			readonly repairCaseId: RepairCaseId;
	  });

function failure(custody: InventoryCustody, code: InventoryConflictCode, message: string): TransitionFailure {
	return { ok: false, custody, conflict: { code, message } };
}

function receiptForKey(custody: InventoryCustody, key: string): CustodyReceipt | undefined {
	return custody.receipts.find((receipt) => receipt.idempotencyKey === key);
}

function commandConflict(
	custody: InventoryCustody,
	command: VersionExpectation & { readonly idempotencyKey: string; readonly receiptId: CustodyReceipt['id'] },
): TransitionFailure | undefined {
	if (!isCanonicalOpaqueToken(command.idempotencyKey)) {
		return failure(custody, 'invalid-command', 'idempotency key must be non-empty and canonical');
	}
	if (!isCanonicalOpaqueToken(command.receiptId)) {
		return failure(custody, 'invalid-command', 'receipt id must be non-empty and canonical');
	}
	if (
		!Number.isSafeInteger(command.expectedAssetVersion) ||
		command.expectedAssetVersion < 0 ||
		command.expectedAssetVersion >= Number.MAX_SAFE_INTEGER ||
		!Number.isSafeInteger(command.expectedLoanVersion) ||
		command.expectedLoanVersion < 0 ||
		command.expectedLoanVersion >= Number.MAX_SAFE_INTEGER
	) {
		return failure(custody, 'invalid-command', 'expected versions must be non-negative and safely incrementable');
	}
	if (custody.receipts.some((receipt) => receipt.id === command.receiptId)) {
		return failure(custody, 'receipt-conflict', 'receipt id was already used by another mutation');
	}
	return undefined;
}

function checkoutReplay(
	custody: InventoryCustody,
	command: FinalizeCheckoutCommand,
): TransitionSuccess | TransitionFailure | undefined {
	const receipt = receiptForKey(custody, command.idempotencyKey);
	if (!receipt) return undefined;
	if (
		receipt.kind !== 'checkout-finalized' ||
		receipt.id !== command.receiptId ||
		receipt.assetId !== custody.asset.id ||
		receipt.loanId !== custody.loan.id ||
		receipt.occurredAt !== command.checkedOutAt ||
		receipt.checkoutChecklistVersion !== command.checkoutChecklistVersion ||
		receipt.assetVersion - 1 !== command.expectedAssetVersion ||
		receipt.loanVersion - 1 !== command.expectedLoanVersion
	) {
		return failure(custody, 'idempotency-conflict', 'idempotency key was already used for another mutation');
	}
	return { ok: true, custody, receipt, replayed: true };
}

function returnReplay(
	custody: InventoryCustody,
	command: FinalizeReturnCommand,
): TransitionSuccess | TransitionFailure | undefined {
	const receipt = receiptForKey(custody, command.idempotencyKey);
	if (!receipt) return undefined;
	const repairCaseId = command.disposition === 'clean' ? null : command.repairCaseId;
	if (
		receipt.kind !== 'return-finalized' ||
		receipt.id !== command.receiptId ||
		receipt.assetId !== custody.asset.id ||
		receipt.loanId !== custody.loan.id ||
		receipt.occurredAt !== command.returnedAt ||
		receipt.disposition !== command.disposition ||
		receipt.returnChecklistVersion !== command.returnChecklistVersion ||
		receipt.repairCaseId !== repairCaseId ||
		receipt.assetVersion - 1 !== command.expectedAssetVersion ||
		receipt.loanVersion - 1 !== command.expectedLoanVersion
	) {
		return failure(custody, 'idempotency-conflict', 'idempotency key was already used for another mutation');
	}
	return { ok: true, custody, receipt, replayed: true };
}

function identityConflict(custody: InventoryCustody): TransitionFailure | undefined {
	if (custody.asset.id !== custody.loan.assetId) {
		return failure(custody, 'identity-conflict', 'loan does not belong to the scanned asset');
	}
	return undefined;
}

function versionConflict(custody: InventoryCustody, expectation: VersionExpectation): TransitionFailure | undefined {
	if (
		custody.asset.version !== expectation.expectedAssetVersion ||
		custody.loan.version !== expectation.expectedLoanVersion
	) {
		return failure(custody, 'version-conflict', 'asset or loan changed after it was scanned');
	}
	return undefined;
}

function stateConflict(
	custody: InventoryCustody,
	assetStates: readonly AssetState[],
	loanStates: readonly LoanState[],
): TransitionFailure | undefined {
	if (!assetStates.includes(custody.asset.state) || !loanStates.includes(custody.loan.state)) {
		return failure(custody, 'state-conflict', 'asset or loan is not in a state that permits this transition');
	}
	return undefined;
}

/**
 * Atomically-modelled checkout finalization. Persistence must lock the asset
 * and loan rows around this reducer; the expected versions make the loser of a
 * concurrent scan an explicit conflict rather than a second custody record.
 */
export function finalizeCheckout(custody: InventoryCustody, command: FinalizeCheckoutCommand): TransitionResult {
	const replay = checkoutReplay(custody, command);
	if (replay) return replay;
	let expectedReturnAt: string;
	try {
		expectedReturnAt = defaultExpectedReturnAt(command.checkedOutAt);
	} catch {
		return failure(custody, 'invalid-command', 'checkedOutAt must admit a canonical seven-day return window');
	}
	if (!isCanonicalOpaqueToken(command.checkoutChecklistVersion)) {
		return failure(custody, 'invalid-command', 'checkout checklist version must be non-empty and canonical');
	}
	const conflict =
		commandConflict(custody, command) ??
		identityConflict(custody) ??
		versionConflict(custody, command) ??
		stateConflict(custody, ['available'], ['draft']);
	if (conflict) return conflict;
	if (custody.openRepairCase) {
		return failure(custody, 'state-conflict', 'an asset with an open repair case cannot be checked out');
	}
	if (command.checkoutChecklistVersion !== custody.loan.checkoutChecklistVersion) {
		return failure(custody, 'state-conflict', 'checkout checklist version does not match the loan draft');
	}

	const assetVersion = custody.asset.version + 1;
	const loanVersion = custody.loan.version + 1;
	const receipt: CheckoutReceipt = {
		id: command.receiptId,
		idempotencyKey: command.idempotencyKey,
		kind: 'checkout-finalized',
		assetId: custody.asset.id,
		loanId: custody.loan.id,
		occurredAt: command.checkedOutAt,
		expectedReturnAt,
		checkoutChecklistVersion: command.checkoutChecklistVersion,
		assetVersion,
		loanVersion,
	};
	return {
		ok: true,
		replayed: false,
		receipt,
		custody: {
			asset: { ...custody.asset, state: 'checked_out', version: assetVersion },
			loan: {
				...custody.loan,
				state: 'active',
				version: loanVersion,
				checkedOutAt: command.checkedOutAt,
				expectedReturnAt,
				checkoutChecklistVersion: command.checkoutChecklistVersion,
			},
			openRepairCase: null,
			receipts: [...custody.receipts, receipt],
		},
	};
}

/** Close custody once, returning clean assets or quarantining every exception. */
export function finalizeReturn(custody: InventoryCustody, command: FinalizeReturnCommand): TransitionResult {
	const replay = returnReplay(custody, command);
	if (replay) return replay;
	try {
		canonicalInstant(command.returnedAt, 'returnedAt');
	} catch {
		return failure(custody, 'invalid-command', 'returnedAt must be a canonical UTC ISO-8601 timestamp');
	}
	if (!isCanonicalOpaqueToken(command.returnChecklistVersion)) {
		return failure(custody, 'invalid-command', 'return checklist version must be non-empty and canonical');
	}
	if (custody.loan.checkedOutAt === null || Date.parse(command.returnedAt) < Date.parse(custody.loan.checkedOutAt)) {
		return failure(custody, 'invalid-command', 'return cannot occur before checkout');
	}
	const conflict =
		commandConflict(custody, command) ??
		identityConflict(custody) ??
		versionConflict(custody, command) ??
		stateConflict(custody, ['checked_out'], ['active', 'overdue']);
	if (conflict) return conflict;
	if (custody.openRepairCase) {
		return failure(custody, 'state-conflict', 'return cannot replace an existing open repair case');
	}

	const assetVersion = custody.asset.version + 1;
	const loanVersion = custody.loan.version + 1;
	const repairCase: OpenRepairCase | null =
		command.disposition === 'clean'
			? null
			: {
					id: command.repairCaseId,
					assetId: custody.asset.id,
					loanId: custody.loan.id,
					state: 'open',
					disposition: command.disposition,
					openedAt: command.returnedAt,
				};
	const receipt: ReturnReceipt = {
		id: command.receiptId,
		idempotencyKey: command.idempotencyKey,
		kind: 'return-finalized',
		assetId: custody.asset.id,
		loanId: custody.loan.id,
		occurredAt: command.returnedAt,
		disposition: command.disposition,
		returnChecklistVersion: command.returnChecklistVersion,
		repairCaseId: repairCase?.id ?? null,
		assetVersion,
		loanVersion,
	};
	return {
		ok: true,
		replayed: false,
		receipt,
		custody: {
			asset: {
				...custody.asset,
				state: command.disposition === 'clean' ? 'available' : 'quarantined',
				version: assetVersion,
			},
			loan: {
				...custody.loan,
				state: 'returned',
				version: loanVersion,
				returnChecklistVersion: command.returnChecklistVersion,
				returnedAt: command.returnedAt,
			},
			openRepairCase: repairCase,
			receipts: [...custody.receipts, receipt],
		},
	};
}
