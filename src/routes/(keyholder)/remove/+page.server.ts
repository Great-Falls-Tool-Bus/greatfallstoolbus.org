/**
 * `/remove` — M5 `remove`, the keyholder's forcible offboarding (TIN-3440
 * slice S7; spec §4; slices §2.2 row 14; TIN-3440: "Sensitive keyholder
 * actions require fresh password reauthentication" and "must record a
 * reason").
 *
 * THE FRESH-REAUTH MECHANIC, EXECUTED: the remove form carries the
 * keyholder's password; the action verifies it and ROTATES the session
 * (S2's `reauthenticate` — the presented session dies, a fresh one is
 * minted) inside the SAME `withTenant` unit of work as the removal, and the
 * rotation instant is the `reauth_at` the audit row records. A wrong
 * password refuses the whole action — no removal without the re-proof.
 *
 * WHAT A KEYHOLDER SEES HERE: membership status and display name — never
 * amount, rail, processor state, or any contribution detail (spec §5;
 * TIN-3818). The load serializes a closed shape on purpose.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { withTenant } from '$lib/server/db/tenant';
import { membership, person } from '$lib/server/db/schema';
import { AuthError, SESSION_COOKIE, reauthenticate } from '$lib/server/auth';
import { requireKeyholder } from '$lib/server/application/claim';
import {
	IllegalMembershipTransitionError,
	MembershipNotFoundError,
	MembershipVersionConflictError,
} from '$lib/server/membership/activate';
import { removeMembership } from '$lib/server/membership/transition';
import { personRecord } from '$lib/server/membership/offboard';
import type { PageServerLoad } from './$types';
import { NOT_AUTHENTICATED, parseExpectedVersion, resolveReviewer } from '../review/reviewer';

export const prerender = false;

const UNAVAILABLE = { code: 'remove_unavailable' } as const;

export interface RemoveSeams {
	env?: NodeJS.ProcessEnv;
}

export function _createRemoveLoad(seams: RemoveSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, memberships: [] };
		}
		const reviewer = resolveReviewer(event);
		if (!reviewer) return { available: true as const, authenticated: false as const, memberships: [] };
		try {
			const memberships = await withTenant(tenantId, async (tx) => {
				await requireKeyholder(tx, reviewer.personId);
				const rows = await tx
					.select({ m: membership, displayName: person.displayName })
					.from(membership)
					.innerJoin(person, eq(person.id, membership.personId))
					.orderBy(membership.createdAt);
				// The CLOSED keyholder shape: state + identity, nothing financial.
				return rows.map((row) => ({
					id: row.m.id,
					displayName: row.displayName,
					status: row.m.status,
					version: row.m.version,
				}));
			});
			return { available: true as const, authenticated: true as const, memberships };
		} catch (error) {
			console.error('[remove] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, memberships: [] };
		}
	};
}

export function _createRemoveAction(seams: RemoveSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);
		const session = event.locals.authSession;
		const reviewer = resolveReviewer(event);
		if (!session || !reviewer) return fail(401, NOT_AUTHENTICATED);

		const form = await event.request.formData();
		const membershipId = form.get('membershipId');
		const reasonClass = form.get('reasonClass');
		const password = form.get('password');
		const expectedVersion = parseExpectedVersion(form.get('expectedVersion'));

		if (typeof membershipId !== 'string' || membershipId.trim().length === 0) {
			return fail(404, { code: 'not_found' as const });
		}
		if (typeof reasonClass !== 'string' || reasonClass.trim().length === 0) {
			// TIN-3440's recorded-reason rule at the HTTP edge (the S5 decline
			// posture applied to removal).
			return fail(400, { code: 'reason_required' as const });
		}
		if (typeof password !== 'string' || password.length === 0) {
			return fail(401, { code: 'reauth_required' as const });
		}
		if (expectedVersion === undefined) {
			return fail(409, { code: 'version_required' as const });
		}

		try {
			const result = await withTenant(tenantId, async (tx) => {
				// Fresh password reauthentication, session-rotating (row 14).
				const reauthAt = new Date();
				const rotated = await reauthenticate(tx, tenantId, session, password);
				const removal = await removeMembership(tx, {
					membershipId: membershipId.trim().toLowerCase(),
					keyholderPersonId: reviewer.personId,
					reasonClass: reasonClass.trim(),
					reauthAt,
					expectedVersion,
				});
				const record = await personRecord(tx, removal.membership.personId);
				return { rotated, removal, openObligations: record.openObligations.length };
			});
			event.cookies.set(SESSION_COOKIE, result.rotated.id, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
			});
			return {
				removed: true as const,
				replayed: !result.removal.changed,
				openObligations: result.openObligations,
			};
		} catch (error) {
			if (error instanceof AuthError) return fail(error.status, { code: error.code });
			if (error instanceof MembershipNotFoundError) return fail(404, { code: 'not_found' });
			if (error instanceof MembershipVersionConflictError) return fail(409, { code: 'version_conflict' });
			if (error instanceof IllegalMembershipTransitionError) return fail(409, { code: 'illegal_transition' });
			console.error('[remove] action failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'remove_failed' });
		}
	};
}

export const load: PageServerLoad = _createRemoveLoad();

export const actions: Actions = {
	default: _createRemoveAction(),
};
