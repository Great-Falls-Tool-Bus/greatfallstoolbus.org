/**
 * The projection consumer — the "processing" half the ack path never does
 * (TIN-3818; spec §5, slices §3.2 "Out-of-order delivery").
 *
 * Reads a persisted inbox row and advances the person's contribution
 * agreement. Idempotent by construction: projecting the same event twice
 * computes the same target state, and `processed_at` marks completion for the
 * operator view. When S3's dispatcher lands it will claim `stripe.project`
 * outbox jobs and call `projectStripeEvent` with the job's transaction — the
 * signature already takes the `withTenant` handle for exactly that seam.
 *
 * ORDER-AMBIGUOUS EVENTS RETRIEVE THE TRUTH. Stripe does not guarantee
 * delivery order, so `customer.subscription.updated` and both invoice events
 * NEVER trust their payload's snapshot: they call
 * `gateway.retrieveSubscription` and project from current object state
 * (spec §5: "When event order is ambiguous, retrieve current Stripe object
 * state before projecting."). The stored event stays as the audit record; the
 * retrieved object is the truth. Under fixtures the gateway is the replay
 * implementation, so this path is exercised keyless too.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { stripeEventInbox, type ContributionAgreement } from '../db/schema';
import { setAgreementState } from '../contribution/agreement';
import type { StripeGateway, StripeWebhookEvent } from './client';
import { assertTestModeEvent } from './gate';

type AgreementState = ContributionAgreement['state'];

/** Stripe subscription status → contribution state (spec §5 enum). */
export function stateForSubscriptionStatus(status: string): AgreementState {
	switch (status) {
		case 'active':
		case 'trialing':
			return 'stripe_active';
		case 'past_due':
		case 'unpaid':
			return 'stripe_past_due';
		case 'canceled':
			return 'cancelled';
		case 'incomplete':
		case 'incomplete_expired':
		default:
			return 'stripe_pending';
	}
}

interface EventObject {
	id?: string;
	status?: string;
	subscription?: string;
	client_reference_id?: string | null;
	metadata?: Record<string, string>;
}

function personIdFrom(object: EventObject | undefined): string | undefined {
	return object?.metadata?.gftb_person_id ?? object?.client_reference_id ?? undefined;
}

export interface ProjectionOutcome {
	/** What was decided, for the job log. */
	action: 'projected' | 'skipped';
	state?: AgreementState;
	personId?: string;
	detail: string;
}

/**
 * Decide the projection for one event. Pure apart from the gateway retrieve;
 * the write happens in `projectStripeEvent`.
 */
export async function projectionForEvent(
	event: StripeWebhookEvent,
	gateway: StripeGateway,
): Promise<ProjectionOutcome> {
	const object = event.data?.object as EventObject | undefined;

	switch (event.type) {
		case 'checkout.session.completed': {
			// The session carries our own reference; the subscription it created is
			// live, so the agreement advances. A success-page redirect never does
			// this — the webhook is the only writer (spec §5).
			const personId = personIdFrom(object);
			if (!personId) return { action: 'skipped', detail: 'checkout session carries no gftb_person_id' };
			return { action: 'projected', state: 'stripe_active', personId, detail: 'checkout completed' };
		}
		case 'customer.subscription.created':
		case 'customer.subscription.deleted': {
			// Terminal/creation events are self-describing; deleted is terminal
			// regardless of any staler snapshot still in flight.
			const personId = personIdFrom(object);
			if (!personId) return { action: 'skipped', detail: `${event.type} carries no gftb_person_id` };
			const state =
				event.type === 'customer.subscription.deleted' ? 'cancelled' : stateForSubscriptionStatus(object?.status ?? '');
			return { action: 'projected', state, personId, detail: event.type };
		}
		case 'customer.subscription.updated':
		case 'invoice.paid':
		case 'invoice.payment_failed': {
			// Order-ambiguous: retrieve current object state, never trust the payload snapshot.
			const subscriptionId = event.type === 'customer.subscription.updated' ? object?.id : object?.subscription;
			if (!subscriptionId) return { action: 'skipped', detail: `${event.type} names no subscription` };
			const current = await gateway.retrieveSubscription(subscriptionId);
			const personId = current.metadata.gftb_person_id;
			if (!personId) return { action: 'skipped', detail: 'retrieved subscription carries no gftb_person_id' };
			return {
				action: 'projected',
				state: stateForSubscriptionStatus(current.status),
				personId,
				detail: `${event.type} → retrieved status ${current.status}`,
			};
		}
		default:
			return { action: 'skipped', detail: `event type ${event.type} is outside the minimum set` };
	}
}

/**
 * Project one stored inbox event and stamp the row. A payment failure of any
 * kind moves only the CONTRIBUTION aggregate — membership is structurally out
 * of reach (the import-boundary test pins that this module's package is never
 * imported by `src/lib/server/membership/**` and imports nothing from it).
 */
export async function projectStripeEvent(
	tx: DbTransaction,
	input: { tenantId: string; eventId: string; gateway: StripeGateway },
): Promise<ProjectionOutcome> {
	const [row] = await tx
		.select()
		.from(stripeEventInbox)
		.where(and(eq(stripeEventInbox.tenantId, input.tenantId), eq(stripeEventInbox.eventId, input.eventId)))
		.limit(1);
	if (!row) {
		throw new Error(`stripe.project: no inbox row for event ${input.eventId}`);
	}

	// Defense in depth: a live event cannot have been persisted (the webhook
	// refuses), but a projector must not trust that history either.
	assertTestModeEvent({ livemode: row.livemode, id: row.eventId });

	const event = row.payload as unknown as StripeWebhookEvent;
	try {
		const outcome = await projectionForEvent(event, input.gateway);
		if (outcome.action === 'projected' && outcome.state && outcome.personId) {
			await setAgreementState(tx, outcome.personId, outcome.state);
		}
		await tx
			.update(stripeEventInbox)
			.set({
				processedAt: new Date(),
				processAttempts: sql`${stripeEventInbox.processAttempts} + 1`,
				lastError: null,
			})
			.where(and(eq(stripeEventInbox.tenantId, input.tenantId), eq(stripeEventInbox.eventId, input.eventId)));
		return outcome;
	} catch (error) {
		await tx
			.update(stripeEventInbox)
			.set({
				processAttempts: sql`${stripeEventInbox.processAttempts} + 1`,
				lastError: (error as Error).message,
			})
			.where(and(eq(stripeEventInbox.tenantId, input.tenantId), eq(stripeEventInbox.eventId, input.eventId)));
		throw error;
	}
}
