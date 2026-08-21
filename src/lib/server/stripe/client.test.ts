/**
 * The gateway factory and the offline signature path (TIN-3818).
 *
 * The runtime-cast rows exist because branded types ERASE (adversarial-review
 * finding B3 on PR #174): the factory and the verifier must refuse hostile
 * values even when the type system was bypassed with `as`.
 */

import { describe, expect, it } from 'vitest';
import { createDisabledGateway, createStripeGateway, verifyWebhookSignature, StripeDisabledError } from './client';
import { StripeConfigError, type StripeTestSecretKey, type StripeWebhookSecret } from './config';
import { readFixtureEventRaw, signPayloadForTest } from './fixtures';

const EPHEMERAL_WHSEC = ('whsec_' + 'ephemeralunitsecret0001') as StripeWebhookSecret;

describe('the keyless stub', () => {
	it('throws StripeDisabledError from every method before any I/O', async () => {
		const gateway = createDisabledGateway('unit-test reason');
		await expect(gateway.createCheckoutSession({ mode: 'subscription' })).rejects.toThrow(StripeDisabledError);
		await expect(gateway.createPortalSession({ customer: 'cus_x' })).rejects.toThrow(StripeDisabledError);
		await expect(gateway.retrieveSubscription('sub_x')).rejects.toThrow(StripeDisabledError);
		await expect(gateway.findSubscriptionForCustomer('cus_x')).rejects.toThrow(StripeDisabledError);
	});

	it('is what the factory returns for an unconfigured runtime', async () => {
		const gateway = createStripeGateway({ configured: false, reason: 'nothing set' });
		await expect(gateway.retrieveSubscription('sub_x')).rejects.toThrow(/nothing set/);
	});
});

describe('the factory re-validates at RUNTIME — the brand alone is not trusted (B3)', () => {
	const whsec = EPHEMERAL_WHSEC;

	it('refuses a live-shaped key smuggled past the type system with a cast', () => {
		const liveKey = ('sk_' + 'live_' + 'gftbunitfixture0000000001') as StripeTestSecretKey;
		expect(() =>
			createStripeGateway({ configured: true, mode: 'test', secretKey: liveKey, webhookSecret: whsec }),
		).toThrow(StripeConfigError);
	});

	it('refuses a newline-smuggled key and a bare prefix, cast or not', () => {
		for (const bad of ['sk_test_ok\nsk_' + 'live_' + 'gftbreal000000', 'sk_test_']) {
			expect(() =>
				createStripeGateway({
					configured: true,
					mode: 'test',
					secretKey: bad as StripeTestSecretKey,
					webhookSecret: whsec,
				}),
			).toThrow(StripeConfigError);
		}
	});

	it('constructs for a whole-string test key', () => {
		const gateway = createStripeGateway({
			configured: true,
			mode: 'test',
			secretKey: ('sk_' + 'test_' + 'gftbunitfixture0000000001') as StripeTestSecretKey,
			webhookSecret: whsec,
		});
		expect(typeof gateway.createCheckoutSession).toBe('function');
	});
});

describe('signature verification over raw bytes', () => {
	it('round-trips a committed fixture body signed with an ephemeral secret', () => {
		const raw = readFixtureEventRaw('01-checkout-session-completed.json');
		const header = signPayloadForTest(raw, EPHEMERAL_WHSEC);
		const event = verifyWebhookSignature(raw, header, EPHEMERAL_WHSEC);
		expect(event.id).toBe('evt_gftb_fx_0001');
		expect(event.livemode).toBe(false);
	});

	it('rejects a tampered body carrying the original signature — no re-serialisation can hide it', () => {
		const raw = readFixtureEventRaw('01-checkout-session-completed.json');
		const header = signPayloadForTest(raw, EPHEMERAL_WHSEC);
		// Semantically identical JSON, different bytes: exactly what a body
		// parser + re-stringify would produce, and exactly what must fail.
		const reserialised = JSON.stringify(JSON.parse(raw));
		expect(() => verifyWebhookSignature(reserialised, header, EPHEMERAL_WHSEC)).toThrow();
	});

	it('rejects the right body signed with the wrong secret', () => {
		const raw = readFixtureEventRaw('01-checkout-session-completed.json');
		const header = signPayloadForTest(raw, 'whsec_' + 'someoneelse');
		expect(() => verifyWebhookSignature(raw, header, EPHEMERAL_WHSEC)).toThrow();
	});

	it('refuses to verify with a non-whsec secret even behind a branded cast (B3)', () => {
		const raw = readFixtureEventRaw('01-checkout-session-completed.json');
		const header = signPayloadForTest(raw, EPHEMERAL_WHSEC);
		for (const bad of ['not-a-secret', 'whsec_', 'whsec_ok\nwhsec_evil', 'sk_' + 'test_' + 'notawebhooksecret00']) {
			expect(() => verifyWebhookSignature(raw, header, bad as StripeWebhookSecret)).toThrow(StripeConfigError);
		}
	});
});
