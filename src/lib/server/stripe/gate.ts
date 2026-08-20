/**
 * The live-Stripe gate — CLOSED (TIN-3818; spec §5 rows 1–7).
 *
 * Authority, stated precisely (adversarial-review finding B1 on PR #174): the
 * seven-row gate lives in spec §5. Its FORM is PROPOSED for ratification in
 * ADR 0016 §5.1 and is UNSIGNED — ADR 0016 §3 records the 2026-08-18 Card C
 * ruling, which decided only the §11 fallback question, and §3.3 is precisely
 * the clause saying the form is not yet ratified. Nothing here may treat the
 * PROPOSED text as ratified authority; what this module enforces needs no
 * ratification anyway, because it only ever REFUSES.
 *
 * No row has a receipt. Row 7 — `ENABLE-LIVE-STRIPE <account-id> <date>` — is
 * a decision only Jess can post: no agent, no automation, no inference. This
 * slice therefore ships the gate as a CONSTANT, not a flag: there is no
 * environment variable, config file, or code path that opens it. Wiring the
 * operator's decision record in (a runtime reference supplied by
 * `great-falls-tool-bus-infra`, per slices §1.11) is future work that itself
 * rides the row-7 decision.
 *
 * THE GATE IS CONSULTED, NOT DECORATIVE (finding B4). Every live/test
 * decision in this package routes through `liveGateOpen()`:
 *
 *   1. `client.ts` — gateway construction refuses any secret key that is not
 *      whole-string test-shaped UNLESS the gate is open, so flipping the gate
 *      (which nothing in this repository can do) is the only act that could
 *      ever admit a live key.
 *   2. `webhook.ts` / `project.ts` — `testModeOnly(livemode)` admits an event
 *      only when `livemode === false` or the gate is open. Missing or
 *      malformed `livemode` FAILS CLOSED (finding S1): `undefined`, `null`,
 *      or a non-boolean is treated as live, not as test.
 */

/** The gate, as a frozen fact. Nothing in this repository can flip it. */
export const LIVE_STRIPE_GATE = Object.freeze({
	open: false as const,
	reason:
		'Seven-row gate (spec §5; form PROPOSED in ADR 0016 §5.1, unsigned) has no receipts; ' +
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
