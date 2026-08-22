/**
 * `/offboarding-obligations` — the finance audience §2.3 row 1 names (TIN-3440
 * slice S11, round 2; TIN-3818 slice S10 for `requireFinance`).
 *
 * `member-v0-executable-slices-2026-08-18.md:731` (§2.3, offboarding-replay
 * table, row 1): a permanently failed `offboard.cancel_billing` job
 * "dead-letter[s]; membership stays offboarded; **finance sees an open
 * obligation**." `src/routes/(keyholder)/offboarding/+page.server.ts`
 * withholds this exact job kind's `lastError` from keyholders (spec §5's
 * "failure detail" prohibition) — this route is where that same detail
 * surfaces, to the audience the spec actually names for it.
 *
 * NOT PRERENDERED — request-time, session-gated, the S4/S5/S7/S10 split.
 *
 * REFUSAL SHAPE — REAL ERRORS, THE #195 CONVENTION, NOT `/review`'S SOFT 200.
 * This route's entire content is the sensitive detail spec §5 restricts to
 * finance (the same "entire content IS the sensitive data" premise #195's
 * `/contributions` route documents), so the load itself throws: 401 with no
 * session, 403 for a session without a live `finance` grant (keyholder
 * sessions included — holding `keyholder` never implies `finance`,
 * `decisions/0018:81-85`).
 *
 * THIS ROUTE HAS NO `actions` EXPORT. Read-only, structurally: no charge,
 * refund, receipt-entry, retry, or replay reachable from it. Retrying a
 * dead-lettered `cancel_billing` job stays the S6/S7 whole-offboarding replay
 * machinery's job.
 */

import { error as httpError, type RequestEvent } from '@sveltejs/kit';
import { AuthError } from '$lib/server/auth';
import { withTenant } from '$lib/server/db/tenant';
import {
	financeOpenBillingObligations,
	type BillingObligation,
} from '$lib/server/contribution/offboarding-obligations';
import type { PageServerLoad } from './$types';
import { resolveFinanceActor } from '../contributions/actor';

export const prerender = false;

export interface OffboardingObligationsSeams {
	env?: NodeJS.ProcessEnv;
}

/** Serialisable row for the page — dates flattened, nothing added beyond the domain type. */
function serializeObligation(row: BillingObligation) {
	return {
		membershipId: row.membershipId,
		personId: row.personId,
		displayName: row.displayName,
		status: row.status,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		lastError: row.lastError,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function _createOffboardingObligationsLoad(seams: OffboardingObligationsSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, obligations: [] };
		}

		const actor = resolveFinanceActor(event);
		if (!actor) {
			throw httpError(401, 'This page requires a signed-in finance session.');
		}

		try {
			const obligations = await withTenant(tenantId, (tx) => financeOpenBillingObligations(tx, actor.personId));
			return { available: true as const, obligations: obligations.map(serializeObligation) };
		} catch (err) {
			if (err instanceof AuthError) {
				throw httpError(err.status, err.message);
			}
			console.error('[offboarding-obligations] load failed:', err instanceof Error ? err.message : err);
			throw httpError(500, 'Offboarding-obligations read failed.');
		}
	};
}

export const load: PageServerLoad = _createOffboardingObligationsLoad();
