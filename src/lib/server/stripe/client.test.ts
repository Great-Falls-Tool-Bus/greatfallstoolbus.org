/**
 * The gateway factory and the offline signature path (TIN-3818).
 */

import { describe, expect, it } from 'vitest';
import {
	createDisabledGateway,
	createStripeGateway,
	signPayloadForTest,
	verifyWebhookSignature,
	StripeDisabledError,
} from './client';
import type { StripeWebhookSecret } from './config';
import { readFixtureEventRaw } from './fixtures';

const EPHEMERAL_WHSEC = ('whsec_' + 'ephemeral_unit_secret_0001') as StripeWebhookSecret;

describe('the keyless stub', () => {
	it('throws StripeDisabledError from every method before any I/O', async () => {
		const gateway = createDisabledGateway('unit-test reason');
		await expect(gateway.createCheckoutSession({ mode: 'subscription' })).rejects.toThrow(StripeDisabledError);
		await expect(gateway.createPortalSession({ customer: 'cus_x' })).rejects.toThrow(StripeDisabledError);
		await expect(gateway.retrieveSubscription('sub_x')).rejects.toThrow(StripeDisabledError);
	});

	it('is what the factory returns for an unconfigured runtime', async () => {
		const gateway = createStripeGateway({ configured: false, reason: 'nothing set' });
		await expect(gateway.retrieveSubscription('sub_x')).rejects.toThrow(/nothing set/);
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
});
