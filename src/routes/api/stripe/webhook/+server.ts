/**
 * POST /api/stripe/webhook — the durable-inbox endpoint (TIN-3818).
 *
 * Deliberately thin: read the RAW bytes before anything can re-serialise
 * them, then hand off to `$lib/server/stripe/webhook.ts`, where the
 * verify → livemode-reject → persist+enqueue → ack order lives and is unit-
 * and integration-tested without SvelteKit in the loop.
 *
 * Fail-closed configuration: absent or live-shaped keys, and an absent tenant
 * id, all answer 503 WITHOUT acking — Stripe keeps redelivering until the
 * deployment is configured, which is exactly the durability contract. This is
 * an adapter-node surface (`prerender = false`, and POST has no static form).
 */

import { json } from '@sveltejs/kit';
import { readStripeConfig, readTenantId } from '$lib/server/stripe/config';
import { handleStripeWebhook } from '$lib/server/stripe/webhook';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	let config;
	try {
		config = readStripeConfig();
	} catch {
		// A live-shaped or half-set key. Say nothing detailed on a public route.
		return json({ received: false, error: 'stripe configuration refused' }, { status: 503 });
	}
	const tenantId = readTenantId();
	if (!config.configured || !tenantId) {
		return json({ received: false, error: 'stripe webhook not configured' }, { status: 503 });
	}

	// Raw bytes FIRST and only once — the signature is over exactly these.
	const rawBody = Buffer.from(await request.arrayBuffer());
	const result = await handleStripeWebhook(
		{ rawBody, signatureHeader: request.headers.get('stripe-signature') },
		{ webhookSecret: config.webhookSecret, tenantId },
	);
	return json(result.body, { status: result.status });
};
