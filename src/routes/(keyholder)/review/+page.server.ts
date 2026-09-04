/**
 * `/review` — the keyholder review queue (TIN-3440 slice S5; spec §4 A4
 * `claim`; spec §6 request contract).
 *
 * NOT PRERENDERED, same shape as `/apply`: request-time state and POST actions
 * served by the adapter-node origin.
 *
 * WHO SEES IT: a live session holding a live `keyholder` grant. The session
 * comes from `hooks.server.ts` (S2); the GRANT check runs inside the same
 * `withTenant` unit of work as the query or transition it authorizes
 * (spec §6) — never against the session alone, so a revocation committed
 * mid-request is refused.
 *
 * WHAT IT SHOWS: every application awaiting review, each with its live claim
 * — the claimant's id and claim time are queue state VISIBLE TO EVERY
 * keyholder (claim semantics, spec §4), which is how two keyholders avoid
 * working one review. There is structurally no contribution data to show:
 * applicants have no contribution state before approval (TIN-3440).
 *
 * THE ACTION IS BUILT BY A FACTORY (S4 precedent) so the integration suite
 * drives the real request path with injected seams.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { claimApplication, listReviewQueue, type ReviewQueueEntry } from '$lib/server/application/claim';
import type { PageServerLoad } from './$types';
import { NOT_AUTHENTICATED, UNAVAILABLE, parseExpectedVersion, resolveReviewer, reviewFailure } from './reviewer';

export const prerender = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewActionSeams {
	env?: NodeJS.ProcessEnv;
}

/** Serialisable queue row for the page — dates flattened to ISO strings. */
function serializeEntry(entry: ReviewQueueEntry) {
	return {
		id: entry.application.id,
		status: entry.application.status,
		displayName: entry.application.displayName,
		email: entry.application.email,
		interestsHelpOffer: entry.application.interestsHelpOffer,
		tourAvailability: entry.application.tourAvailability,
		version: entry.application.version,
		submittedAt: entry.application.createdAt.toISOString(),
		claim: entry.claim
			? {
					keyholderPersonId: entry.claim.keyholderPersonId,
					claimedAt: entry.claim.claimedAt.toISOString(),
				}
			: null,
	};
}

export function _createReviewLoad(seams: ReviewActionSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, entries: [] };
		}
		const reviewer = resolveReviewer(event);
		if (!reviewer) return { available: true as const, authenticated: false as const, entries: [] };
		try {
			const entries = await withTenant(tenantId, (tx) => listReviewQueue(tx, reviewer.personId));
			return {
				available: true as const,
				authenticated: true as const,
				entries: entries.map(serializeEntry),
			};
		} catch (error) {
			// A session without the grant reads as an empty, unauthorized queue —
			// the page explains; the ACTIONS return the explicit 403.
			console.error('[review] queue load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, entries: [] };
		}
	};
}

export function _createClaimAction(seams: ReviewActionSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);
		const reviewer = resolveReviewer(event);
		if (!reviewer) return fail(401, NOT_AUTHENTICATED);

		const form = await event.request.formData();
		const applicationId = form.get('applicationId');
		if (typeof applicationId !== 'string' || !UUID_RE.test(applicationId)) {
			return fail(400, { code: 'invalid', fields: ['applicationId'] as const });
		}
		const expectedVersion = parseExpectedVersion(form.get('expectedVersion'));

		try {
			const result = await withTenant(tenantId, (tx) =>
				claimApplication(tx, {
					applicationId: applicationId.toLowerCase(),
					keyholderPersonId: reviewer.personId,
					expectedVersion,
				}),
			);
			// Route symmetry with the decide action's `replayed` (spec §6
			// duplicate-request convergence, H1): a same-keyholder repeat
			// still reports success, just not a fresh claim.
			return { claimed: result.claimed, applicationId: result.application.id, replayed: !result.claimed };
		} catch (error) {
			return reviewFailure(error);
		}
	};
}

export const load: PageServerLoad = _createReviewLoad();

export const actions: Actions = {
	claim: _createClaimAction(),
};
