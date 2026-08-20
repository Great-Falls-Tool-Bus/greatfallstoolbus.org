/**
 * Projection decisions, keyless (TIN-3818; spec §5 out-of-order rule).
 * The database write path is covered by the integration suite; these rows pin
 * the DECISIONS: which events trust their payload, which retrieve the truth.
 */

import { describe, expect, it } from 'vitest';
import { createReplayGateway, readFixtureEvent, FIXTURE } from './fixtures';
import { projectionForEvent, stateForSubscriptionStatus } from './project';

describe('stateForSubscriptionStatus', () => {
	it('maps the Stripe statuses onto the spec §5 enum', () => {
		expect(stateForSubscriptionStatus('active')).toBe('stripe_active');
		expect(stateForSubscriptionStatus('trialing')).toBe('stripe_active');
		expect(stateForSubscriptionStatus('past_due')).toBe('stripe_past_due');
		expect(stateForSubscriptionStatus('unpaid')).toBe('stripe_past_due');
		expect(stateForSubscriptionStatus('canceled')).toBe('cancelled');
		expect(stateForSubscriptionStatus('incomplete')).toBe('stripe_pending');
		expect(stateForSubscriptionStatus('anything-else')).toBe('stripe_pending');
	});
});

describe('projectionForEvent', () => {
	it('projects checkout completion from the session’s own person reference, no retrieve needed', async () => {
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(readFixtureEvent('01-checkout-session-completed.json'), gateway);
		expect(outcome).toMatchObject({ action: 'projected', state: 'stripe_active', personId: FIXTURE.personId });
		expect(gateway.calls).toEqual([]);
	});

	it('RETRIEVES current object state for the order-ambiguous events instead of trusting the payload', async () => {
		// The recorded subscription.updated payload says past_due; hand the
		// gateway a CURRENT state of active, as if the recovery already happened
		// and this delivery is stale/out of order.
		const gateway = createReplayGateway({ subscriptionStatus: 'active' });
		const outcome = await projectionForEvent(readFixtureEvent('05-customer-subscription-updated.json'), gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		// The retrieved object is the truth — the stale payload's past_due loses.
		expect(outcome).toMatchObject({ action: 'projected', state: 'stripe_active' });
	});

	it('converges the failed-renewal and recovery invoices through the same retrieve-the-truth path', async () => {
		const failed = await projectionForEvent(
			readFixtureEvent('04-invoice-payment-failed.json'),
			createReplayGateway({ subscriptionStatus: 'past_due' }),
		);
		expect(failed).toMatchObject({ action: 'projected', state: 'stripe_past_due', personId: FIXTURE.personId });

		const recovered = await projectionForEvent(
			readFixtureEvent('03-invoice-paid.json'),
			createReplayGateway({ subscriptionStatus: 'active' }),
		);
		expect(recovered).toMatchObject({ action: 'projected', state: 'stripe_active', personId: FIXTURE.personId });
	});

	it('treats deletion as terminal from the payload itself', async () => {
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(readFixtureEvent('06-customer-subscription-deleted.json'), gateway);
		expect(outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
		expect(gateway.calls).toEqual([]);
	});

	it('skips — never throws — on event types outside the minimum set', async () => {
		const alien = { ...readFixtureEvent('03-invoice-paid.json'), type: 'charge.refunded' };
		const outcome = await projectionForEvent(alien as never, createReplayGateway());
		expect(outcome.action).toBe('skipped');
	});
});
