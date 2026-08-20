/**
 * `/membership` — the member's own membership surface: M2 `pause`, M3
 * `resume`, M4 `leave` (TIN-3440 slice S7; spec §4; slices §2.2 rows 11–13).
 *
 * The actor is the MEMBER: the session's auth user resolves to their person
 * row (`person.auth_user_id`, linked at activation), and every action runs
 * its guards inside its own `withTenant` unit of work — the S5 route
 * discipline. Pause and resume are ordinary member acts; LEAVE is the
 * member's terminal act and requires the row's `expectedVersion` (row 13),
 * carried by the form from the version the page rendered, so a concurrent
 * transition turns a stale form into an explicit 409 rather than a
 * double-commit.
 *
 * Resume is EXPLICIT INTENT ONLY (spec §4: "never an inferred result of
 * payment"): this route's resume action is the one production caller of
 * `resumeMembership`, and nothing under contribution code can reach it.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { withTenant } from '$lib/server/db/tenant';
import type { DbTransaction } from '$lib/server/db/client';
import { membership } from '$lib/server/db/schema';
import { AuthError } from '$lib/server/auth';
import {
	IllegalMembershipTransitionError,
	MembershipNotFoundError,
	MembershipVersionConflictError,
	personByAuthUser,
} from '$lib/server/membership/activate';
import { canBorrow, leaveMembership, pauseMembership, resumeMembership } from '$lib/server/membership/transition';
import type { PageServerLoad } from './$types';

export const prerender = false;

const UNAVAILABLE = { code: 'membership_unavailable' } as const;
const NOT_AUTHENTICATED = { code: 'not_authenticated' } as const;

export interface MembershipSeams {
	env?: NodeJS.ProcessEnv;
}

function membershipFailure(error: unknown) {
	if (error instanceof AuthError) return fail(error.status, { code: error.code });
	if (error instanceof MembershipNotFoundError) return fail(404, { code: 'not_found' });
	if (error instanceof MembershipVersionConflictError) return fail(409, { code: 'version_conflict' });
	if (error instanceof IllegalMembershipTransitionError) return fail(409, { code: 'illegal_transition' });
	console.error('[membership] action failed:', error instanceof Error ? error.message : error);
	return fail(500, { code: 'membership_action_failed' });
}

export function _createMembershipLoad(seams: MembershipSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, membership: null };
		}
		const session = event.locals.authSession;
		if (!session) return { available: true as const, authenticated: false as const, membership: null };
		try {
			const result = await withTenant(tenantId, async (tx) => {
				const member = await personByAuthUser(tx, session.userId);
				if (!member) return null;
				const rows = await tx
					.select()
					.from(membership)
					.where(eq(membership.personId, member.id))
					.orderBy(membership.createdAt);
				const latest = rows.at(-1);
				if (!latest) return null;
				return {
					id: latest.id,
					status: latest.status,
					version: latest.version,
					canBorrow: canBorrow(latest),
					activatedAt: latest.activatedAt?.toISOString() ?? null,
				};
			});
			return { available: true as const, authenticated: true as const, membership: result };
		} catch (error) {
			console.error('[membership] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, membership: null };
		}
	};
}

type MemberActionRunner = (
	tx: DbTransaction,
	memberPersonId: string,
	membershipId: string,
	form: FormData,
) => Promise<unknown>;

/** Shared guard plumbing: configured runtime, live session, person row, one
 * `withTenant` unit of work per action — the S5 `actionWith` shape. */
function memberActionWith(seams: MembershipSeams, run: MemberActionRunner) {
	const env = seams.env ?? process.env;
	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);
		const session = event.locals.authSession;
		if (!session) return fail(401, NOT_AUTHENTICATED);
		const form = await event.request.formData();
		const membershipId = form.get('membershipId');
		if (typeof membershipId !== 'string' || membershipId.trim().length === 0) {
			return fail(404, { code: 'not_found' as const });
		}
		try {
			return await withTenant(tenantId, async (tx) => {
				const member = await personByAuthUser(tx, session.userId);
				if (!member) throw new AuthError(403, 'not_member', 'No member record for this session.');
				return run(tx, member.id, membershipId.trim().toLowerCase(), form);
			});
		} catch (error) {
			return membershipFailure(error);
		}
	};
}

function parseVersion(value: FormDataEntryValue | null): number | undefined {
	if (typeof value !== 'string' || value.trim().length === 0) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? undefined : parsed;
}

/** Optional reason class: a short classification, dropped when empty. */
function parseReason(value: FormDataEntryValue | null): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function _createPauseAction(seams: MembershipSeams = {}) {
	return memberActionWith(seams, async (tx, personId, membershipId, form) => {
		const result = await pauseMembership(tx, {
			membershipId,
			actor: { personId, via: 'member' },
			reasonClass: parseReason(form.get('reasonClass')),
			expectedVersion: parseVersion(form.get('expectedVersion')),
		});
		return { status: result.membership.status, replayed: !result.changed };
	});
}

export function _createResumeAction(seams: MembershipSeams = {}) {
	return memberActionWith(seams, async (tx, personId, membershipId, form) => {
		const result = await resumeMembership(tx, {
			membershipId,
			actor: { personId, via: 'member' },
			expectedVersion: parseVersion(form.get('expectedVersion')),
		});
		return { status: result.membership.status, replayed: !result.changed };
	});
}

export function _createLeaveAction(seams: MembershipSeams = {}) {
	return memberActionWith(seams, async (tx, personId, membershipId, form) => {
		const expectedVersion = parseVersion(form.get('expectedVersion'));
		if (expectedVersion === undefined) {
			// Row 13: `expectedVersion` REQUIRED on the terminal member act.
			return fail(409, { code: 'version_required' as const });
		}
		const result = await leaveMembership(tx, {
			membershipId,
			memberPersonId: personId,
			reasonClass: parseReason(form.get('reasonClass')),
			expectedVersion,
		});
		return { status: result.membership.status, replayed: !result.changed };
	});
}

export const load: PageServerLoad = _createMembershipLoad();

export const actions: Actions = {
	pause: _createPauseAction(),
	resume: _createResumeAction(),
	leave: _createLeaveAction(),
};
