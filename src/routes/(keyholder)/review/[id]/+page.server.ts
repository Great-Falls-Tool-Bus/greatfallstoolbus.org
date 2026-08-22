/**
 * `/review/[id]` — one application under review (TIN-3440 slice S5; spec §4
 * A5 `schedule_tour`, A6 `approve`, A7 `decline`).
 *
 * THE DECISION IS THE CLAIMING KEYHOLDER'S, AFTER THE TOUR: approve is only
 * reachable from `tour_scheduled` (there is no claimed→approved edge — the
 * in-person tour must have happened, spec §4), decline from `claimed` or
 * `tour_scheduled` WITH a recorded reason (TIN-3440). Scheduling the tour is
 * pure state — the tour itself is arranged by ordinary email, and this route
 * automates nothing around it.
 *
 * Every action re-checks the keyholder grant AND claimant-ship inside its own
 * `withTenant` unit of work (spec §6); form input is validated by the
 * decide.ts validators, which reject unknown fields — the structural
 * "no contribution field on a decision" line, at the HTTP shape.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { reviewDetail, scheduleTour } from '$lib/server/application/claim';
import {
	InvalidDecisionError,
	approveApplication,
	declineApplication,
	validateApproval,
	validateDecline,
} from '$lib/server/application/decide';
import type { PageServerLoad } from './$types';
import { NOT_AUTHENTICATED, UNAVAILABLE, parseExpectedVersion, resolveReviewer, reviewFailure } from '../reviewer';

export const prerender = false;

export interface ReviewDetailSeams {
	env?: NodeJS.ProcessEnv;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `[id]` param, or null when it is not even id-shaped (fail soft). */
function applicationIdParam(event: RequestEvent): string | null {
	const id = (event.params as { id?: string }).id;
	return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
}

export function _createDetailLoad(seams: ReviewDetailSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, entry: null };
		}
		const reviewer = resolveReviewer(event);
		if (!reviewer) return { available: true as const, authenticated: false as const, entry: null };
		const applicationId = applicationIdParam(event);
		if (!applicationId) return { available: true as const, authenticated: true as const, entry: null };
		try {
			const detail = await withTenant(tenantId, (tx) => reviewDetail(tx, reviewer.personId, applicationId));
			return {
				available: true as const,
				authenticated: true as const,
				entry: {
					id: detail.application.id,
					status: detail.application.status,
					version: detail.application.version,
					displayName: detail.application.displayName,
					email: detail.application.email,
					interestsHelpOffer: detail.application.interestsHelpOffer,
					tourAvailability: detail.application.tourAvailability,
					disclosures: detail.application.disclosures,
					submittedAt: detail.application.createdAt.toISOString(),
					claim: detail.claim
						? {
								keyholderPersonId: detail.claim.keyholderPersonId,
								claimedAt: detail.claim.claimedAt.toISOString(),
								mine: detail.claim.keyholderPersonId === reviewer.personId,
							}
						: null,
					decision: detail.decision
						? {
								decision: detail.decision.decision,
								reasonClass: detail.decision.reasonClass,
								decidedAt: detail.decision.createdAt.toISOString(),
							}
						: null,
				},
			};
		} catch (error) {
			console.error('[review/id] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, entry: null };
		}
	};
}

type ActionRunner = (tenantId: string, personId: string, applicationId: string, form: FormData) => Promise<unknown>;

function actionWith(seams: ReviewDetailSeams, run: ActionRunner) {
	const env = seams.env ?? process.env;
	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);
		const reviewer = resolveReviewer(event);
		if (!reviewer) return fail(401, NOT_AUTHENTICATED);
		const applicationId = applicationIdParam(event);
		if (!applicationId) return fail(404, { code: 'not_found' as const });
		const form = await event.request.formData();
		try {
			return await run(tenantId, reviewer.personId, applicationId, form);
		} catch (error) {
			return reviewFailure(error);
		}
	};
}

export function _createScheduleTourAction(seams: ReviewDetailSeams = {}) {
	return actionWith(seams, async (tenantId, personId, applicationId, form) => {
		const expectedVersion = parseExpectedVersion(form.get('expectedVersion'));
		const updated = await withTenant(tenantId, (tx) =>
			scheduleTour(tx, { applicationId, keyholderPersonId: personId, expectedVersion }),
		);
		return { tourScheduled: true as const, status: updated.status };
	});
}

/** Collect ONLY the named fields; an extra form key never reaches the DB. */
function decisionRaw(applicationId: string, form: FormData, withReason: boolean): Record<string, unknown> {
	const raw: Record<string, unknown> = { applicationId };
	const note = form.get('note');
	if (typeof note === 'string' && note.trim().length > 0) raw.note = note;
	const expectedVersion = parseExpectedVersion(form.get('expectedVersion'));
	if (expectedVersion !== undefined) raw.expectedVersion = expectedVersion;
	if (withReason) {
		// Present even when empty so the validator names the missing mechanic
		// (a decline without a reason is a 400, not a silent approve-shaped
		// nothing — TIN-3440's recorded-reason rule at the HTTP edge).
		raw.reasonClass = typeof form.get('reasonClass') === 'string' ? (form.get('reasonClass') as string) : '';
	}
	return raw;
}

export function _createApproveAction(seams: ReviewDetailSeams = {}) {
	return actionWith(seams, async (tenantId, personId, applicationId, form) => {
		const validated = validateApproval(decisionRaw(applicationId, form, false));
		const result = await withTenant(tenantId, (tx) =>
			approveApplication(tx, { ...validated, keyholderPersonId: personId }),
		);
		return { decided: result.decision.decision, replayed: !result.decided };
	});
}

export function _createDeclineAction(seams: ReviewDetailSeams = {}) {
	return actionWith(seams, async (tenantId, personId, applicationId, form) => {
		let validated;
		try {
			validated = validateDecline(decisionRaw(applicationId, form, true));
		} catch (error) {
			if (error instanceof InvalidDecisionError) {
				return fail(400, { code: 'invalid', fields: error.fields });
			}
			throw error;
		}
		const result = await withTenant(tenantId, (tx) =>
			declineApplication(tx, { ...validated, keyholderPersonId: personId }),
		);
		return { decided: result.decision.decision, replayed: !result.decided };
	});
}

export const load: PageServerLoad = _createDetailLoad();

export const actions: Actions = {
	scheduleTour: _createScheduleTourAction(),
	approve: _createApproveAction(),
	decline: _createDeclineAction(),
};
