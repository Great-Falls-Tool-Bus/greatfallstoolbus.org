/**
 * `/logout` — session-destroying logout (TIN-3440 slice S12; sitting-2 QA
 * gap closure, register L70). No such route existed before this slice
 * (grep-verified across the tree; `revokeSession`'s own doc comment in
 * session.ts already says "(logout)" — S2 built the primitive, nothing
 * called it as a route until now).
 *
 * SAME POST-ONLY, GET-CONFIRMS SHAPE AS `/apply/withdraw`: GET renders a
 * confirm button and mutates nothing (a prefetcher or accidental navigation
 * must not silently end a session, the same reasoning `/apply/withdraw`'s
 * doc comment gives for not burning a token on prefetch); POST revokes the
 * presented session through the S2 door's `revokeSession` — the SAME
 * primitive `setPassword` uses to kill stale sessions on a reset — and
 * clears the cookie. Idempotent by construction: `revokeSession` returns
 * `false` for an absent/already-dead session rather than throwing
 * (session.ts), so a replayed or double-submitted logout still ends in
 * "logged out," never an error.
 *
 * FAIL-CLOSED ON THE CLIENT, FAIL-OPEN ON THE SERVER ROW: the cookie is
 * cleared unconditionally, before any database work, so an unconfigured
 * runtime or a transient DB error can never strand a browser holding a
 * cookie it believes is still valid — the same fail-closed-anonymously
 * posture `hooks.server.ts` documents for session resolution, applied to the
 * write side.
 */

import { redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { SESSION_COOKIE, revokeSession } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const prerender = false;

export interface LogoutSeams {
	env?: NodeJS.ProcessEnv;
}

export function _createLogoutAction(seams: LogoutSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const sessionId = event.cookies.get(SESSION_COOKIE);
		// Cleared FIRST, unconditionally — see module doc.
		event.cookies.delete(SESSION_COOKIE, { path: '/' });

		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (sessionId && tenantId && env.DATABASE_URL?.trim()) {
			try {
				await withTenant(tenantId, (tx) => revokeSession(tx, tenantId, sessionId));
			} catch (error) {
				// The browser already looks logged out (cookie gone above); a DB
				// hiccup revoking the server-side row must not present as a failed
				// logout (module doc).
				console.error('[logout] revoke failed:', error instanceof Error ? error.message : error);
			}
		}
		redirect(303, '/');
	};
}

export const load: PageServerLoad = (event) => ({
	authenticated: Boolean(event.locals.authSession),
});

export const actions: Actions = {
	default: _createLogoutAction(),
};
