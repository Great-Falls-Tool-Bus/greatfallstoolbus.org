/**
 * PROOF THAT GATEWAY CONSTRUCTION CONSULTS THE LIVE GATE (TIN-3818;
 * adversarial-review finding B4 on PR #174: "flipping LIVE_STRIPE_GATE.open
 * would change no behavior anywhere in the tree").
 *
 * The real gate is a frozen constant nothing in this repository can flip, so
 * causality is proved by module substitution: with `liveGateOpen` mocked to
 * `true`, the factory's non-test-key refusal stands down. Together with
 * `client.test.ts` (same input REFUSED under the real, closed gate) this pins
 * that the gate is the single deciding input of the refusal — load-bearing,
 * not decorative. This file is quarantined from the others so the mock never
 * leaks.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('./gate', async (importOriginal) => {
	const original = await importOriginal<typeof import('./gate')>();
	return { ...original, liveGateOpen: () => true };
});

const { createStripeGateway } = await import('./client');
const { StripeConfigError } = await import('./config');
type StripeTestSecretKey = import('./config').StripeTestSecretKey;
type StripeWebhookSecret = import('./config').StripeWebhookSecret;

describe('createStripeGateway consults liveGateOpen()', () => {
	it('the non-test-key refusal stands down if — and only if — the gate reports open', () => {
		const liveShaped = ('sk_' + 'live_' + 'gftbunitfixture0000000001') as StripeTestSecretKey;
		const whsec = ('whsec_' + 'ephemeralunitsecret0001') as StripeWebhookSecret;
		// Under the REAL closed gate this exact input throws StripeConfigError
		// (client.test.ts pins it). Under a mocked-open gate it constructs:
		// the gate, not the key string, decided.
		let gateway: unknown;
		expect(() => {
			gateway = createStripeGateway({ configured: true, mode: 'test', secretKey: liveShaped, webhookSecret: whsec });
		}).not.toThrow(StripeConfigError);
		expect(gateway).toBeTruthy();
	});
});
