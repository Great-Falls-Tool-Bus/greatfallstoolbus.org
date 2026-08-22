/**
 * `offboard.cancel_billing` (TIN-3440 slice S7; slices §2.3 row 1; spec §4
 * offboarding step 3).
 *
 * WHAT THIS HANDLER OWNS TODAY: moving the person's contribution agreement to
 * `cancelled` — idempotently, because the transition happens only FROM a
 * non-`cancelled` state; a person with no agreement at all (never offered,
 * chose nothing) is the documented no-op. This file lives OUTSIDE
 * `src/lib/server/membership/**` on purpose: it may import contribution code;
 * membership code may not (the S8 static fence) — the projection direction is
 * membership → finance, never back (member-projection-flow.mmd: finance
 * "never changes membership").
 *
 * WHAT IT DOES **NOT** DO: call Stripe. Cancelling a live Stripe subscription
 * is S9's `stripe-project` lane behind the seven-row live gate (ADR 0016
 * §5.1, every row CLOSED — live mode is technically impossible: throwing
 * client factory + webhook livemode rejection). Until S9 registers the
 * subscription-cancel projection, the durable `cancelled` agreement state is
 * the record finance reconciles against — and a dead-lettered row here is
 * exactly "finance sees an open obligation" (§2.3).
 *
 * IDEMPOTENT BY CONSTRUCTION (§2.3 "idempotent because"): replaying this
 * handler re-reads a `cancelled` agreement and writes nothing.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import { withTenant } from '../../db/tenant';
import { contributionAgreement } from '../../db/schema';
import type { ClaimedJob } from '../schema';

interface OffboardPayload {
	personId?: string;
}

/** The at-least-once consumer: safe to run any number of times. */
export async function cancelBillingHandler(job: ClaimedJob): Promise<void> {
	const personId = (job.payload as OffboardPayload | null)?.personId;
	if (typeof personId !== 'string' || personId.length === 0) {
		// Deterministic poison: a malformed payload retries into dead-letter
		// VISIBLY (spec §3.1) rather than being silently completed.
		throw new Error('offboard.cancel_billing: payload.personId is required');
	}
	await withTenant(job.tenantId, async (tx) => {
		await tx
			.update(contributionAgreement)
			.set({ state: 'cancelled', version: sql`${contributionAgreement.version} + 1` })
			.where(and(eq(contributionAgreement.personId, personId), ne(contributionAgreement.state, 'cancelled')));
	});
}
