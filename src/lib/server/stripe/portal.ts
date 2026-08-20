/**
 * Hosted Customer Portal initiation (TIN-3818; spec §5 "Hosted Checkout and
 * Customer Portal only").
 *
 * The portal is where a member cancels or changes a card — the app never
 * mutates a subscription itself and never sees card data. Cancellation and
 * refund CONSEQUENCES arrive exclusively through the webhook inbox
 * (`customer.subscription.updated`/`.deleted`); the portal redirect, like the
 * checkout success page, is informational.
 */

import type { PortalSessionSummary, StripeGateway } from './client';

export async function createContributionPortalSession(
	gateway: StripeGateway,
	input: { customerId: string; returnUrl: string },
): Promise<PortalSessionSummary> {
	return gateway.createPortalSession({
		customer: input.customerId,
		return_url: input.returnUrl,
	});
}
