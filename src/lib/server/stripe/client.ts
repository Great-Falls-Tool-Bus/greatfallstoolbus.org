/**
 * The Stripe client factory (TIN-3818; slices §1.11).
 *
 * "The Stripe client factory returns a throwing stub absent the operator
 * decision record" — narrowed for this TEST-MODE-ONLY slice to: absent
 * test-mode keys, every gateway method throws `StripeDisabledError` BEFORE any
 * network I/O.
 *
 * BRANDED TYPES ERASE, SO THE FACTORY RE-CHECKS AT RUNTIME (adversarial-review
 * finding B3 on PR #174). `StripeTestSecretKey` proves the value passed
 * through `readStripeConfig` only to code that stays inside the type system;
 * an `as` cast, a deserialized config, or any future caller bypasses it. The
 * construction boundary below therefore re-validates the whole-string
 * test-mode shape itself — and it does so BY CONSULTING THE LIVE GATE
 * (finding B4): a non-test key is admitted only when `liveGateOpen()` is
 * true, which nothing in this repository can make happen. That makes the
 * frozen gate constant the single deciding input, not decoration.
 *
 * App code depends on the narrow `StripeGateway` interface, never on the SDK
 * class — that is what lets the fixture replay gateway (`./fixtures.ts`) stand
 * in for the network in every keyless test and lets a counting stub prove the
 * "$0 issues zero Stripe calls" row.
 */

import Stripe from 'stripe';
import {
	SECRET_KEY_SHAPE,
	StripeConfigError,
	WEBHOOK_SECRET_SHAPE,
	type StripeRuntimeConfig,
	type StripeWebhookSecret,
} from './config';
import { liveGateOpen, LIVE_STRIPE_GATE } from './gate';

/** Thrown by the keyless stub. Reaching this in production means checkout was offered without keys. */
export class StripeDisabledError extends Error {
	constructor(reason: string) {
		super(`Stripe is disabled: ${reason}`);
	}
}

export interface CheckoutSessionSummary {
	id: string;
	url: string | null;
	livemode: boolean;
}

export interface PortalSessionSummary {
	url: string;
	livemode: boolean;
}

export interface SubscriptionSummary {
	id: string;
	status: string;
	livemode: boolean;
	metadata: Record<string, string>;
}

/** The narrow surface app code may touch. Hosted Checkout and Portal only — the app never accepts card data (spec §5). */
export interface StripeGateway {
	createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<CheckoutSessionSummary>;
	createPortalSession(params: Stripe.BillingPortal.SessionCreateParams): Promise<PortalSessionSummary>;
	retrieveSubscription(subscriptionId: string): Promise<SubscriptionSummary>;
}

/** Every method throws before any I/O. The keyless default. */
export function createDisabledGateway(reason: string): StripeGateway {
	const refuse = (): never => {
		throw new StripeDisabledError(reason);
	};
	return {
		createCheckoutSession: async () => refuse(),
		createPortalSession: async () => refuse(),
		retrieveSubscription: async () => refuse(),
	};
}

/**
 * Build the gateway from runtime config. Unconfigured → throwing stub.
 * Configured → the official SDK over the PROVEN-test-mode key.
 */
export function createStripeGateway(config: StripeRuntimeConfig): StripeGateway {
	if (!config.configured) {
		return createDisabledGateway(config.reason);
	}
	// Runtime re-check of what the brand only promises at compile time: with
	// the gate closed, ONLY a whole-string sk_test_ key can construct a client.
	// `liveGateOpen()` is consulted first so the gate is load-bearing — were the
	// operator's row-7 decision ever wired in and true, this refusal (and only
	// this refusal) would stand down.
	if (!liveGateOpen() && !SECRET_KEY_SHAPE.test(config.secretKey)) {
		throw new StripeConfigError(
			`refusing to construct a Stripe client: the secret key is not whole-string test-mode ` +
				`shaped and the live gate is closed (${LIVE_STRIPE_GATE.reason})`,
		);
	}
	const stripe = new Stripe(config.secretKey, {
		// The SDK's pinned API version (its type default). Not overridden here:
		// a hand-pinned string drifts, and fixtures record their own api_version.
		maxNetworkRetries: 2,
	});
	return {
		async createCheckoutSession(params) {
			const session = await stripe.checkout.sessions.create(params);
			return { id: session.id, url: session.url, livemode: session.livemode };
		},
		async createPortalSession(params) {
			const session = await stripe.billingPortal.sessions.create(params);
			return { url: session.url, livemode: session.livemode };
		},
		async retrieveSubscription(subscriptionId) {
			const subscription = await stripe.subscriptions.retrieve(subscriptionId);
			return {
				id: subscription.id,
				status: subscription.status,
				livemode: subscription.livemode,
				metadata: (subscription.metadata ?? {}) as Record<string, string>,
			};
		},
	};
}

/**
 * Verify a webhook signature over the EXACT raw bytes Stripe signed and parse
 * the event (spec §5; slices §3.2 step 2). Purely local HMAC — no network, no
 * API key. The SDK instance below exists only because the verification helper
 * hangs off the class; its key is a synthetic test-prefixed placeholder that
 * can never be used, and is assembled at runtime so no key-shaped literal
 * exists in this public repository.
 *
 * The secret's shape is re-checked at runtime for the same reason the factory
 * re-checks the key (B3): the brand proves provenance only inside the type
 * system, and a verifier fed a non-`whsec_` string would otherwise happily
 * HMAC with it.
 */
const offlineVerifier = new Stripe('sk_test_' + 'offlinesignatureverifiernonetwork');

export type StripeWebhookEvent = Stripe.Event;

export function verifyWebhookSignature(
	rawBody: string | Buffer,
	signatureHeader: string,
	webhookSecret: StripeWebhookSecret,
): StripeWebhookEvent {
	if (!WEBHOOK_SECRET_SHAPE.test(webhookSecret)) {
		throw new StripeConfigError('refusing to verify: the webhook secret is not a whole-string whsec_ value');
	}
	return offlineVerifier.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}
