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
 * WHO SEES IT, AND WHAT — round 2, after adversarial review BLOCK on PR #194
 * @ 83947ea (B1/B2). A live session holding a live `keyholder` grant; see the
 * ROLE VISIBILITY comment on `offboardingObservability` in
 * `$lib/server/membership/offboard.ts` for the ruling, which is §2.3 row 1
 * (`member-v0-executable-slices-2026-08-18.md:731`), not an unstated gap —
 * round 1's "genuinely unstated" claim was false and is corrected there. The
 * grant check runs inside the same `withTenant` unit of work as the query
 * (spec §6), the `/remove` and `/review` precedent.
 *
 * REDACTION AT THIS BOUNDARY (round 2 fix, not present in round 1):
 * `serializeMembership` below withholds `lastError` for `offboard.cancel_billing`
 * unconditionally (spec §5's keyholder "failure detail" prohibition,
 * `launch-member-v0-system-2026-08-16.md:223-225`) and drops `leaseExpiresAt`
 * (never rendered by `+page.svelte`, so never shipped). `lastError` for the
 * other two kinds is served only when `status === 'dead'`, matching what the
 * page actually renders — a retry-pending error is not shipped invisibly.
 * The domain function returns the raw row; THIS is the closed shape, the
 * `keyholderContributionView` / `/remove` "serialize a closed shape on
 * purpose" convention applied here. Finance reads the withheld
 * `cancel_billing` detail from `/offboarding-obligations` instead
 * (`$lib/server/contribution/offboarding-obligations.ts`, PR #195's
 * `requireFinance` — §2.3 row 1's named audience).
 *
 * NO NEW STATE: every field below is read straight from `outbox_job` (S3) and
 * `membership` (S1/S6) rows S7 already writes. This slice adds zero columns
 * and zero migrations.
 */

import { error as httpError, type RequestEvent } from '@sveltejs/kit';
import { AuthError } from '$lib/server/auth';
import { withTenant } from '$lib/server/db/tenant';
import { offboardingObservability, type OffboardedMembershipObservability } from '$lib/server/membership/offboard';
import type { PageServerLoad } from './$types';
import { resolveReviewer } from '../review/reviewer';

export const prerender = false;

export interface OffboardingSeams {
	env?: NodeJS.ProcessEnv;
}

const CANCEL_BILLING_KIND = 'offboard.cancel_billing';

/**
 * Serialisable row for the page — the closed keyholder shape, not a spread.
 * `leaseExpiresAt` is dropped (never rendered). `lastError` is withheld for
 * `offboard.cancel_billing` always (spec §5 "failure detail"), and for every
 * other kind only when `status === 'dead'` (a retry-pending error is not
 * shipped invisibly — `+page.svelte` renders `lastError` only in that state).
 */
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
			lastError: job.status === 'dead' && job.kind !== CANCEL_BILLING_KIND ? job.lastError : null,
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
			if (error instanceof AuthError) {
				// A session without the grant reads as an empty, unauthorized surface
				// — the page explains; there is no action here to return an explicit
				// 403. This is the ONLY class of error this load swallows.
				console.error('[offboarding] load refused:', error.message);
				return { available: true as const, authenticated: false as const, memberships: [] };
			}
			// Round-2 fix (adversarial review EDIT-4): anything else — an
			// unreachable database, a malformed tenant id, any infrastructure
			// failure — is NOT an auth problem and must not render as one. A
			// surface whose purpose is observing failures must not itself hide
			// its own failures behind "please sign in."
			console.error('[offboarding] load failed:', error instanceof Error ? error.message : error);
			throw httpError(500, 'Offboarding read failed.');
		}
	};
}

export const load: PageServerLoad = _createOffboardingLoad();
