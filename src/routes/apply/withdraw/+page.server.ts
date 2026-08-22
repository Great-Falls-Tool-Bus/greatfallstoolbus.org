/**
 * `/apply/withdraw` — A8 `→ withdrawn` (TIN-3440 slice S5; spec §4; slices
 * §2.2 row 8).
 *
 * FENCE NOTE: `src/routes/apply/**` is S4's fence; S4's PR body RECORDED the
 * hand-off — "the A8 route can land with the slice that owns the
 * approve×withdraw race" — and this is that slice. Declared in the S5 PR's
 * fence table, not smuggled.
 *
 * Same shape as `/apply/verify`, for the same reasons: the emailed link is a
 * GET carrying `?token=…` that renders a confirm button and MUTATES NOTHING
 * (a mail scanner's prefetch must not burn a single-use credential, and must
 * certainly not withdraw an application); the POST consumes the token and
 * moves the application in one `withTenant` unit of work. The bearer token
 * from the A2 receipt email is the authorization — reachable from
 * `submitted`, before the address is even verified (slices §2.2 row 8).
 *
 * Refusals: every token problem is the one uniform 400 (`TokenRejectedError`
 * public message). A valid token whose application is already terminal — the
 * approve×withdraw race, lost — is a 409 with its own constant body: that
 * bearer legitimately holds standing on this application, and "already
 * decided" is their state to know, not an enumeration leak.
 */

import { fail, type Actions, type RequestEvent, type ActionFailure } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { IllegalTransitionError } from '$lib/server/application/claim';
import { withdrawApplication } from '$lib/server/application/decide';
import { TokenRejectedError } from '$lib/server/application/tokens';
import type { PageServerLoad } from './$types';

export const prerender = false;

const INVALID = { code: 'invalid_token' } as const;
const NOT_WITHDRAWABLE = { code: 'not_withdrawable' } as const;
const UNAVAILABLE = { code: 'intake_unavailable' } as const;

export interface WithdrawActionSeams {
	env?: NodeJS.ProcessEnv;
}

export type WithdrawActionResult = ActionFailure<{ code: string }> | { withdrawn: true };

export function _createWithdrawAction(seams: WithdrawActionSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent): Promise<WithdrawActionResult> => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);

		const form = await event.request.formData();
		const token = form.get('token');
		if (typeof token !== 'string' || token.trim().length === 0) return fail(400, INVALID);

		try {
			await withTenant(tenantId, (tx) => withdrawApplication(tx, { token: token.trim() }));
		} catch (error) {
			if (error instanceof TokenRejectedError) {
				// One body for every token refusal — the bearer learns nothing.
				return fail(400, INVALID);
			}
			if (error instanceof IllegalTransitionError) {
				// The race loser (spec §4: exactly one terminal transition
				// commits). Rolled back: the token is still unconsumed.
				return fail(409, NOT_WITHDRAWABLE);
			}
			console.error('[apply/withdraw] failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'withdrawal_failed' });
		}
		return { withdrawn: true };
	};
}

export const load: PageServerLoad = ({ url }) => ({
	// Rendered into the confirm form's hidden field only; absent → the page
	// explains the link is incomplete.
	token: url.searchParams.get('token') ?? null,
});

export const actions: Actions = {
	default: _createWithdrawAction(),
};
