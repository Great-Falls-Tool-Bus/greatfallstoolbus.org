/**
 * Shared plumbing for the finance read route (TIN-3818 slice S10). Not a
 * route — SvelteKit only routes `+`-prefixed files; this module is
 * fence-internal to `src/routes/(finance)/contributions/**`.
 *
 * SESSION → PERSON, THE SAME INTERIM SHAPE `(keyholder)/review/reviewer.ts`
 * documents (S5's recorded ASSUMPTION, hand-off to S6): `member_role_grant`
 * keys grants by `person_id`, and until every grant path is repointed at the
 * `person` table's `auth_user_id` mapping, the actor's person id IS the auth
 * user id from the live session — operator-issued finance grants must use the
 * finance holder's auth user id as `person_id`, exactly as keyholder grants
 * already do. Resolver: same S6 seam `resolveReviewer` names; not
 * re-litigated here.
 *
 * AUTHORIZATION IS NOT DECIDED HERE. This module only names the actor; the
 * finance-grant check runs inside `listFinanceContributions`'s own
 * `withTenant` unit of work (`requireFinance`, spec §6), so a grant revoked
 * mid-request is still refused.
 */

import type { RequestEvent } from '@sveltejs/kit';

export interface FinanceActor {
	personId: string;
}

/** The actor behind this request, or null for anonymous. See header note. */
export function resolveFinanceActor(event: RequestEvent): FinanceActor | null {
	const session = event.locals.authSession;
	if (!session) return null;
	return { personId: session.userId };
}
