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
 * PRESENTATION IS NOT CAPTURE. The load serves the canonical optional
 * contribution shape for a read-only application-page preview. The action
 * projects only application fields; preview controls are outside the form and
 * cannot create contribution state, a payment intent, Checkout, or a charge.
 * Durable contribution choices remain behind the active-member route.
 *
 * THE ACTION IS BUILT BY A FACTORY so the integration suite can drive the
 * real request path (429 shape, constant bodies) with injected seams while
 * production wires the defaults. Order of refusals, cheapest and least
 * revealing first:
 *   1. intake closed (operator has not opened `/apply` at launch yet;
 *      sitting-2 item-1's text is ratified — decisions/0018 — this is a
 *      launch gate, not a ratification gate) → 503;
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
import { contributionOfferShape } from '$lib/server/contribution/offer';
import {
	applicationSubmissionFromForm,
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
		const headerKey = event.request.headers.get('idempotency-key')?.trim();
		const formKey = form.get('idempotencyKey');
		const idempotencyKey = headerKey || (typeof formKey === 'string' && formKey.trim()) || undefined;
		// Closed projection: even a hostile client adding preview-shaped fields
		// cannot put money data into the application validator or aggregate.
		const raw = applicationSubmissionFromForm(form, idempotencyKey);

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
	// The wording is ratified (decisions/0018); this stays null until the
	// operator sets AGE_ATTESTATION_TEXT at launch. The page renders the
	// checkbox only from this value, never from local copy.
	attestationText: AGE_ATTESTATION_TEXT ?? null,
	// Pure presentation data. No member lookup, contribution row, gateway, or
	// processor call is reachable from this shape function.
	contributionPreview: contributionOfferShape(),
});

export const actions: Actions = {
	default: _createApplyAction(),
};
