/**
 * `/apply` — the public application intake surface (TIN-3440 slice S4;
 * spec §4 A2 `submit`; spec §6 request contract).
 *
 * NOT PRERENDERED: this page carries a form action, and its content is
 * request-time state (whether intake is open). Under the default
 * adapter-static build the route is simply not emitted (svelte.config.js sets
 * `strict: false` + a 404 fallback); the production ADAPTER=node origin
 * serves it live — the same split `/discuss` uses.
 *
 * THE ACTION IS BUILT BY A FACTORY so the integration suite can drive the
 * real request path (429 shape, constant bodies) with injected seams while
 * production wires the defaults. Order of refusals, cheapest and least
 * revealing first:
 *   1. intake closed (sitting-2 item-1 text not yet ratified) → 503;
 *   2. rate limit by CLIENT ADDRESS (never by submitted address) → 429,
 *      one constant body — exceeding the limit leaks nothing about whether
 *      any address is known (S4 acceptance);
 *   3. runtime unconfigured (no tenant/database names) → 503;
 *   4. field validation → 400 naming failed MECHANICS only, no PII echo;
 *   5. success → the one constant `PUBLIC_RECEIPT` body, whether or not the
 *      address already has an application (spec §4 non-enumeration), with a
 *      duplicate Idempotency-Key converging on the original result (§6).
 */

import { fail, type Actions, type RequestEvent, type ActionFailure } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { AGE_ATTESTATION_TEXT, intakeOpen } from '$lib/server/application/attestation';
import {
	InvalidSubmissionError,
	PUBLIC_RECEIPT,
	submitApplication,
	validateSubmission,
} from '$lib/server/application/intake';
import { intakeRateLimiter, type RateLimiter } from '$lib/server/application/ratelimit';
import type { PageServerLoad } from './$types';

export const prerender = false;

/** Constant refusal bodies — identical for every caller and payload. */
const CLOSED = { code: 'intake_closed' } as const;
const UNAVAILABLE = { code: 'intake_unavailable' } as const;
const RATE_LIMITED = { code: 'rate_limited' } as const;

export interface ApplyActionSeams {
	open?: () => boolean;
	limiter?: RateLimiter;
	env?: NodeJS.ProcessEnv;
}

export type ApplyActionResult =
	ActionFailure<{ code: string; fields?: readonly string[] }> | { receipt: typeof PUBLIC_RECEIPT };

export function _createApplyAction(seams: ApplyActionSeams = {}) {
	const open = seams.open ?? intakeOpen;
	const limiter = seams.limiter ?? intakeRateLimiter;
	const env = seams.env ?? process.env;

	return async (event: RequestEvent): Promise<ApplyActionResult> => {
		if (!open()) return fail(503, CLOSED);

		// Keyed by the caller, before any parsing: the limiter never sees the
		// submitted address, so its refusal cannot encode address knowledge.
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
		const raw: Record<string, unknown> = {
			displayName: form.get('displayName') ?? '',
			email: form.get('email') ?? '',
			interestsHelpOffer: form.get('interestsHelpOffer') ?? '',
			tourAvailability: form.get('tourAvailability') ?? '',
			disclosures: form.get('disclosures') ?? '',
			ageAttested: form.get('ageAttested') === 'on' || form.get('ageAttested') === 'true',
		};
		const headerKey = event.request.headers.get('idempotency-key')?.trim();
		const formKey = form.get('idempotencyKey');
		const idempotencyKey = headerKey || (typeof formKey === 'string' && formKey.trim()) || undefined;
		if (idempotencyKey) raw.idempotencyKey = idempotencyKey;

		try {
			const validated = validateSubmission(raw);
			await withTenant(tenantId, (tx) => submitApplication(tx, validated));
		} catch (error) {
			if (error instanceof InvalidSubmissionError) {
				return fail(400, { code: 'invalid', fields: error.fields });
			}
			// Uniform server-refusal: no database shape or duplicate detail leaks.
			console.error('[apply] submission failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'submission_failed' });
		}
		return { receipt: PUBLIC_RECEIPT };
	};
}

export const load: PageServerLoad = () => ({
	intakeOpen: intakeOpen(),
	// null until the sitting-2 item-1 wording is ratified; the page renders the
	// checkbox only from this value, never from local copy.
	attestationText: AGE_ATTESTATION_TEXT ?? null,
});

export const actions: Actions = {
	default: _createApplyAction(),
};
