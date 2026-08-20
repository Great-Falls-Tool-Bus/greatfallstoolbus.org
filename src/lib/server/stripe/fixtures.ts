/**
 * Record/replay fixtures for the Stripe test-mode lifecycle (TIN-3818).
 *
 * The committed JSON under `./fixtures/` is the recorded half: six webhook
 * event bodies covering the spec §5 minimum event set, every one
 * `livemode: false` (a test asserts it). Signature headers are NOT committed —
 * they are minted at test time with an EPHEMERAL `whsec_` secret via
 * `signPayloadForTest`, so this public repository carries no secret-shaped
 * bytes and the signature tests still exercise the SDK's real HMAC path.
 *
 * The replay gateway is the playback half: a `StripeGateway` that answers
 * from these fixtures without a socket, so the whole checkout → webhook →
 * recorded lifecycle runs keyless. When `STRIPE_TEST_KEY` is present the
 * gated `live-testmode.test.ts` row runs the same surface against Stripe's
 * real test mode instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import type { StripeGateway, StripeWebhookEvent, SubscriptionSummary } from './client';

export const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * TEST-ONLY: mint a valid `Stripe-Signature` header for a payload — the same
 * SDK helper Stripe documents for offline webhook tests. It lives HERE, in
 * the fixture/test-support module, not in the production `client.ts`, so the
 * production surface exports no signature-minting capability
 * (adversarial-review note on PR #174). The SDK instance's key is a synthetic
 * placeholder assembled at runtime; the helper never touches the network.
 */
const testSigner = new Stripe('sk_test_' + 'fixturesignernonetwork');

export function signPayloadForTest(payload: string, webhookSecret: string): string {
	return testSigner.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
}

/** The cast of the recorded lifecycle. One person, one customer, one subscription. */
export const FIXTURE = Object.freeze({
	personId: '11111111-1111-4111-8111-111111111111',
	customerId: 'cus_gftbfixture01',
	subscriptionId: 'sub_gftbfixture01',
	checkoutSessionId: 'cs_test_gftbfixture01',
});

/** Filenames in lifecycle order: checkout → create → paid → failed → updated → deleted. */
export function listFixtureEventFiles(): string[] {
	return readdirSync(FIXTURES_DIR)
		.filter((name) => name.endsWith('.json'))
		.sort();
}

/** The EXACT committed bytes — what a webhook test signs and posts (signature is over raw bytes, spec §5). */
export function readFixtureEventRaw(filename: string): string {
	return readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

export function readFixtureEvent(filename: string): StripeWebhookEvent {
	return JSON.parse(readFixtureEventRaw(filename)) as StripeWebhookEvent;
}

export interface ReplayGatewayOptions {
	/** What `subscriptions.retrieve` reports — the lifecycle tests move this through active → past_due → active → canceled. */
	subscriptionStatus?: string;
}

export interface ReplayGateway extends StripeGateway {
	/** Every call, in order — the counting stub behind "$0 issues zero Stripe calls". */
	calls: Array<{ method: keyof StripeGateway; args: unknown[] }>;
}

/**
 * A `StripeGateway` that replays the recorded lifecycle. No sockets, no keys.
 * `calls` makes it double as the counting stub several acceptance rows need.
 */
export function createReplayGateway(options: ReplayGatewayOptions = {}): ReplayGateway {
	const calls: ReplayGateway['calls'] = [];
	const subscription: SubscriptionSummary = {
		id: FIXTURE.subscriptionId,
		status: options.subscriptionStatus ?? 'active',
		livemode: false,
		metadata: { gftb_person_id: FIXTURE.personId },
	};
	return {
		calls,
		async createCheckoutSession(...args) {
			calls.push({ method: 'createCheckoutSession', args });
			return {
				id: FIXTURE.checkoutSessionId,
				url: `https://checkout.stripe.com/c/pay/${FIXTURE.checkoutSessionId}`,
				livemode: false,
			};
		},
		async createPortalSession(...args) {
			calls.push({ method: 'createPortalSession', args });
			return {
				url: `https://billing.stripe.com/p/session/test_${FIXTURE.customerId}`,
				livemode: false,
			};
		},
		async retrieveSubscription(...args) {
			calls.push({ method: 'retrieveSubscription', args });
			return { ...subscription };
		},
	};
}
