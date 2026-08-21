/**
 * Projection decisions, keyless (TIN-3818; spec §5 out-of-order rule).
 * The database write path is covered by the integration suite; these rows pin
 * the DECISIONS: every lifecycle event retrieves current object state except
 * terminal deletion (adversarial-review finding B2 on PR #174 — the old
 * payload-trusting checkout path could resurrect a cancelled contribution,
 * and the old version of THIS file pinned that wrong behavior as green).
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
	it('RETRIEVES current state even for checkout completion — the payload is a snapshot, not the truth (B2)', async () => {
		const gateway = createReplayGateway({ subscriptionStatus: 'active' });
		const outcome = await projectionForEvent(readFixtureEvent('01-checkout-session-completed.json'), gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		expect(outcome).toMatchObject({ action: 'projected', state: 'stripe_active', personId: FIXTURE.personId });
	});

	it('CANNOT resurrect a cancelled contribution: a late/replayed checkout event converges to cancelled (B2)', async () => {
		// The recorded checkout payload says "complete"/paid — but the CURRENT
		// subscription is canceled, as after out-of-order or redelivered events.
		const gateway = createReplayGateway({ subscriptionStatus: 'canceled' });
		const outcome = await projectionForEvent(readFixtureEvent('01-checkout-session-completed.json'), gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		expect(outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
	});

	it('retrieves for subscription.created too — a stale created snapshot loses to current state (B2)', async () => {
		const gateway = createReplayGateway({ subscriptionStatus: 'past_due' });
		const outcome = await projectionForEvent(readFixtureEvent('02-customer-subscription-created.json'), gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['retrieveSubscription']);
		expect(outcome).toMatchObject({ action: 'projected', state: 'stripe_past_due' });
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

	it('treats deletion as terminal from the payload itself — the one state no retrieve can improve on', async () => {
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(readFixtureEvent('06-customer-subscription-deleted.json'), gateway);
		expect(outcome).toMatchObject({ action: 'projected', state: 'cancelled' });
		expect(gateway.calls).toEqual([]);
	});

	it('skips — never throws — on event types outside the minimum set and the two supplemental rows', async () => {
		const alien = { ...readFixtureEvent('03-invoice-paid.json'), type: 'customer.updated' };
		const outcome = await projectionForEvent(alien as never, createReplayGateway());
		expect(outcome.action).toBe('skipped');
	});

	it('leaves state untouched for an expired Checkout session — it is outside the minimum set by design', async () => {
		// checkout.session.expired names no subscription and matches no case in
		// the switch, so it falls to the same default-skip path as any other
		// unrecognised type — the acceptance row's "leaves durable state
		// untouched" is this absence of a case, not a dedicated refusal.
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(readFixtureEvent('08-checkout-session-expired.json'), gateway);
		expect(outcome.action).toBe('skipped');
		expect(gateway.calls).toEqual([]);
	});
});

describe('charge.refunded — the schema state a payload-skip left unreachable', () => {
	it('projects a FULLY refunded charge to refunded, resolving identity via Charge.customer -> findSubscriptionForCustomer', async () => {
		// The committed fixture carries an empty `metadata: {}` on the charge
		// itself (a real Charge object always has the field, but does not
		// inherit subscription metadata) and no client_reference_id (not a
		// Charge field) — the only way this test can resolve FIXTURE.personId is
		// through Charge.customer -> findSubscriptionForCustomer, which is
		// exactly what is under test (PR #185 review BLOCK-2: Charge has no
		// `subscription`/`invoice` field in the pinned SDK, so `customer` is the
		// only real link back to a subscription).
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(readFixtureEvent('07-charge-refunded.json'), gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['findSubscriptionForCustomer']);
		expect(outcome).toMatchObject({ action: 'projected', state: 'refunded', personId: FIXTURE.personId });
	});

	it('skips rather than resolving identity when the charge names a customer with no subscription on file', async () => {
		const orphan = {
			...readFixtureEvent('07-charge-refunded.json'),
			data: {
				object: { ...readFixtureEvent('07-charge-refunded.json').data.object, customer: 'cus_no_such_customer' },
			},
		};
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(orphan as never, gateway);
		expect(gateway.calls.map((c) => c.method)).toEqual(['findSubscriptionForCustomer']);
		expect(outcome.action).toBe('skipped');
	});

	it('treats a PARTIAL refund as a no-op — refunded is a terminal fact only a FULL refund asserts', async () => {
		const partial = {
			...readFixtureEvent('07-charge-refunded.json'),
			data: {
				object: {
					...readFixtureEvent('07-charge-refunded.json').data.object,
					amount_refunded: 400,
					refunded: false,
				},
			},
		};
		const gateway = createReplayGateway();
		const outcome = await projectionForEvent(partial as never, gateway);
		expect(outcome.action).toBe('skipped');
		// Never even reaches for identity — nothing to project.
		expect(gateway.calls).toEqual([]);
	});
});
