/**
 * The durable webhook inbox write path (TIN-3818; spec §5, slices §3.2).
 *
 * Contract order, which is load-bearing: verify signature over raw bytes
 * (caller — `webhook.ts`), reject livemode (caller), then IN ONE TRANSACTION
 * insert the raw event `on conflict do nothing` and — only if that insert
 * reported a row — enqueue the projection job. Commit, then 2xx. Stripe's
 * redelivery contract is satisfied by durability, not by processing; the
 * projector is a separate consumer (`./project.ts`).
 *
 * The composite primary key `(tenant_id, event_id)` is the deduplication
 * primitive: duplicate and concurrent redeliveries collapse to one row with no
 * application-level lock. On conflict, NO job is enqueued — the original
 * delivery already owed the projection, and the outbox's
 * `unique (tenant_id, kind, idempotency_key)` would reject a sibling anyway.
 *
 * Why the enqueue is inside the same transaction (slices §3.2): a 2xx-then-
 * enqueue ordering loses events for real — a crash between commit and enqueue
 * leaves a durable row no worker will claim, and Stripe, having its 2xx, never
 * redelivers. Same transaction, or the durability is theatre.
 *
 * The dispatcher that CLAIMS `stripe.project` jobs is S3's fence
 * (`src/lib/server/outbox/**`), not this file's; this module only writes the
 * row shape S1's `outbox_job` table already defines.
 */

import { createHash } from 'node:crypto';
import type { DbTransaction } from '../db/client';
import { outboxJob, stripeEventInbox } from '../db/schema';
import type { StripeWebhookEvent } from './client';

/** The outbox job kind the projection consumer claims. */
export const STRIPE_PROJECT_JOB_KIND = 'stripe.project';

/**
 * `outbox_job.aggregate_id` is a uuid; a Stripe event id is not. Derive a
 * STABLE uuid-shaped value from the event id so replays of one event map to
 * one aggregate id. Layout-only formatting of a sha256 prefix — uniqueness
 * comes from the hash, not from RFC-4122 semantics.
 */
export function uuidForStripeEvent(eventId: string): string {
	const hex = createHash('sha256').update(`gftb:stripe-event:${eventId}`).digest('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface IngestResult {
	/** False when this delivery was a duplicate and nothing was written. */
	inserted: boolean;
}

/**
 * Persist one verified, test-mode event and owe its projection — atomically.
 * Runs inside the `withTenant` transaction the webhook route opened, so RLS
 * scopes both writes to the configured tenant.
 */
export async function ingestStripeEvent(
	tx: DbTransaction,
	input: { tenantId: string; event: StripeWebhookEvent },
): Promise<IngestResult> {
	const { tenantId, event } = input;

	const insertedRows = await tx
		.insert(stripeEventInbox)
		.values({
			tenantId,
			eventId: event.id,
			eventType: event.type,
			apiVersion: event.api_version ?? 'unknown',
			livemode: event.livemode,
			payload: event as unknown as Record<string, unknown>,
		})
		.onConflictDoNothing({ target: [stripeEventInbox.tenantId, stripeEventInbox.eventId] })
		.returning({ eventId: stripeEventInbox.eventId });

	if (insertedRows.length === 0) {
		return { inserted: false };
	}

	await tx.insert(outboxJob).values({
		tenantId,
		kind: STRIPE_PROJECT_JOB_KIND,
		aggregateType: 'stripe_event',
		aggregateId: uuidForStripeEvent(event.id),
		payload: { eventId: event.id },
		idempotencyKey: event.id,
	});

	return { inserted: true };
}
