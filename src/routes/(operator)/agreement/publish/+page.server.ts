/**
 * `/agreement/publish` — the operator agreement-publish route (TIN-3440
 * slice S13; ratification: operator interview 2026-08-22, register L73:
 * "S13 = FULL operator HTTP route for publishing agreement versions").
 *
 * `src/lib/server/membership/agreement.ts` has shipped `publishAgreementVersion`
 * since S6 with the note that S6 deliberately ships no route for it — every
 * caller until now has been a test. This route is that missing surface.
 *
 * AUTH MODEL — READ THIS BEFORE TOUCHING THE GUARD ORDER. The ratified role
 * model (`decisions/0018`) is exactly `member`/`keyholder`/`finance`; there is
 * no `operator` role, and adding one would contradict that ratification. This
 * route instead requires a live `keyholder` grant (`requireKeyholder`, the S5
 * precedent, checked in the SAME unit of work as everything it authorizes)
 * PLUS an env-pinned allowlist of person ids (`isAllowlistedOperator`,
 * `src/lib/server/membership/operator-allowlist.ts`) — configuration on top
 * of an existing role, not a fourth role. `GFTB_OPERATOR_PERSON_IDS` unset
 * fails EVERY caller closed, including a real keyholder. See that module's
 * header for the full grounding trail and the PR body's Authority table.
 *
 * PUBLISHING DOES NOT OPEN INTAKE. `/apply`'s gate is the source-level
 * `AGE_ATTESTATION_TEXT` constant read in `src/lib/server/application/attestation.ts`
 * (`src/routes/apply/+page.server.ts` load) — a code edit, not a data row.
 * `agreement_version` rows are consumed only by `/assent` (S6) and this
 * route's own preview; nothing this route does can flip `intakeOpen()`.
 *
 * THE REQUIRED CONFIRMATION STEP is fresh password reauthentication
 * (`reauthenticate`, TIN-3440: "Sensitive keyholder actions require fresh
 * password reauthentication" — the exact `/remove` mechanic, S7 precedent)
 * PLUS an explicit "I understand this cannot be undone" checkbox, re-checked
 * server-side (HTML `required` is not trusted alone — a raw POST bypasses
 * it). Publishing a version is at least as consequential as a forced
 * removal: every future assent binds to whatever text lands here.
 *
 * DOUBLE-SUBMIT SAFETY, TWO LAYERS:
 *   1. `expectedNextVersionId` — a hidden field carrying the version number
 *      the operator SAW when the page loaded. The action re-derives the
 *      actual next id inside the same transaction and refuses (409
 *      `stale_preview`) if it moved — the common case (sequential
 *      double-click, or someone else published in between) never reaches the
 *      insert at all.
 *   2. `AgreementVersionRaceError` — the rarer TRUE concurrent-transaction
 *      race (two requests computing the same `max + 1` before either
 *      commits) is decided by the database's own primary key
 *      (`ON CONFLICT DO NOTHING` in `agreement.ts`), never by application
 *      logic. Either layer alone is provably sufficient; both are kept
 *      because layer 1 is deterministic and layer 2 is the DB-level proof
 *      the task explicitly asks for.
 * Publishing the SAME body twice on purpose (not a double-submit) is not
 * deduplicated — the ratified scheme (decisions/0018 item 3) is a
 * monotonically increasing id with no uniqueness on body content, so two
 * intentional publishes of identical text legitimately create two versions.
 *
 * THE ACTION IS BUILT BY A FACTORY, the S4/S5 precedent, so the integration
 * suite drives the real request path with injected seams.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { AuthError, SESSION_COOKIE, reauthenticate, type AuthSession } from '$lib/server/auth';
import { requireKeyholder } from '$lib/server/application/claim';
import {
	AgreementVersionRaceError,
	previewNextAgreementVersionId,
	publishAgreementVersion,
} from '$lib/server/membership/agreement';
import { isAllowlistedOperator } from '$lib/server/membership/operator-allowlist';
import { createRateLimiter, type RateLimiter } from '$lib/server/application/ratelimit';
import type { PageServerLoad } from './$types';

export const prerender = false;

/**
 * Constant refusal bodies — one per class, never echoing submitted content.
 * `not_operator` (403) is thrown as `AuthError` and mapped generically below
 * (the same `error.code` passthrough `/remove` uses), so it has no separate
 * constant here.
 */
const NOT_AUTHENTICATED = { code: 'not_authenticated' } as const;
const UNAVAILABLE = { code: 'agreement_publish_unavailable' } as const;
const RATE_LIMITED = { code: 'rate_limited' } as const;

/**
 * ASSUMPTION — no ratified figure exists for this route (same posture as
 * `INTAKE_RATE_LIMIT_*` and `REAUTH_WINDOW_MS`: named, injectable,
 * resolver Jess). Deliberately tighter than the public intake limiter: this
 * is a rare, deliberate, already-authenticated-and-allowlisted operator
 * action, not a public endpoint absorbing anonymous traffic.
 */
export const _PUBLISH_RATE_LIMIT_MAX = 5;
export const _PUBLISH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const defaultPublishRateLimiter: RateLimiter = createRateLimiter({
	max: _PUBLISH_RATE_LIMIT_MAX,
	windowMs: _PUBLISH_RATE_LIMIT_WINDOW_MS,
});

/** 409-shaped: the version number the form was built against is stale. */
export class _StaleAgreementPreviewError extends Error {
	readonly expected: number;
	readonly actual: number;
	constructor(expected: number, actual: number) {
		super('The previewed version number is stale; reload and retry.');
		this.name = 'StaleAgreementPreviewError';
		this.expected = expected;
		this.actual = actual;
	}
}

export interface Operator {
	personId: string;
	session: AuthSession;
}

/**
 * The actor behind this request, or null for anonymous. Mirrors
 * `src/routes/(keyholder)/review/reviewer.ts`'s `resolveReviewer` exactly —
 * the same interim session→person-id mapping ASSUMPTION (S6 hand-off note),
 * duplicated in three lines here rather than imported across route groups so
 * this route does not couple to `(keyholder)/review`'s internal module.
 * Also carries the raw session (`/remove` needs it for `reauthenticate`).
 * AUTHORIZATION IS NOT DECIDED HERE — see the header note; both the
 * keyholder grant and the operator allowlist are checked inside the action's
 * own `withTenant` unit of work.
 */
function resolveOperator(event: RequestEvent): Operator | null {
	const session = event.locals.authSession;
	if (!session) return null;
	return { personId: session.userId, session };
}

export interface PublishSeams {
	env?: NodeJS.ProcessEnv;
	limiter?: RateLimiter;
}

export function _createPublishLoad(seams: PublishSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return {
				available: false as const,
				authenticated: false as const,
				authorized: false as const,
				nextVersionId: null,
			};
		}
		const operator = resolveOperator(event);
		if (!operator) {
			return {
				available: true as const,
				authenticated: false as const,
				authorized: false as const,
				nextVersionId: null,
			};
		}
		try {
			const nextVersionId = await withTenant(tenantId, async (tx) => {
				await requireKeyholder(tx, operator.personId);
				if (!isAllowlistedOperator(operator.personId, env)) {
					throw new AuthError(403, 'not_operator', 'This action requires an allowlisted operator.');
				}
				return previewNextAgreementVersionId(tx);
			});
			return {
				available: true as const,
				authenticated: true as const,
				authorized: true as const,
				nextVersionId,
			};
		} catch (error) {
			// A session that is not a keyholder, or a keyholder not on the
			// allowlist, both read as "authorized: false" — the page explains
			// nothing more specific than that (non-disclosure, the S5/S8
			// precedent); the ACTION returns the explicit 403 code.
			console.error('[agreement/publish] load refused:', error instanceof Error ? error.message : error);
			return {
				available: true as const,
				authenticated: true as const,
				authorized: false as const,
				nextVersionId: null,
			};
		}
	};
}

export function _createPublishAction(seams: PublishSeams = {}) {
	const env = seams.env ?? process.env;
	const limiter = seams.limiter ?? defaultPublishRateLimiter;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);

		const operator = resolveOperator(event);
		if (!operator) return fail(401, NOT_AUTHENTICATED);

		// Keyed by actor first, address second (best-effort) — this route is
		// never anonymous, so keying purely by address (the /apply pattern)
		// would let one operator session hop addresses to reset the window.
		let clientKey = operator.personId;
		try {
			clientKey = `${operator.personId}:${event.getClientAddress()}`;
		} catch {
			// Adapter contexts without a client address: key by person id alone.
		}
		if (!limiter.check(clientKey).allowed) return fail(429, RATE_LIMITED);

		const form = await event.request.formData();
		const body = form.get('body');
		const effectiveFromRaw = form.get('effectiveFrom');
		const confirm = form.get('confirm');
		const password = form.get('password');
		const expectedNextVersionIdRaw = form.get('expectedNextVersionId');

		if (typeof body !== 'string' || body.trim().length === 0) {
			return fail(400, { code: 'body_required' as const });
		}
		if (confirm !== 'on' && confirm !== 'true') {
			return fail(400, { code: 'confirmation_required' as const });
		}
		if (typeof password !== 'string' || password.length === 0) {
			return fail(401, { code: 'reauth_required' as const });
		}
		let effectiveFrom: Date | undefined;
		if (typeof effectiveFromRaw === 'string' && effectiveFromRaw.trim().length > 0) {
			effectiveFrom = new Date(effectiveFromRaw);
			if (Number.isNaN(effectiveFrom.getTime())) {
				return fail(400, { code: 'invalid_effective_from' as const });
			}
		}
		const expectedNextVersionId =
			typeof expectedNextVersionIdRaw === 'string' ? Number.parseInt(expectedNextVersionIdRaw, 10) : NaN;
		if (Number.isNaN(expectedNextVersionId)) {
			return fail(400, { code: 'expected_version_required' as const });
		}

		try {
			const result = await withTenant(tenantId, async (tx) => {
				await requireKeyholder(tx, operator.personId);
				if (!isAllowlistedOperator(operator.personId, env)) {
					throw new AuthError(403, 'not_operator', 'This action requires an allowlisted operator.');
				}
				// The confirmation step: verify the password fresh and rotate the
				// session (the /remove mechanic) inside this same unit of work.
				const rotated = await reauthenticate(tx, tenantId, operator.session, password);
				// Double-submit safety layer 1 (see header): the form's snapshot of
				// "what publishing right now would produce" must still hold.
				const actualNextVersionId = await previewNextAgreementVersionId(tx);
				if (actualNextVersionId !== expectedNextVersionId) {
					throw new _StaleAgreementPreviewError(expectedNextVersionId, actualNextVersionId);
				}
				// Double-submit safety layer 2 (see header): the database's own
				// primary key, not this check, is the actual guarantee.
				const version = await publishAgreementVersion(tx, { body: body.trim(), effectiveFrom });
				return { version, rotated };
			});
			event.cookies.set(SESSION_COOKIE, result.rotated.id, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
			});
			return {
				published: true as const,
				version: result.version.id,
				bodySha256: result.version.bodySha256,
				effectiveFrom: result.version.effectiveFrom.toISOString(),
			};
		} catch (error) {
			if (error instanceof AuthError) return fail(error.status, { code: error.code });
			if (error instanceof _StaleAgreementPreviewError) {
				return fail(409, { code: 'stale_preview' as const, nextVersionId: error.actual });
			}
			if (error instanceof AgreementVersionRaceError) {
				return fail(409, { code: 'version_race' as const });
			}
			console.error('[agreement/publish] action failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'publish_failed' as const });
		}
	};
}

export const load: PageServerLoad = _createPublishLoad();

export const actions: Actions = {
	default: _createPublishAction(),
};
