/**
 * `/assent` — M1 `assent_and_activate` (TIN-3440 slice S6; spec §4
 * "Activation requires an approved application, assent to the current
 * agreement version, password/session creation, and an audit commit";
 * slices §2.2 row 10).
 *
 * The decision email's activation link is a GET carrying `?token=…`; GET
 * renders the CURRENT agreement text and the password form and MUTATES
 * NOTHING (the /apply/verify posture: mutations are POST-only, and a mail
 * scanner prefetching the link must not burn the single-use credential —
 * peek, never consume). The POST action performs the whole of M1 in one
 * `withTenant` unit of work and sets the session cookie the activation
 * minted.
 *
 * THE FORM CARRIES THE VERSION IT SHOWS: `agreementVersionId` is a hidden
 * field bound to the version the page rendered, and the server re-checks it
 * against the CURRENT version inside the transaction — a version published
 * between render and submit turns the stale form into an explicit
 * `superseded_agreement` refusal, never a silent assent to text the person
 * did not read (ADR 0016 §2.3 separability; row 10 guard).
 *
 * NO AGREEMENT VERSION YET → HONESTLY UNAVAILABLE: until the operator
 * publishes the ratified version-1 text (sitting-2 item 3; gate row 4), the
 * page reports that activation is not open rather than showing draft copy —
 * agent-authored member-facing copy ships published:false/TODO only.
 */

import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { SESSION_COOKIE, AuthError } from '$lib/server/auth';
import {
	activateMembership,
	peekActivation,
	MembershipVersionConflictError,
	IllegalMembershipTransitionError,
	ActivationConflictError,
	MembershipNotFoundError,
} from '$lib/server/membership/activate';
import {
	NoAgreementVersionError,
	SupersededAgreementError,
	currentAgreementVersion,
} from '$lib/server/membership/agreement';
import { TokenRejectedError } from '$lib/server/application/tokens';
import type { PageServerLoad } from './$types';

export const prerender = false;

const INVALID = { code: 'invalid_token' } as const;
const UNAVAILABLE = { code: 'activation_unavailable' } as const;

export interface AssentSeams {
	env?: NodeJS.ProcessEnv;
}

/**
 * Minimal password rule — mechanics only; the member-facing password POLICY
 * copy is not ratified (S2's recorded posture, carried forward).
 *
 * NOT exported (review round 2, THE BLOCKER): SvelteKit's route-export
 * contract only permits `load, prerender, csr, ssr, trailingSlash, config,
 * actions, entries`, or names prefixed `_`. `svelte-kit`'s `analyse` build
 * pass — which `just check`'s `svelte-check`/`tsc` never runs — rejects any
 * other export and fails `just build` outright. Referenced only inside this
 * file (grep-verified), so file-private is both correct and sufficient.
 */
const MIN_PASSWORD_LENGTH = 12;

export function _createAssentLoad(seams: AssentSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const token = event.url.searchParams.get('token') ?? null;
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, token, agreement: null, tokenValid: false };
		}
		if (!token) {
			return { available: true as const, token: null, agreement: null, tokenValid: false };
		}
		try {
			return await withTenant(tenantId, async (tx) => {
				const peek = await peekActivation(tx, token);
				const current = await currentAgreementVersion(tx);
				return {
					available: true as const,
					token,
					tokenValid: peek.verdict === 'valid',
					agreement: current ? { id: current.id, body: current.body, bodySha256: current.bodySha256 } : null,
				};
			});
		} catch (error) {
			console.error('[assent] load refused:', error instanceof Error ? error.message : error);
			return { available: false as const, token, agreement: null, tokenValid: false };
		}
	};
}

export function _createActivateAction(seams: AssentSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);

		const form = await event.request.formData();
		const token = form.get('token');
		const password = form.get('password');
		const confirm = form.get('confirmPassword');
		const versionRaw = form.get('agreementVersionId');
		const assented = form.get('assent');

		if (typeof token !== 'string' || token.trim().length === 0) return fail(400, INVALID);
		// The assent checkbox is REQUIRED and unchecked by default — assent is
		// an act, never a form default (the S4 attestation posture).
		if (assented !== 'true') return fail(400, { code: 'assent_required' as const });
		if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
			return fail(400, { code: 'password_too_short' as const, minLength: MIN_PASSWORD_LENGTH });
		}
		if (password !== confirm) return fail(400, { code: 'password_mismatch' as const });
		const agreementVersionId = typeof versionRaw === 'string' ? Number.parseInt(versionRaw, 10) : Number.NaN;
		if (!Number.isInteger(agreementVersionId)) return fail(400, { code: 'agreement_version_required' as const });

		try {
			const result = await withTenant(tenantId, (tx) =>
				activateMembership(tx, { token: token.trim(), password, agreementVersionId }),
			);
			event.cookies.set(SESSION_COOKIE, result.session.id, {
				path: '/',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
			});
			return { activated: true as const, replayed: !result.activated };
		} catch (error) {
			if (error instanceof TokenRejectedError) return fail(400, INVALID);
			if (error instanceof NoAgreementVersionError) return fail(503, { code: 'no_agreement_version' as const });
			if (error instanceof SupersededAgreementError) return fail(409, { code: 'superseded_agreement' as const });
			if (error instanceof MembershipVersionConflictError) return fail(409, { code: 'version_conflict' as const });
			if (error instanceof IllegalMembershipTransitionError) return fail(409, { code: 'illegal_transition' as const });
			if (error instanceof ActivationConflictError) return fail(409, { code: 'activation_conflict' as const });
			if (error instanceof MembershipNotFoundError) return fail(404, { code: 'not_found' as const });
			if (error instanceof AuthError) return fail(error.status, { code: error.code });
			console.error('[assent] activation failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'activation_failed' as const });
		}
	};
}

export const load: PageServerLoad = _createAssentLoad();

export const actions: Actions = {
	default: _createActivateAction(),
};
