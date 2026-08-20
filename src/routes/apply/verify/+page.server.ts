/**
 * `/apply/verify` — A3 `submitted → email_verified` (TIN-3440 slice S4;
 * spec §4; slices §2.2 row 3).
 *
 * The emailed link is a GET carrying `?token=…`; GET renders a confirm
 * button and MUTATES NOTHING (mutations stay POST-only per the spec §6
 * request contract — and a mail scanner prefetching the link must not burn a
 * single-use credential). The POST action consumes the token and moves the
 * application in one `withTenant` unit of work.
 *
 * NON-ENUMERATING, UNIFORMLY: unknown, expired, replayed, and wrong-state
 * tokens all produce the same 400 body (`TokenRejectedError`'s one public
 * message); the plaintext token is never logged and never echoed into
 * markup beyond the form's own hidden field.
 *
 * RATE-LIMITED LIKE `/apply` (spec §6: "Public endpoints are rate-limited
 * and return non-enumerating responses"). 256-bit verify tokens make
 * enumeration cryptographically hopeless, so this is a DB-load/DoS
 * conformance edit, not a credential-guessing risk: an unbounded stream of
 * verify POSTs each buys a database transaction. The same caller-keyed
 * limiter `/apply` uses is wired here, checked before any parsing, denying
 * with one constant 429 body.
 */

import { fail, type Actions, type RequestEvent, type ActionFailure } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { verifyEmail } from '$lib/server/application/intake';
import { TokenRejectedError } from '$lib/server/application/tokens';
import { intakeRateLimiter, type RateLimiter } from '$lib/server/application/ratelimit';
import type { PageServerLoad } from './$types';

export const prerender = false;

const INVALID = { code: 'invalid_token' } as const;
const UNAVAILABLE = { code: 'intake_unavailable' } as const;
const RATE_LIMITED = { code: 'rate_limited' } as const;

export interface VerifyActionSeams {
	env?: NodeJS.ProcessEnv;
	limiter?: RateLimiter;
}

export type VerifyActionResult = ActionFailure<{ code: string }> | { verified: true };

export function _createVerifyAction(seams: VerifyActionSeams = {}) {
	const env = seams.env ?? process.env;
	const limiter = seams.limiter ?? intakeRateLimiter;

	return async (event: RequestEvent): Promise<VerifyActionResult> => {
		// Keyed by the caller, before any parsing — same non-enumerating shape
		// as the /apply action (never sees the token, so it cannot leak
		// anything about whether a presented token is valid).
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
		const token = form.get('token');
		if (typeof token !== 'string' || token.trim().length === 0) return fail(400, INVALID);

		try {
			await withTenant(tenantId, (tx) => verifyEmail(tx, { token: token.trim() }));
		} catch (error) {
			if (error instanceof TokenRejectedError) {
				// One body for every refusal reason — the bearer learns nothing.
				return fail(400, INVALID);
			}
			console.error('[apply/verify] failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'verification_failed' });
		}
		return { verified: true };
	};
}

export const load: PageServerLoad = ({ url }) => ({
	// Rendered into the confirm form's hidden field only; absent → the page
	// explains the link is incomplete.
	token: url.searchParams.get('token') ?? null,
});

export const actions: Actions = {
	default: _createVerifyAction(),
};
