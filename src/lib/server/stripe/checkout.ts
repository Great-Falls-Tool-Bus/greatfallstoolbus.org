/**
 * Hosted Checkout initiation (TIN-3818; spec §5 Stripe path, ADR 0014 §5).
 *
 * Hosted Checkout only — the app never accepts card data. The server creates
 * recurring `price_data` from the ALREADY-VALIDATED choice; any UI slider is
 * never payment authority. $0 short-circuits before the gateway exists to be
 * called: no Stripe customer, session, invoice, or subscription (spec §5),
 * proved by the counting stub in the tests.
 *
 * Copy rule (ADR 0014 §0.6, ADR 0016 §2): recipient-neutral, "contribution"
 * never "donation", no tax language.
 */

import { validateChoice, type ContributionChoice } from '../contribution/agreement';
import type { CheckoutSessionSummary, StripeGateway } from './client';

export class CheckoutRailError extends Error {}

export interface CheckoutRequest {
	personId: string;
	choice: ContributionChoice;
	successUrl: string;
	cancelUrl: string;
}

export type CheckoutOutcome =
	| { kind: 'zero'; detail: 'zero-dollar choice — no Stripe object exists or will' }
	| { kind: 'session'; session: CheckoutSessionSummary };

/**
 * Start a hosted Checkout for a validated Stripe-rail choice.
 *
 * The success redirect is informational only; durable state moves exclusively
 * via the webhook inbox (spec §5 "Success-page redirects … never activate
 * durable state").
 */
export async function createContributionCheckout(
	gateway: StripeGateway,
	request: CheckoutRequest,
): Promise<CheckoutOutcome> {
	// Re-validate at the boundary: this module trusts no upstream caller.
	const choice = validateChoice(request.choice as { kind: string; cadence?: string; amountCents?: number });

	if (choice.kind === 'zero') {
		return { kind: 'zero', detail: 'zero-dollar choice — no Stripe object exists or will' };
	}
	if (choice.kind === 'cash' || choice.kind === 'check') {
		throw new CheckoutRailError(
			`the ${choice.kind} rail is recorded by an operator receipt, never through Stripe Checkout — rails do not collapse (spec §5)`,
		);
	}

	const session = await gateway.createCheckoutSession({
		mode: 'subscription',
		client_reference_id: request.personId,
		success_url: request.successUrl,
		cancel_url: request.cancelUrl,
		metadata: { gftb_person_id: request.personId },
		subscription_data: { metadata: { gftb_person_id: request.personId } },
		line_items: [
			{
				quantity: 1,
				price_data: {
					currency: 'usd',
					unit_amount: choice.amountCents,
					recurring: { interval: choice.cadence === 'monthly' ? 'month' : 'year' },
					product_data: {
						// Recipient-neutral by rule; "contribution", never "donation".
						name: choice.cadence === 'monthly' ? 'Monthly contribution' : 'Annual contribution',
					},
				},
			},
		],
	});

	return { kind: 'session', session };
}
