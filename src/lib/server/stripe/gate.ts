/**
 * The live-Stripe gate — CLOSED (TIN-3818; ADR 0016 §3, spec §5 rows 1–7).
 *
 * The seven-row production activation gate, verbatim from spec §5 and
 * ratified by ADR 0016 §3.3, has NO open receipts. Row 7 —
 * `ENABLE-LIVE-STRIPE <account-id> <date>` — is a decision only Jess can
 * post: no agent, no automation, no inference. This slice therefore ships the
 * gate as a CONSTANT, not a flag: there is no environment variable, config
 * file, or code path that opens it. Wiring the operator's decision record in
 * (a runtime reference supplied by `great-falls-tool-bus-infra`, per slices
 * §1.11) is future work that itself rides the row-7 decision.
 *
 * Two independent refusals (slices §1.11 — "one flag is a single point of
 * failure for a row the operator ratified"):
 *
 *   1. `config.ts` — the client factory cannot be handed anything but an
 *      `sk_test_` key, so no live processor call is constructible.
 *   2. This module — the webhook route rejects `livemode: true` events with a
 *      4xx and no state change, even though a correctly-signed live event
 *      cannot arise from a test-mode endpoint secret in the first place.
 */

/** The gate, as a frozen fact. Nothing in this repository can flip it. */
export const LIVE_STRIPE_GATE = Object.freeze({
	open: false as const,
	reason:
		'Seven-row gate (spec §5 / ADR 0016 §3) has no receipts; ENABLE-LIVE-STRIPE is a Jess-only decision and out of scope for TIN-3818.',
});

export function liveGateOpen(): false {
	return LIVE_STRIPE_GATE.open;
}

export class LiveModeRejectedError extends Error {
	constructor(context: string) {
		super(`live-mode Stripe ${context} rejected: ${LIVE_STRIPE_GATE.reason}`);
	}
}

/**
 * Refuse anything live-mode. The webhook handler calls this after signature
 * verification and before persisting; the projector calls it again on the
 * stored row, so a live event cannot even be replayed into a projection.
 */
export function assertTestModeEvent(event: { livemode: boolean; id?: string }): void {
	if (event.livemode) {
		throw new LiveModeRejectedError(`event ${event.id ?? '(unknown id)'}`);
	}
}
