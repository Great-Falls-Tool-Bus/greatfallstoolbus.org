/**
 * The GATED live-test-mode row (TIN-3818): the one place the real Stripe test
 * API is touched, and only when the operator supplies a key.
 *
 * SKIPS unless `STRIPE_TEST_KEY` is set. CI never sets it, so this row is
 * always a skip there; Jess plugs a test key in from the operator secret
 * store (`../lab` sops — operator-only) to run the same checkout surface the
 * fixtures replay, against Stripe's real test mode:
 *
 *   STRIPE_TEST_KEY=sk_test_… pnpm run test:unit src/lib/server/stripe/live-testmode.test.ts
 *
 * FAIL-CLOSED, NOT SKIP-CLOSED, on a wrong-shaped key: a set-but-live key is
 * a failing test, never a silent skip — skipping would hide exactly the
 * misconfiguration this slice exists to make impossible.
 */

import { describe, expect, it } from 'vitest';
import { createContributionCheckout } from './checkout';
import { createStripeGateway } from './client';
import { readStripeConfig, SECRET_KEY_ENV, SECRET_KEY_TEST_PREFIX, WEBHOOK_SECRET_ENV } from './config';
import { FIXTURE } from './fixtures';

const testKey = process.env.STRIPE_TEST_KEY?.trim();

describe.runIf(Boolean(testKey))('live test-mode row (STRIPE_TEST_KEY present)', () => {
	it('refuses to run with anything but an sk_test_ key', () => {
		expect(testKey!.startsWith(SECRET_KEY_TEST_PREFIX), 'STRIPE_TEST_KEY must be a TEST-mode secret key').toBe(true);
	});

	it('creates a real test-mode Checkout session for a $10 monthly contribution', { timeout: 30_000 }, async () => {
		expect(testKey!.startsWith(SECRET_KEY_TEST_PREFIX)).toBe(true);
		const config = readStripeConfig({
			[SECRET_KEY_ENV]: testKey,
			// The webhook secret is not exercised by session creation; a
			// runtime-assembled placeholder satisfies the all-or-nothing config.
			[WEBHOOK_SECRET_ENV]: 'whsec_' + 'gated_live_row_placeholder',
		});
		const gateway = createStripeGateway(config);
		const outcome = await createContributionCheckout(gateway, {
			personId: FIXTURE.personId,
			choice: { kind: 'stripe', cadence: 'monthly', amountCents: 1000 },
			successUrl: 'https://greatfallstoolbus.org/?checkout=ok',
			cancelUrl: 'https://greatfallstoolbus.org/?checkout=back',
		});
		expect(outcome.kind).toBe('session');
		if (outcome.kind === 'session') {
			// TEST MODE, structurally: Stripe itself reports the session as
			// livemode false, because the key that made it cannot be live.
			expect(outcome.session.livemode).toBe(false);
			expect(outcome.session.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
		}
	});
});

describe.runIf(!testKey)('live test-mode row (gated)', () => {
	it('skips loudly: STRIPE_TEST_KEY is unset, fixtures carried every other row', () => {
		expect(testKey).toBeUndefined();
	});
});
