/**
 * The Stripe client factory (TIN-3818; slices §1.11).
 *
 * "The Stripe client factory returns a throwing stub absent the operator
 * decision record" — narrowed for this TEST-MODE-ONLY slice to: absent
 * test-mode keys, every gateway method throws `StripeDisabledError` BEFORE any
 * network I/O. With keys present, the factory can only ever have been handed a
 * `StripeTestSecretKey` (the branded type `config.ts` mints exclusively for
 * `sk_test_`-prefixed values), so a live processor call is not constructible
 * from this repository's code.
 *
 * App code depends on the narrow `StripeGateway` interface, never on the SDK
 * class — that is what lets the fixture replay gateway (`./fixtures.ts`) stand
 * in for the network in every keyless test and lets a counting stub prove the
 * "$0 issues zero Stripe calls" row.
 */

import Stripe from 'stripe';
import { SECRET_KEY_TEST_PREFIX, type StripeRuntimeConfig, type StripeWebhookSecret } from './config';

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
	// `config.secretKey` is a StripeTestSecretKey: the only constructor for that
	// type is `readStripeConfig`, which throws on any non-`sk_test_` value.
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
 */
const offlineVerifier = new Stripe(`${SECRET_KEY_TEST_PREFIX}offline-signature-verifier-no-network`);

export type StripeWebhookEvent = Stripe.Event;

export function verifyWebhookSignature(
	rawBody: string | Buffer,
	signatureHeader: string,
	webhookSecret: StripeWebhookSecret,
): StripeWebhookEvent {
	return offlineVerifier.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

/** Test-only: produce a valid `Stripe-Signature` header for a payload. Same SDK code Stripe documents for offline tests. */
export function signPayloadForTest(payload: string, webhookSecret: string): string {
	return offlineVerifier.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
}
