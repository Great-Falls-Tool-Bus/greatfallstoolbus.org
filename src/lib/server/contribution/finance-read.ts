/**
 * The finance-role read surface (TIN-3818 slice S10; ratified role model —
 * decisions/0018, meta PR #32, sitting-2 item 2, option 1, verbatim):
 *
 *   finance — grant: amount, rail, processor/customer identifiers, cash
 *             notes, reconciliation; NO approve/decline capability.
 *
 * `visibility.ts` already ships the DATA half of this boundary —
 * `financeContributionView` returns the agreement plus the append-only
 * receipt trail, rails not collapsed — and its own header note flags that
 * "Role ENFORCEMENT … is not in this scaffold" as S10's hand-off. This module
 * is that hand-off: the `finance` grant constant, the guard every finance
 * read composes FIRST inside its own unit of work (spec §6 — a grant revoked
 * mid-request is refused, same discipline as `requireKeyholder` in
 * `application/claim.ts`), and the tenant-wide listing the read route
 * renders.
 *
 * READ-ONLY, STRUCTURALLY: this module has no INSERT, UPDATE, or DELETE
 * anywhere in it — grep it. Recording or reversing a receipt stays
 * `contribution/receipt.ts`'s surface; nothing here calls it. Finance READ is
 * the slice (S10); finance WRITE (an operator recording UI over
 * `recordCashCheckReceipt`/`reverseReceipt`) is a distinct, future slice.
 *
 * NO STRIPE IMPORT HERE, ON PURPOSE. `import-boundary.test.ts` pins "no
 * contribution module imports stripe code" as a structural law; the frozen
 * `LIVE_STRIPE_GATE` constant (test-mode status) is composed at the ROUTE
 * layer instead, which is outside that boundary.
 */

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import {
	contributionAgreement,
	financeReceipt,
	person,
	type ContributionAgreement,
	type FinanceReceipt,
} from '../db/schema';
import { hasRole } from '../auth/roles';
import { AuthError } from '../auth/session';
import { financeContributionView, type FinanceContributionView } from './visibility';
import { netAmountCents } from './receipt';

/**
 * S8's ratified role, named at the point of use — the S5 `KEYHOLDER_ROLE`
 * precedent. `auth/roles.ts` stays deliberately vocabulary-free; this string
 * is the one role this module's capability hangs on.
 */
export const FINANCE_ROLE = 'finance';

/** GUC read, failing fast — same rationale as claim.ts / intake.ts / tokens.ts copies. */
async function tenantFromGuc(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error('finance read: this transaction has no app.tenant_id — act only inside withTenant(tenantId, fn).');
	}
	return tenantId;
}

/**
 * The guard every S10 read composes FIRST, inside the SAME transaction as the
 * query it authorizes (spec §6): a live `finance` grant, or a thrown 403.
 * Because the check rides the caller's own unit of work, a revocation
 * committed mid-request — after the session was validated, before this
 * transaction opened — is seen and refused, the same guarantee
 * `requireKeyholder` gives S5.
 */
export async function requireFinance(tx: DbTransaction, personId: string): Promise<string> {
	const tenantId = await tenantFromGuc(tx);
	const held = await hasRole(tx, tenantId, personId, FINANCE_ROLE);
	if (!held) {
		throw new AuthError(403, 'not_finance', 'This action requires a live finance grant.');
	}
	return tenantId;
}

/** One row of the finance contribution listing: who, and everything finance may see about them. */
export interface FinanceContributionRow {
	personId: string;
	displayName: string;
	view: FinanceContributionView;
	/** Reversal-aware net of the cash/check receipt trail (see `netAmountCents`). */
	netReceiptsCents: number;
}

/**
 * Pure grouping/join logic, deliberately split from the three selects that
 * feed it (the `netAmountCents` precedent: pull the logic a DB-free test can
 * pin out of the function that has to touch a transaction). A person with no
 * `contribution_agreement` row has made no offer yet — there is structurally
 * nothing to list for them, same "offered" semantics `keyholderContributionView`
 * reads off `offeredAt`.
 */
export function buildFinanceRows(
	agreements: ContributionAgreement[],
	receipts: FinanceReceipt[],
	persons: Array<{ id: string; displayName: string }>,
): FinanceContributionRow[] {
	const receiptsByPerson = new Map<string, FinanceReceipt[]>();
	for (const receipt of receipts) {
		const bucket = receiptsByPerson.get(receipt.personId);
		if (bucket) bucket.push(receipt);
		else receiptsByPerson.set(receipt.personId, [receipt]);
	}
	const nameByPerson = new Map(persons.map((p) => [p.id, p.displayName] as const));

	return agreements.map((agreement) => {
		const personReceipts = receiptsByPerson.get(agreement.personId) ?? [];
		return {
			personId: agreement.personId,
			displayName: nameByPerson.get(agreement.personId) ?? '(no person record)',
			view: financeContributionView(agreement, personReceipts),
			netReceiptsCents: netAmountCents(personReceipts),
		};
	});
}

/**
 * Every contribution offer in the tenant, finance-shaped (spec §5 "Only the
 * finance role can read amount, rail, processor/customer identifiers, cash
 * notes, or failure detail").
 *
 * Three flat, tenant-scoped selects (RLS already restricts every one of them)
 * grouped in memory by `buildFinanceRows`, rather than a per-row N+1 — the S5
 * `listReviewQueue` shape, applied here.
 */
export async function listFinanceContributions(
	tx: DbTransaction,
	financePersonId: string,
): Promise<FinanceContributionRow[]> {
	await requireFinance(tx, financePersonId);

	const agreements = await tx.select().from(contributionAgreement).orderBy(contributionAgreement.offeredAt);
	const receipts = await tx.select().from(financeReceipt).orderBy(financeReceipt.createdAt);
	const persons = await tx.select({ id: person.id, displayName: person.displayName }).from(person);

	return buildFinanceRows(agreements, receipts, persons);
}
