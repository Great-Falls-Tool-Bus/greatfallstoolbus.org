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
 * EVERY SUBSCRIPTION-LIFECYCLE EVENT RETRIEVES THE TRUTH. Stripe does not
 * guarantee delivery order, and a payload snapshot is stale the moment a later
 * event exists — so `checkout.session.completed`,
 * `customer.subscription.created`, `customer.subscription.updated`, and both
 * invoice events ALL call `gateway.retrieveSubscription` and project from
 * current object state (spec §5: "When event order is ambiguous, retrieve
 * current Stripe object state before projecting."). Only
 * `customer.subscription.deleted` projects from its payload, because deletion
 * is terminal and cannot be staler than any other state. This is what makes
 * reverse-order delivery CONVERGE instead of resurrecting a cancelled
 * contribution: a late or redelivered checkout event retrieves a `canceled`
 * subscription and projects `cancelled`, not `stripe_active`
 * (adversarial-review finding B2 on PR #174). The stored event stays as the
 * audit record; the retrieved object is the truth. Under fixtures the gateway
 * is the replay implementation, so this path is exercised keyless too.
 *
 * FAILURE FORENSICS COMMIT SEPARATELY (finding S2). The projection write and
 * the success stamp share the caller's transaction, so they are atomic. The
 * FAILURE stamp cannot live in that transaction — the rethrow that dead-letters
 * the job also rolls the transaction back, which would erase the stamp — so
 * `projectStripeEvent` takes a `failureStampDb` and writes
 * `process_attempts`/`last_error` through a fresh connection that commits
 * independently of the doomed transaction.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db, DbTransaction } from '../db/client';
import { withTenant } from '../db/tenant';
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
		case 'customer.subscription.deleted': {
			// The ONE payload-trusting case: deletion is terminal, so no staler
			// snapshot can contradict it and no retrieve can improve on it.
			const personId = personIdFrom(object);
			if (!personId) return { action: 'skipped', detail: `${event.type} carries no gftb_person_id` };
			return { action: 'projected', state: 'cancelled', personId, detail: event.type };
		}
		case 'checkout.session.completed':
		case 'customer.subscription.created':
		case 'customer.subscription.updated':
		case 'invoice.paid':
		case 'invoice.payment_failed': {
			// Every other lifecycle event is order-ambiguous by construction — a
			// redelivered or late copy may describe a subscription that has since
			// failed or been cancelled. Retrieve current object state; never trust
			// the payload snapshot (spec §5, finding B2 — the payload path could
			// resurrect a cancelled contribution).
			const subscriptionId =
				event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created'
					? object?.id
					: object?.subscription;
			if (!subscriptionId) return { action: 'skipped', detail: `${event.type} names no subscription` };
			const current = await gateway.retrieveSubscription(subscriptionId);
			const personId = current.metadata.gftb_person_id ?? personIdFrom(object);
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
	input: {
		tenantId: string;
		eventId: string;
		gateway: StripeGateway;
		/**
		 * Connection for the FAILURE stamp only (finding S2): the stamp must
		 * outlive this function's rethrow, and the caller's transaction will be
		 * rolled back by exactly that rethrow. Without it a failure still
		 * dead-letters correctly but leaves no `last_error` forensics on the
		 * inbox row.
		 */
		failureStampDb?: Db;
	},
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
		let outcome = await projectionForEvent(event, input.gateway);
		if (outcome.action === 'projected' && outcome.state && outcome.personId) {
			const updated = await setAgreementState(tx, outcome.personId, outcome.state);
			if (!updated) {
				// An UPDATE that matched zero rows is not a projection — say so
				// instead of reporting 'projected' for a person with no agreement.
				outcome = {
					action: 'skipped',
					detail: `no contribution agreement exists for person ${outcome.personId}; nothing to project`,
				};
			}
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
		// The rethrow below rolls the caller's transaction back, so stamping
		// through `tx` would be dead code (finding S2). Stamp through a fresh
		// connection that commits on its own.
		if (input.failureStampDb) {
			await withTenant(
				input.tenantId,
				(stampTx) =>
					stampTx
						.update(stripeEventInbox)
						.set({
							processAttempts: sql`${stripeEventInbox.processAttempts} + 1`,
							lastError: (error as Error).message,
						})
						.where(and(eq(stripeEventInbox.tenantId, input.tenantId), eq(stripeEventInbox.eventId, input.eventId))),
				input.failureStampDb,
			);
		}
		throw error;
	}
}
