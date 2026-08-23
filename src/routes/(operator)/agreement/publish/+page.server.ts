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

/**
 * ASSUMPTION — the sanity bound on `effectiveFrom`, no ratified figure
 * exists. Wide enough to never constrain legitimate backdating or
 * forward-dating, narrow enough to reject an obvious typo (a bare probe of
 * `1900-01-01T00:00` / `9999-12-31T23:59` is exactly what review E2 used to
 * show there was previously no bound at all). Resolver Jess.
 */
const EFFECTIVE_FROM_MIN_YEAR = 2020;
const EFFECTIVE_FROM_MAX_YEAR = 2100;

/**
 * The exact wire shape an HTML `<input type="datetime-local">` posts:
 * `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss` — NEVER an offset, NEVER a `Z`.
 *
 * REVIEW E2, THE DEFECT THIS GUARDS: per ECMAScript's Date Time String
 * Format, only the DATE-ONLY form (`YYYY-MM-DD`) parses as UTC; the
 * date-TIME form without an offset parses as the process's LOCAL time. A
 * plain `new Date(effectiveFromRaw)` therefore made the instant committed to
 * this append-only table a function of `TZ` at the moment the pod happened
 * to run in — measured end to end through the real action: one input,
 * `2026-08-30T09:00`, produced 09:00Z / 13:00Z / 00:00Z / 07:00Z under
 * UTC / America/New_York / Asia/Tokyo / Europe/Berlin respectively, a
 * 13-hour spread for the SAME operator keystrokes. `withTimezone: true` on
 * the column (`schema.ts`) cannot rescue this: by the time the value reaches
 * the insert, the JS `Date` already IS the wrong absolute instant — that flag
 * only controls how a CORRECT instant is stored, not the parse.
 *
 * THE REMEDY IS THE ONE THIS REPOSITORY ALREADY RULED ON AND BUILT, for the
 * READ side of the identical class of bug (`auth/adapter.ts` `parseDbInstant`,
 * S2's naive-timestamp fix, doc'd there in detail): treat a zoneless
 * timestamp string as UTC EXPLICITLY, never by falling through to the
 * platform's local-time string parser. Unlike `parseDbInstant` (which
 * accepts whatever the adapter handed back and appends `Z`), this is the
 * WRITE side and the input is operator-typed, so it additionally: rejects
 * anything that is not exactly this shape (an offset-bearing string is
 * refused, not honored — this field is documented UTC-only, not general
 * ISO 8601); rejects calendar overflow `Date.UTC` would otherwise silently
 * normalize (`2026-02-30` does not become March 2); and enforces the sanity
 * bound above. `production runs UTC end to end` (adapter.ts) is exactly why
 * this bug was invisible in every green gate: under UTC, `new Date(raw)` and
 * `Date.UTC(...)` agree, and `.toISOString()` on the receipt prints the
 * operator's typed string with a `Z` appended either way.
 */
const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parse an `effectiveFrom` form value as an explicit UTC instant, or `null`
 * if it is not exactly the `datetime-local` wire shape, is calendar-invalid,
 * or falls outside the sanity bound. TZ-INVARIANT BY CONSTRUCTION: every
 * component is read out of the string with a regex and assembled with
 * `Date.UTC`, which — unlike `new Date(string)` on a zoneless date-time
 * string — never consults the process's local time zone. Exported (not
 * inlined) so the unit lane can assert that invariance directly by flipping
 * `process.env.TZ` and re-parsing the identical input (E2's test trap: an
 * assertion built by re-deriving the expected instant with `new Date(raw)`
 * would itself be TZ-dependent and prove nothing).
 */
export function _parseEffectiveFromUTC(raw: string): Date | null {
	const match = DATETIME_LOCAL_RE.exec(raw.trim());
	if (!match) return null;
	const [, y, mo, d, h, mi, s] = match;
	const year = Number(y);
	if (year < EFFECTIVE_FROM_MIN_YEAR || year > EFFECTIVE_FROM_MAX_YEAR) return null;
	const month = Number(mo);
	const day = Number(d);
	const hour = Number(h);
	const minute = Number(mi);
	const second = s ? Number(s) : 0;
	const instant = Date.UTC(year, month - 1, day, hour, minute, second);
	const date = new Date(instant);
	// Date.UTC silently normalizes overflow (month 13 rolls into next year,
	// Feb 30 rolls into March) instead of refusing it — read the components
	// back and reject anything that didn't round-trip, rather than accept a
	// date nobody actually typed.
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day ||
		date.getUTCHours() !== hour ||
		date.getUTCMinutes() !== minute
	) {
		return null;
	}
	return date;
}

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

		// Keyed by actor first, address second (best-effort). This does NOT
		// buy hop-immunity — measured on the real limiter: hopping addresses
		// while holding the actor fixed still reaches `verifyPassword` every
		// time (200/200, zero 429s), because the address half of the key
		// changes with the hop. What the composite actually buys is per-actor
		// isolation behind a shared egress: two allowlisted operators sharing
		// one address/NAT/tunnel each get their own window rather than
		// exhausting a single address-keyed bucket for each other (the
		// `/apply` pattern, address-only, would do that here). Reword
		// deliberately narrow — see review nit 4.
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
			const parsed = _parseEffectiveFromUTC(effectiveFromRaw);
			if (parsed === null) {
				return fail(400, { code: 'invalid_effective_from' as const });
			}
			effectiveFrom = parsed;
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
