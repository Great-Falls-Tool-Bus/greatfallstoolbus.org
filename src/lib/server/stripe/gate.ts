/**
 * =========================================================================
 * DO NOT MERGE — this file is the row-7 carrier, not a shipped change.
 *
 * This PR (feat/stripe-live-gate-open) exists so the operator's
 * `ENABLE-LIVE-STRIPE <account-id> <date>` decision has somewhere to land as
 * code. It merges ONLY when:
 *   - rows 1–6 of the spec §5 / ADR 0016 §5.1 gate each have a private
 *     receipt (merchant identity, bank ownership, Stripe account + tax
 *     verification, approved agreement/privacy/refund copy, Maine
 *     solicitation determination, Stripe purpose acceptance), AND
 *   - the operator has replaced the two placeholders below with the real
 *     Stripe account id and the decision date, as the literal act of
 *     posting `ENABLE-LIVE-STRIPE <account-id> <date>`.
 * Until then this branch stays open and unmerged. See the DRAFT PR
 * description for the full packet reference.
 * =========================================================================
 *
 * The live-Stripe gate (TIN-3818; spec §5 rows 1–7).
 *
 * Authority, stated precisely (adversarial-review finding B1 on PR #174): the
 * seven-row gate lives in spec §5. Its FORM was PROPOSED for ratification in
 * ADR 0016 §5.1 and is now SIGNED — the operator ratified §5.1 and §5.2 in
 * the 2026-08-20 interview (ADR 0016 Status line, "DECIDED — operator
 * signature, 2026-08-20"). Signature ratifies the seven-row FORM only; per
 * ADR 0016's own Boundaries clause it "does not claim that an LLC, EIN, bank
 * account, Stripe account, license, exemption ... exists" — each row still
 * needs its own receipt. Nothing here may treat a ratified form as a
 * substitute for a missing receipt; what this module enforces needs no
 * ratification anyway, because absent an operator edit below it only ever
 * REFUSES.
 *
 * No row has a receipt yet. Row 7 — `ENABLE-LIVE-STRIPE <account-id> <date>`
 * — is a decision only Jess can post: no agent, no automation, no inference.
 * The constants below are the wiring for that decision (slices §1.11); they
 * ship as placeholder strings that keep the gate closed until the operator
 * overwrites them by hand as part of merging this PR.
 *
 * THE GATE IS CONSULTED, NOT DECORATIVE (finding B4). Every live/test
 * decision in this package routes through `liveGateOpen()`:
 *
 *   1. `client.ts` — gateway construction refuses any secret key that is not
 *      whole-string test-shaped UNLESS the gate is open, so flipping the gate
 *      (which nothing in this repository can do while this PR is unmerged)
 *      is the only act that could ever admit a live key.
 *   2. `webhook.ts` / `project.ts` — `testModeOnly(livemode)` admits an event
 *      only when `livemode === false` or the gate is open. Missing or
 *      malformed `livemode` FAILS CLOSED (finding S1): `undefined`, `null`,
 *      or a non-boolean is treated as live, not as test.
 */

/** Operator-filled placeholders — row 7's literal decision record. */
const ENABLE_LIVE_STRIPE_ACCOUNT_ID = 'REPLACE-BEFORE-MERGE-ACCOUNT-ID';
const ENABLE_LIVE_STRIPE_DATE = 'REPLACE-BEFORE-MERGE-DATE';

const ROW_7_POSTED =
	ENABLE_LIVE_STRIPE_ACCOUNT_ID !== 'REPLACE-BEFORE-MERGE-ACCOUNT-ID' &&
	ENABLE_LIVE_STRIPE_DATE !== 'REPLACE-BEFORE-MERGE-DATE';

/**
 * The gate. Stays closed as long as the placeholders above are unedited —
 * which they must remain until rows 1–6 each have a receipt and the
 * operator is ready to post row 7 by editing them and merging this PR.
 */
export const LIVE_STRIPE_GATE = Object.freeze({
	open: ROW_7_POSTED as boolean,
	reason: ROW_7_POSTED
		? `Opened by operator decision ENABLE-LIVE-STRIPE ${ENABLE_LIVE_STRIPE_ACCOUNT_ID} ${ENABLE_LIVE_STRIPE_DATE} ` +
			'(spec §5 row 7; rows 1-6 receipts attested at merge time — see PR description).'
		: 'Seven-row gate (spec §5; form ratified ADR 0016 §5.1, 2026-08-20) has no row receipts; ' +
			'ENABLE-LIVE-STRIPE is a Jess-only decision and out of scope for TIN-3818.',
});

export function liveGateOpen(): boolean {
	return LIVE_STRIPE_GATE.open;
}

/**
 * May an event with this `livemode` value be handled at all?
 * Fail-closed on anything but a literal `false` while the gate is closed.
 */
export function testModeOnly(livemode: unknown): boolean {
	return livemode === false || liveGateOpen();
}

export class LiveModeRejectedError extends Error {
	constructor(context: string) {
		super(`live-mode Stripe ${context} rejected: ${LIVE_STRIPE_GATE.reason}`);
	}
}

/**
 * Refuse anything that is not provably test-mode. The projector calls this on
 * the stored row, so a live (or livemode-less) event cannot even be replayed
 * into a projection; the webhook route applies the same predicate via
 * `testModeOnly` before persisting.
 */
export function assertTestModeEvent(event: { livemode: unknown; id?: string }): void {
	if (!testModeOnly(event.livemode)) {
		throw new LiveModeRejectedError(`event ${event.id ?? '(unknown id)'}`);
	}
}
