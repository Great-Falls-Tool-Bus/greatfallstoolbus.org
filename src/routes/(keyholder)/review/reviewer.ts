/**
 * Shared plumbing for the keyholder review routes (TIN-3440 slice S5).
 * Not a route — SvelteKit only routes `+`-prefixed files; this module is
 * fence-internal to `src/routes/(keyholder)/review/**`.
 *
 * SESSION → PERSON, THE INTERIM SHAPE (ASSUMPTION, recorded hand-off to S6).
 * `member_role_grant` keys grants by `person_id`, but the `person` table —
 * and its `auth_user_id` mapping (spec §4 identifiers) — is S6's fence and
 * does not exist yet. Until it does, the reviewer's person id IS the auth
 * user id from the live session: operator-issued keyholder grants must use
 * the keyholder's auth user id as `person_id`. S6 replaces `resolveReviewer`'s
 * mapping with a person lookup in the same unit of work; the seam is this one
 * function, which is why it exists instead of two inline `session.userId`
 * reads. Resolver: S6 lane; no ratification needed (mechanical mapping).
 *
 * AUTHORIZATION IS NOT DECIDED HERE. This module only names the actor; the
 * keyholder-grant check runs inside the action's own `withTenant` unit of
 * work (`requireKeyholder`, spec §6), so a grant revoked mid-request — after
 * the session resolved, before the transaction opened — is still refused.
 */

import { fail, type RequestEvent } from '@sveltejs/kit';
import { AuthError } from '$lib/server/auth';
import {
	ApplicationNotFoundError,
	ClaimConflictError,
	IllegalTransitionError,
	NotClaimantError,
} from '$lib/server/application/claim';
import { InvalidDecisionError } from '$lib/server/application/decide';
import { VersionConflictError } from '$lib/server/application/intake';

export interface Reviewer {
	personId: string;
}

/** The actor behind this request, or null for anonymous. See header note. */
export function resolveReviewer(event: RequestEvent): Reviewer | null {
	const session = event.locals.authSession;
	if (!session) return null;
	return { personId: session.userId };
}

/** Constant refusal bodies — one per refusal class, never echoing input. */
export const NOT_AUTHENTICATED = { code: 'not_authenticated' } as const;
export const UNAVAILABLE = { code: 'review_unavailable' } as const;

/**
 * Map a thrown review refusal to its `fail(...)` shape. One constant body
 * per class; the 500 fallback logs server-side and leaks no detail.
 */
export function reviewFailure(error: unknown) {
	if (error instanceof AuthError) return fail(error.status, { code: error.code });
	if (error instanceof NotClaimantError) return fail(403, { code: 'not_claimant' });
	if (error instanceof ApplicationNotFoundError) return fail(404, { code: 'not_found' });
	if (error instanceof ClaimConflictError) return fail(409, { code: 'claim_conflict' });
	if (error instanceof VersionConflictError) return fail(409, { code: 'version_conflict' });
	if (error instanceof IllegalTransitionError) return fail(409, { code: 'illegal_transition' });
	if (error instanceof InvalidDecisionError) return fail(400, { code: 'invalid', fields: error.fields });
	console.error('[review] action failed:', error instanceof Error ? error.message : error);
	return fail(500, { code: 'review_failed' });
}

/** Parse the optional expectedVersion form field; NaN → undefined (absent). */
export function parseExpectedVersion(value: FormDataEntryValue | null): number | undefined {
	if (typeof value !== 'string' || value.trim().length === 0) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}
