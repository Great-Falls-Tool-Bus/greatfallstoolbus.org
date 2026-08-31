/**
 * `/contribution` — the OPTIONAL contribution offer (TIN-3818 presentation
 * contract; spec §5:230–248; ADR 0014 §5; member-projection-flow.mmd).
 *
 * DURABLE-CHOICE PLACEMENT: recording appears ONLY after approval and
 * activation (TIN-3818; TIN-4227). `/apply` may show the same canonical
 * shape as a read-only preview, but no preview value reaches this route.
 * Structurally a session cannot exist before activation (M1 creates it), and
 * this route ADDITIONALLY guards every load and action on an ACTIVE
 * membership — the projection diagram hangs the mutation off Active. This
 * route never touches the application aggregate.
 *
 * MEMBERSHIP IS NEVER WRITTEN HERE. The route reads membership state for the
 * guard and writes only the contribution aggregate — "Contribution amount,
 * zero contribution, failure, or nonpayment never grants, denies, or
 * suspends membership" (TIN-3440; spec §5:225). A checkout failure of any
 * kind leaves membership exactly as it was.
 *
 * THE RAILS DO NOT COLLAPSE (spec §5:243–248):
 *   - $0     → recorded state `zero`; NO Stripe customer, session, invoice,
 *              or subscription — the gateway is not even constructed
 *              (spec §5:233, asserted by a counting stub).
 *   - cash / check → recorded INTENT (`cash_pending`); the money itself is
 *              recorded by a finance-role operator through the append-only
 *              `finance_receipt` surface (rails, PR #174), never here, and
 *              never through anything Stripe-shaped.
 *   - card   → hosted Checkout handoff through the TEST-MODE-ONLY gateway
 *              (ADR 0016 §3.1, §5.1 — live gate CLOSED; the factory refuses
 *              non-test keys). The success redirect is informational only;
 *              durable state moves exclusively via the webhook inbox.
 *
 * Duplicate submissions CONVERGE: the agreement is one row per person
 * (unique tenant_id, person_id) and `chooseContribution` upserts, so a
 * replayed form lands on the same durable values (spec §6 "return or
 * converge on the original durable result").
 */

import { fail, redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { withTenant } from '$lib/server/db/tenant';
import type { DbTransaction } from '$lib/server/db/client';
import { membership } from '$lib/server/db/schema';
import { AuthError } from '$lib/server/auth';
import { personByAuthUser } from '$lib/server/membership/activate';
import { ContributionChoiceError, chooseContribution, getAgreement } from '$lib/server/contribution/agreement';
import { contributionOfferShape, memberContributionView, parseOfferForm } from '$lib/server/contribution/offer';
import { readStripeConfig, StripeConfigError } from '$lib/server/stripe/config';
import { createStripeGateway, StripeDisabledError, type StripeGateway } from '$lib/server/stripe/client';
import { createContributionCheckout, CheckoutRailError } from '$lib/server/stripe/checkout';
import type { PageServerLoad } from './$types';

export const prerender = false;

const UNAVAILABLE = { code: 'contribution_unavailable' } as const;
const NOT_AUTHENTICATED = { code: 'not_authenticated' } as const;
/** The offer is closed to this session: no active membership behind it. */
const NOT_OPEN = { code: 'not_open' } as const;

export interface ContributionSeams {
	env?: NodeJS.ProcessEnv;
	/** Test seam: the checkout gateway. Production builds it from runtime config, lazily, ONLY on the card path. */
	gateway?: StripeGateway;
}

/** True when card checkout is configured (test-mode keys present and well-shaped). Never throws. */
function stripeConfigured(env: NodeJS.ProcessEnv): boolean {
	try {
		return readStripeConfig(env).configured;
	} catch {
		return false;
	}
}

interface MemberContext {
	personId: string;
	membershipStatus: string;
}

/** Session → person → latest membership, inside the caller's unit of work. */
async function memberContext(tx: DbTransaction, authUserId: string): Promise<MemberContext | null> {
	const member = await personByAuthUser(tx, authUserId);
	if (!member) return null;
	const rows = await tx
		.select()
		.from(membership)
		.where(eq(membership.personId, member.id))
		.orderBy(membership.createdAt);
	const latest = rows.at(-1);
	if (!latest) return null;
	return { personId: member.id, membershipStatus: latest.status };
}

export function _createContributionLoad(seams: ContributionSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, eligible: false as const };
		}
		const session = event.locals.authSession;
		if (!session) {
			return { available: true as const, authenticated: false as const, eligible: false as const };
		}
		try {
			return await withTenant(tenantId, async (tx) => {
				const member = await memberContext(tx, session.userId);
				if (!member || member.membershipStatus !== 'active') {
					// Closed shape, no detail: the offer either is open to this
					// session or it is not (choices only after approval).
					return { available: true as const, authenticated: true as const, eligible: false as const };
				}
				const agreement = await getAgreement(tx, member.personId);
				return {
					available: true as const,
					authenticated: true as const,
					eligible: true as const,
					offer: contributionOfferShape(),
					contribution: memberContributionView(agreement),
					cardAvailable: stripeConfigured(env),
					// Informational only — reading it changes nothing durable.
					checkoutCancelled: event.url.searchParams.get('checkout') === 'cancelled',
				};
			});
		} catch (error) {
			console.error('[contribution] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, eligible: false as const };
		}
	};
}

export function _createChooseAction(seams: ContributionSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) return fail(503, UNAVAILABLE);
		const session = event.locals.authSession;
		if (!session) return fail(401, NOT_AUTHENTICATED);

		const form = await event.request.formData();

		let recorded: { personId: string; state: string };
		try {
			const submission = parseOfferForm(form);
			recorded = await withTenant(tenantId, async (tx) => {
				const member = await memberContext(tx, session.userId);
				if (!member) throw new AuthError(403, 'not_member', 'No member record for this session.');
				if (member.membershipStatus !== 'active') {
					// Not an active member — the offer is not open (ADR 0014 §5:147).
					throw new AuthError(403, 'not_open', 'The contribution step opens with an active membership.');
				}
				const agreement = await chooseContribution(tx, {
					tenantId,
					personId: member.personId,
					choice: submission.choice,
					helpRequested: submission.helpRequested,
				});
				return { personId: member.personId, state: agreement.state };
			});
		} catch (error) {
			if (error instanceof ContributionChoiceError) {
				// Server-side bounds/shape refusal — the boundary tests land here.
				return fail(400, { code: 'invalid_choice' as const });
			}
			if (error instanceof AuthError) {
				return error.code === 'not_open' ? fail(403, NOT_OPEN) : fail(error.status, { code: error.code });
			}
			console.error('[contribution] choose failed:', error instanceof Error ? error.message : error);
			return fail(500, { code: 'choose_failed' as const });
		}

		// Non-card rails end here: recorded, no processor anywhere. The $0 and
		// cash/check paths never construct a gateway — zero Stripe API calls
		// (spec §5:233), provable with a counting or throwing stub in the seam.
		if (recorded.state !== 'stripe_pending') {
			return { chosen: recorded.state };
		}

		// Card rail: hosted Checkout handoff, AFTER the choice committed. The
		// gateway is built lazily HERE so no other path can touch Stripe.
		let checkoutUrl: string;
		try {
			const gateway = seams.gateway ?? createStripeGateway(readStripeConfig(env));
			const submission = parseOfferForm(form); // parse is pure; reuse the validated choice
			const outcome = await createContributionCheckout(gateway, {
				personId: recorded.personId,
				choice: submission.choice,
				successUrl: new URL('/home?checkout=success', event.url.origin).toString(),
				cancelUrl: new URL('/contribution?checkout=cancelled', event.url.origin).toString(),
			});
			if (outcome.kind !== 'session' || !outcome.session.url) {
				console.error('[contribution] checkout session has no redirect URL');
				return fail(502, { code: 'checkout_failed' as const });
			}
			checkoutUrl = outcome.session.url;
		} catch (error) {
			// A payment failure of ANY kind leaves membership unchanged (spec §11;
			// ADR 0016 §3.2) — nothing here has touched the membership aggregate.
			// The recorded `stripe_pending` choice stands, honestly: chosen, not
			// yet established; the member may retry or pick another rail.
			if (error instanceof StripeDisabledError || error instanceof StripeConfigError) {
				return fail(503, { code: 'card_unavailable' as const });
			}
			if (error instanceof CheckoutRailError || error instanceof ContributionChoiceError) {
				return fail(400, { code: 'invalid_choice' as const });
			}
			console.error('[contribution] checkout failed:', error instanceof Error ? error.message : error);
			return fail(502, { code: 'checkout_failed' as const });
		}
		// The redirect target is Stripe's hosted page; the success URL it will
		// eventually bounce back to is informational only — the webhook inbox is
		// the only writer of durable contribution state (ADR 0016 §3).
		redirect(303, checkoutUrl);
	};
}

export const load: PageServerLoad = _createContributionLoad();

export const actions: Actions = {
	choose: _createChooseAction(),
};
