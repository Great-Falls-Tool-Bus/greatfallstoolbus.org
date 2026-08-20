/**
 * Contribution visibility boundary (TIN-3818; spec §5 "State and privacy").
 *
 * "Only the finance role can read amount, rail, processor/customer
 * identifiers, cash notes, or failure detail. General keyholders may see only
 * whether the contribution step was offered and whether help is requested."
 *
 * The keyholder shape is CLOSED: it is built field-by-field from literals, so
 * a new sensitive column on the agreement cannot leak by spread, and the shape
 * test asserts `Object.keys(...)` exactly — an added field fails the test
 * (slices §1.10 acceptance).
 *
 * Role ENFORCEMENT (which session may call which serializer) rides S2's grant
 * table and is not in this scaffold; the serializers and their structural
 * tests land first so S8 can wire guards to an already-pinned shape.
 */

import type { ContributionAgreement, FinanceReceipt } from '../db/schema';

/** Everything a general keyholder may ever see about a contribution. */
export interface KeyholderContributionView {
	offered: boolean;
	helpRequested: boolean;
}

export function keyholderContributionView(agreement: ContributionAgreement | undefined): KeyholderContributionView {
	return {
		offered: agreement?.offeredAt != null,
		helpRequested: agreement?.helpRequested ?? false,
	};
}

/** The finance-role read: the full agreement plus the append-only receipt trail, rails not collapsed. */
export interface FinanceContributionView {
	agreement: ContributionAgreement | undefined;
	receipts: FinanceReceipt[];
}

export function financeContributionView(
	agreement: ContributionAgreement | undefined,
	receipts: FinanceReceipt[],
): FinanceContributionView {
	return { agreement, receipts };
}
