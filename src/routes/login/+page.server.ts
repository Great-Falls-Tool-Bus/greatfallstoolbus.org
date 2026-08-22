/**
 * `/login` — the Member v0 front door: establish a session for an already
 * activated member (TIN-3440 slice S12; sitting-2 QA gap closure, register
 * L70, mandate 2026-08-21: "Member v0 has no route that lets an activated
 * member establish a session"). No new migration — S6's auth tables suffice.
 *
 * IDENTIFIER: EMAIL ADDRESS, not a separate "handle". Spec §4 "Identifiers"
 * names exactly one person-facing identifier — "email address: normalized,
 * verified, mutable identifier with history; never a primary key" — and
 * activation itself sets the auth package's `handle` column TO the
 * normalized email address (`membership/activate.ts` `activateMembership`:
 * `createUserWithPassword(tx, tenantId, { handle: address, email: address,
 * … })`, where `address` is the person's current, normalized address). This
 * route collects "Email address", normalizes it the SAME way
 * (`normalizeEmail`, S4's function — imported, not re-implemented), and
 * passes the result as `authenticate`'s `handle`: the exact identifier
 * activation minted.
 *
 * INHERITED GAP, NOT RESOLVED HERE: `changeEmail`'s own doc comment in
 * `activate.ts` records that the auth handle is NOT rewritten when a member
 * changes their address — "the auth user's handle/email follow through the
 * S2 adapter on the member's next credentialed flow" — so a member who has
 * changed addresses since activating still logs in with the ORIGINAL
 * address until a future slice closes that gap. Flagged in the PR body.
 *
 * SESSION ESTABLISHMENT: REUSED, NOT FORKED. `authenticate()` (S2,
 * `$lib/server/auth`) is the exact function `activateMembership` itself calls
 * to open the session it hands back ("Session issuance, same unit of work…
 * no separate session door" — activate.ts). This route calls the SAME
 * function through the SAME door and sets the SAME cookie the same way the
 * `/assent` POST action does (`SESSION_COOKIE`, httpOnly/secure/sameSite
 * lax). `authenticate` already throws the ONE `AuthError('bad_credentials')`
 * for both an unknown handle and a wrong password (S2, `session.ts`) — every
 * `AuthError` this route sees maps to the SAME constant 401 body, so the
 * uniformity is inherited from the door, not re-derived.
 *
 * SESSION FIXATION: `authenticate()`'s `adapter.createSession` always mints a
 * fresh, server-generated session id — it never adopts or extends whatever
 * cookie the request already carried. Setting `SESSION_COOKIE` to that new id
 * (below) overwrites any attacker-supplied value unconditionally.
 *
 * OFFBOARDED LOGIN, GROUNDED. S7's offboarding replay commits "immediate
 * session revocation" (spec §4; slices §2.3), but the auth package's
 * `isActive` flag is never flipped false anywhere in this codebase
 * (grep-verified against session.ts/reauth.ts — it is set `true` once, at
 * creation, and never written again). Offboarding revokes STANDING sessions;
 * it does not disable the row `authenticate()` checks. Left unhandled, a
 * `left`/`removed` member's still-valid password would mint a BRAND NEW
 * session here — directly contradicting ADR 0014 §4 / slices §2.3 invariant
 * 3: unresolved obligations stay visible on the person's record and "do not
 * preserve login or list access." This route closes that gap: AFTER
 * `authenticate()` verifies the password, it resolves the auth user to its
 * person and LATEST membership row — the exact `personByAuthUser` +
 * `membership` query `/home` and `/membership` already use — and refuses
 * `left`/`removed` (and the defensive "no person/membership at all" case) by
 * THROWING inside the same `withTenant` transaction, so the just-minted
 * session row never survives the rollback: nothing commits, so nothing needs
 * an explicit revoke. `paused` is explicitly ALLOWED — slices §1.9
 * acceptance / TIN-3440: "Pause blocks new borrowing but preserves login,
 * mail, and discussion access" (RA-2) — `pauseMembership` never touches
 * sessions and this route must not invent a restriction spec/slices do not
 * state. This refusal fires only AFTER a correct password proved account
 * knowledge, so it creates no NEW enumeration oracle: nobody who lacks the
 * password can ever reach this branch, and its distinct body leaks nothing
 * about any OTHER account.
 */

import { fail, redirect, type Actions, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { withTenant } from '$lib/server/db/tenant';
import { membership } from '$lib/server/db/schema';
import { AuthError, SESSION_COOKIE, authenticate } from '$lib/server/auth';
import { personByAuthUser } from '$lib/server/membership/activate';
import { normalizeEmail } from '$lib/server/application/intake';
import { loginRateLimiter, type RateLimiter } from '$lib/server/application/ratelimit';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** One constant body for BOTH unknown-identifier and wrong-password (no oracle). */
const BAD_CREDENTIALS = { code: 'bad_credentials' } as const;
const RATE_LIMITED = { code: 'rate_limited' } as const;
const UNAVAILABLE = { code: 'login_unavailable' } as const;
const INVALID = { code: 'invalid' } as const;
/** Distinct from BAD_CREDENTIALS on purpose — only reached past a proven
 *  password (see module doc: not a new enumeration surface). */
const MEMBERSHIP_INACTIVE = { code: 'membership_inactive' } as const;

/** The statuses a login is honored for (module doc: paused stays eligible). */
const LOGIN_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set(['active', 'paused']);

/**
 * Thrown INSIDE the `withTenant` transaction to abort it — the session
 * `authenticate()` just inserted rolls back with everything else, so there is
 * nothing to revoke afterward (module doc).
 */
class MembershipInactiveError extends Error {
	constructor() {
		super('This membership no longer has login access.');
		this.name = 'MembershipInactiveError';
	}
}

export interface LoginSeams {
	env?: NodeJS.ProcessEnv;
	limiter?: RateLimiter;
}

/**
 * Every path here either fails or redirects (`redirect()` is `never`-typed):
 * there is no resolved success value for `use:enhance` to see, matching the
 * `/contribution` `choose` action's own shape (checkout.stripe hand-off).
 */
export type LoginActionResult = ActionFailure<{ code: string }>;

export function _createLoginLoad(seams: LoginSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		// Already-authed visitors never see the form (task requirement).
		if (event.locals.authSession) {
			redirect(303, '/home');
		}
		const tenantId = env.GFTB_TENANT_ID?.trim();
		return { available: Boolean(tenantId && env.DATABASE_URL?.trim()) };
	};
}

export function _createLoginAction(seams: LoginSeams = {}) {
	const env = seams.env ?? process.env;
	const limiter = seams.limiter ?? loginRateLimiter;

	return async (event: RequestEvent): Promise<LoginActionResult> => {
		// Keyed by the CALLER, before any parsing — the same non-enumeration
		// construction as /apply's intakeRateLimiter (application/ratelimit.ts):
		// the limiter never sees the submitted identifier.
		let clientKey = 'unknown';
		try {
			clientKey = event.getClientAddress();
		} catch {
			// Adapter contexts without a client address share one bucket.
		}
		if (!limiter.check(clientKey).allowed) return fail(429, RATE_LIMITED);

		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);

		const form = await event.request.formData();
		const identifierRaw = form.get('identifier');
		const password = form.get('password');
		if (typeof identifierRaw !== 'string' || identifierRaw.trim().length === 0) return fail(400, INVALID);
		if (typeof password !== 'string' || password.length === 0) return fail(400, INVALID);
		const identifier = normalizeEmail(identifierRaw);

		try {
			const session = await withTenant(tenantId, async (tx) => {
				const { session } = await authenticate(tx, tenantId, { handle: identifier, password });
				const member = await personByAuthUser(tx, session.userId);
				const memberships = member
					? await tx.select().from(membership).where(eq(membership.personId, member.id)).orderBy(membership.createdAt)
					: [];
				const latest = memberships.at(-1);
				if (!latest || !LOGIN_ELIGIBLE_STATUSES.has(latest.status)) {
					throw new MembershipInactiveError();
				}
				return session;
			});
			event.cookies.set(SESSION_COOKIE, session.id, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
			});
		} catch (error) {
			if (error instanceof MembershipInactiveError) return fail(403, MEMBERSHIP_INACTIVE);
			// EVERY AuthError — unknown handle or wrong password alike — maps to
			// the ONE constant body/status (module doc: no enumeration oracle).
			if (error instanceof AuthError) return fail(401, BAD_CREDENTIALS);
			console.error('[login] failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'login_failed' });
		}
		redirect(303, '/home');
	};
}

export const load: PageServerLoad = _createLoginLoad();

export const actions: Actions = {
	default: _createLoginAction(),
};
