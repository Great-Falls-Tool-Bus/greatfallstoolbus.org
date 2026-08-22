/**
 * `/offboarding` — read-only offboarding job observability (TIN-3440 slice
 * S11; L70 mandate, sitting-2 QA gap: "work that we'll complete prior to
 * aug 30"). S6/S7 already dispatch `offboard.cancel_billing`,
 * `offboard.remove_lists`, and `offboard.disable_mailbox` as outbox jobs;
 * their state was previously visible only in the database or worker logs.
 * This route makes it visible over HTTP — and nothing else.
 *
 * READ-ONLY BY CONSTRUCTION: this file exports `load` and NO `actions`. There
 * is no POST handler, no retry button, no mutation path — SvelteKit has
 * nothing to dispatch a form to even if a `<form>` were added to the page.
 * Retry/replay of a dead-lettered job stays the S6/S7 replay machinery's job
 * (whole-offboarding replay via a membership transition, `enqueueOffboarding`
 * in `$lib/server/membership/offboard.ts`), never a button on this surface.
 *
 * WHO SEES IT: a live session holding a live `keyholder` grant — see the
 * FLAGGED ASSUMPTION on `offboardingObservability` in
 * `$lib/server/membership/offboard.ts` for the search trail behind that
 * choice (finance was considered and NOT admitted). The grant check runs
 * inside the same `withTenant` unit of work as the query (spec §6), the
 * `/remove` and `/review` precedent.
 *
 * NO NEW STATE: every field below is read straight from `outbox_job` (S3) and
 * `membership` (S1/S6) rows S7 already writes. This slice adds zero columns
 * and zero migrations.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { offboardingObservability, type OffboardedMembershipObservability } from '$lib/server/membership/offboard';
import type { PageServerLoad } from './$types';
import { resolveReviewer } from '../review/reviewer';

export const prerender = false;

export interface OffboardingSeams {
	env?: NodeJS.ProcessEnv;
}

/** Serialisable row for the page — dates flattened to ISO strings, nothing added. */
function serializeMembership(entry: OffboardedMembershipObservability) {
	return {
		membershipId: entry.membershipId,
		displayName: entry.displayName,
		status: entry.status,
		endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
		jobs: entry.jobs.map((job) => ({
			kind: job.kind,
			status: job.status,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			availableAt: job.availableAt.toISOString(),
			leaseExpiresAt: job.leaseExpiresAt ? job.leaseExpiresAt.toISOString() : null,
			lastError: job.lastError,
			createdAt: job.createdAt.toISOString(),
			updatedAt: job.updatedAt.toISOString(),
		})),
	};
}

export function _createOffboardingLoad(seams: OffboardingSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, memberships: [] };
		}
		const reviewer = resolveReviewer(event);
		if (!reviewer) return { available: true as const, authenticated: false as const, memberships: [] };
		try {
			const entries = await withTenant(tenantId, (tx) => offboardingObservability(tx, reviewer.personId));
			return {
				available: true as const,
				authenticated: true as const,
				memberships: entries.map(serializeMembership),
			};
		} catch (error) {
			// A session without the grant reads as an empty, unauthorized surface —
			// the page explains; there is no action here to return an explicit 403.
			console.error('[offboarding] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, memberships: [] };
		}
	};
}

export const load: PageServerLoad = _createOffboardingLoad();
