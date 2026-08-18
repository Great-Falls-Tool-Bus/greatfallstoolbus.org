/**
 * Pure inventory/custody contract for the bounded sewing-cell pilot (TIN-3814).
 *
 * Identifiers are deliberately opaque. In particular, a legacy identifier is
 * never parsed or translated into a product name here; only the operator may
 * supply that mapping during intake.
 */

declare const assetIdBrand: unique symbol;
declare const assetShortIdBrand: unique symbol;
declare const legacyIdentifierBrand: unique symbol;
declare const loanIdBrand: unique symbol;
declare const memberIdBrand: unique symbol;
declare const receiptIdBrand: unique symbol;
declare const repairCaseIdBrand: unique symbol;

export type AssetId = string & { readonly [assetIdBrand]: true };
export type AssetShortId = string & { readonly [assetShortIdBrand]: true };
export type LegacyIdentifier = string & { readonly [legacyIdentifierBrand]: true };
export type LoanId = string & { readonly [loanIdBrand]: true };
export type MemberId = string & { readonly [memberIdBrand]: true };
export type ReceiptId = string & { readonly [receiptIdBrand]: true };
export type RepairCaseId = string & { readonly [repairCaseIdBrand]: true };

export function isCanonicalOpaqueToken(value: string): boolean {
	return value.length > 0 && value === value.trim() && !/\p{Cc}/u.test(value);
}

function opaqueIdentifier(value: string, field: string): string {
	if (!isCanonicalOpaqueToken(value)) {
		throw new InventoryModelError(`${field} must be a non-empty canonical identifier`);
	}
	return value;
}

export const assetId = (value: string): AssetId => opaqueIdentifier(value, 'assetId') as AssetId;
export const assetShortId = (value: string): AssetShortId => opaqueIdentifier(value, 'assetShortId') as AssetShortId;
export const legacyIdentifier = (value: string): LegacyIdentifier =>
	opaqueIdentifier(value, 'legacyIdentifier') as LegacyIdentifier;
export const loanId = (value: string): LoanId => opaqueIdentifier(value, 'loanId') as LoanId;
export const memberId = (value: string): MemberId => opaqueIdentifier(value, 'memberId') as MemberId;
export const receiptId = (value: string): ReceiptId => opaqueIdentifier(value, 'receiptId') as ReceiptId;
export const repairCaseId = (value: string): RepairCaseId => opaqueIdentifier(value, 'repairCaseId') as RepairCaseId;

export class InventoryModelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InventoryModelError';
	}
}

export const ASSET_STATES = ['available', 'checked_out', 'repair', 'quarantined', 'retired'] as const;
export type AssetState = (typeof ASSET_STATES)[number];

export const LOAN_STATES = ['draft', 'active', 'overdue', 'returned', 'cancelled'] as const;
export type LoanState = (typeof LOAN_STATES)[number];

export const RETURN_DISPOSITIONS = ['clean', 'needs-repair', 'missing-content', 'damage'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];
export type QuarantineDisposition = Exclude<ReturnDisposition, 'clean'>;

export interface InventoryAsset {
	readonly id: AssetId;
	readonly shortId: AssetShortId;
	readonly legacyIdentifier: LegacyIdentifier | null;
	/** Null until the operator maps an opaque legacy identifier during intake. */
	readonly kind: string | null;
	readonly ownerCustodyBasis: string;
	readonly state: AssetState;
	readonly version: number;
	readonly checklistVersion: string;
	readonly parentKitId: AssetId | null;
}

export interface InventoryLoan {
	readonly id: LoanId;
	readonly assetId: AssetId;
	readonly memberId: MemberId;
	readonly state: LoanState;
	readonly version: number;
	readonly checkoutChecklistVersion: string;
	readonly returnChecklistVersion: string | null;
	readonly checkedOutAt: string | null;
	readonly expectedReturnAt: string | null;
	readonly returnedAt: string | null;
}

export interface OpenRepairCase {
	readonly id: RepairCaseId;
	readonly assetId: AssetId;
	readonly loanId: LoanId;
	readonly state: 'open';
	readonly disposition: QuarantineDisposition;
	readonly openedAt: string;
}

export interface CheckoutReceipt {
	readonly id: ReceiptId;
	readonly idempotencyKey: string;
	readonly kind: 'checkout-finalized';
	readonly assetId: AssetId;
	readonly loanId: LoanId;
	readonly occurredAt: string;
	readonly expectedReturnAt: string;
	readonly checkoutChecklistVersion: string;
	readonly assetVersion: number;
	readonly loanVersion: number;
}

export interface ReturnReceipt {
	readonly id: ReceiptId;
	readonly idempotencyKey: string;
	readonly kind: 'return-finalized';
	readonly assetId: AssetId;
	readonly loanId: LoanId;
	readonly occurredAt: string;
	readonly disposition: ReturnDisposition;
	readonly returnChecklistVersion: string;
	readonly repairCaseId: RepairCaseId | null;
	readonly assetVersion: number;
	readonly loanVersion: number;
}

export type CustodyReceipt = CheckoutReceipt | ReturnReceipt;

export interface InventoryCustody {
	readonly asset: InventoryAsset;
	readonly loan: InventoryLoan;
	readonly openRepairCase: OpenRepairCase | null;
	readonly receipts: readonly CustodyReceipt[];
}

export const DEFAULT_LOAN_DAYS = 7;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Accept exactly the UTC/millisecond representation persisted by the domain. */
export function canonicalInstant(value: string, field: string): string {
	const instant = Date.parse(value);
	if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
		throw new InventoryModelError(`${field} must be a canonical UTC ISO-8601 timestamp`);
	}
	return value;
}

/** Return the ratified seven-day default without reading a wall clock. */
export function defaultExpectedReturnAt(checkedOutAt: string): string {
	canonicalInstant(checkedOutAt, 'checkedOutAt');
	const instant = Date.parse(checkedOutAt);
	const expectedReturn = new Date(instant + DEFAULT_LOAN_DAYS * DAY_MILLISECONDS);
	if (!Number.isFinite(expectedReturn.getTime())) {
		throw new InventoryModelError('checkedOutAt is too late for the seven-day default return window');
	}
	return expectedReturn.toISOString();
}
