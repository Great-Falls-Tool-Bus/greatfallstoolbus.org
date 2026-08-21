/**
 * The committed record half of record/replay (TIN-3818): the fixture corpus
 * itself is under test, because a fixture that drifted live-shaped or
 * secret-bearing would poison every suite built on it.
 */

import { describe, expect, it } from 'vitest';
import { listFixtureEventFiles, readFixtureEvent, readFixtureEventRaw, createReplayGateway, FIXTURE } from './fixtures';

/** Spec §5's minimum event set, verbatim. */
const MINIMUM_EVENT_SET = [
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_failed',
];

/**
 * Two supplemental event types beyond the spec §5 minimum, each backing an
 * §1.11 acceptance row the minimum set alone does not exercise: a FULLY
 * refunded charge (row 8, "portal-driven cancellation and refund project
 * correctly" — `refunded` is otherwise dead/unreachable code) and an expired
 * Checkout session (row 6, "a cancelled Checkout … leaves durable state
 * untouched" — Stripe has no separate "cancelled" webhook; clicking Cancel
 * only redirects to `cancel_url` informationally, and `checkout.session.expired`
 * is the real mechanism for an abandoned session).
 */
const SUPPLEMENTAL_EVENT_TYPES = ['charge.refunded', 'checkout.session.expired'];

describe('the committed lifecycle corpus', () => {
	it('covers the spec §5 minimum event set, plus the two documented supplemental rows, exactly once each', () => {
		const types = listFixtureEventFiles().map((file) => readFixtureEvent(file).type);
		expect([...types].sort()).toEqual([...MINIMUM_EVENT_SET, ...SUPPLEMENTAL_EVENT_TYPES].sort());
	});

	it('is test-mode everywhere: every event and every nested object says livemode false', () => {
		for (const file of listFixtureEventFiles()) {
			const raw = readFixtureEventRaw(file);
			expect(raw, `${file} contains a livemode: true`).not.toMatch(/"livemode":\s*true/);
			expect(readFixtureEvent(file).livemode).toBe(false);
		}
	});

	it('has a unique event id per fixture', () => {
		const ids = listFixtureEventFiles().map((file) => readFixtureEvent(file).id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('carries no key-shaped bytes — this repository is public', () => {
		for (const file of listFixtureEventFiles()) {
			const raw = readFixtureEventRaw(file);
			expect(raw, `${file} contains a secret-shaped string`).not.toMatch(
				/\b(sk|rk|pk)_(test|live|prod)_[0-9a-zA-Z]{8,}/,
			);
			expect(raw).not.toMatch(/whsec_[0-9a-zA-Z]{8,}/);
		}
	});

	it('tells one coherent story: one person, one customer, one subscription', () => {
		for (const file of listFixtureEventFiles()) {
			const raw = readFixtureEventRaw(file);
			expect(raw).toContain(FIXTURE.customerId);
		}
	});
});

describe('the replay gateway', () => {
	it('answers checkout, portal, and retrieve from the recorded cast, counting every call', async () => {
		const gateway = createReplayGateway({ subscriptionStatus: 'past_due' });
		const session = await gateway.createCheckoutSession({ mode: 'subscription' });
		expect(session.id).toBe(FIXTURE.checkoutSessionId);
		expect(session.livemode).toBe(false);

		const subscription = await gateway.retrieveSubscription(FIXTURE.subscriptionId);
		expect(subscription.status).toBe('past_due');
		expect(subscription.metadata.gftb_person_id).toBe(FIXTURE.personId);

		const portal = await gateway.createPortalSession({ customer: FIXTURE.customerId });
		expect(portal.livemode).toBe(false);

		expect(gateway.calls.map((c) => c.method)).toEqual([
			'createCheckoutSession',
			'retrieveSubscription',
			'createPortalSession',
		]);
	});
});
