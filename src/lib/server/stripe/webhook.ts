/**
 * The webhook handler, framework-free (TIN-3818; spec §5, §10 Stripe row,
 * slices §3.2 — "verify-signature → persist raw → ack").
 *
 * Exact order, each step fail-closed:
 *
 *   1. Raw request bytes only. The route hands this function the body it read
 *      with `request.arrayBuffer()` — no framework body parser has touched it,
 *      because the signature is over the exact bytes Stripe signed.
 *   2. Verify the official signature. Invalid/missing → 400, nothing persisted.
 *   3. Reject anything not provably test-mode UNLESS the live gate is open
 *      (slices §3.2 step 3) → 400, nothing persisted. Missing `livemode`
 *      fails closed. Independent of the client-factory refusal (gate.ts
 *      explains the two-refusal design).
 *   4. One transaction: insert raw event (dedupe on the PK) + enqueue the
 *      projection job. Commit.
 *   5. 2xx. A duplicate delivery also 2xxes — Stripe's redelivery contract is
 *      satisfied by durability, and the original delivery owns the projection.
 *
 * Processing happens elsewhere (`project.ts`, behind S3's dispatcher); this
 * path does the minimum durable work and acks.
 */

import { withTenant } from '../db/tenant';
import { verifyWebhookSignature, type StripeWebhookEvent } from './client';
import type { StripeWebhookSecret } from './config';
import { testModeOnly } from './gate';
import { ingestStripeEvent, type IngestResult } from './inbox';

export interface WebhookRequest {
	/** The EXACT raw body bytes. Never a re-serialisation. */
	rawBody: string | Buffer;
	/** The `Stripe-Signature` header, or null when absent. */
	signatureHeader: string | null;
}

export interface WebhookDeps {
	webhookSecret: StripeWebhookSecret;
	tenantId: string;
	/** Seam for unit tests; defaults to the real withTenant + inbox write. */
	persist?: (event: StripeWebhookEvent) => Promise<IngestResult>;
}

export interface WebhookResponse {
	status: 200 | 400;
	body: { received: boolean; error?: string };
}

export async function handleStripeWebhook(request: WebhookRequest, deps: WebhookDeps): Promise<WebhookResponse> {
	if (!request.signatureHeader) {
		return { status: 400, body: { received: false, error: 'missing Stripe-Signature header' } };
	}

	let event: StripeWebhookEvent;
	try {
		event = verifyWebhookSignature(request.rawBody, request.signatureHeader, deps.webhookSecret);
	} catch {
		// The verification error's message is not echoed: it can quote header
		// internals, and a 400 body needs no forensic detail.
		return { status: 400, body: { received: false, error: 'signature verification failed' } };
	}

	if (!testModeOnly(event.livemode)) {
		// Second refusal of the pair, and it CONSULTS THE GATE (gate.ts, findings
		// B4/S1): only a literal `livemode: false` passes while the gate is
		// closed — a missing or malformed field is treated as live, never as
		// test. 4xx and no state change (slices §1.11).
		return { status: 400, body: { received: false, error: 'live-mode events are rejected: the live gate is closed' } };
	}

	const persist =
		deps.persist ??
		((verified: StripeWebhookEvent) =>
			withTenant(deps.tenantId, (tx) => ingestStripeEvent(tx, { tenantId: deps.tenantId, event: verified })));

	await persist(event);
	// Inserted or duplicate, the event is durable: ack.
	return { status: 200, body: { received: true } };
}
