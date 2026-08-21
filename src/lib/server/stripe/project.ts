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
 * `charge.refunded` is the one case where the retrieve buys IDENTITY, not
 * STATE: a full refund (`refunded: true`) is itself terminal — nothing later
 * un-refunds a charge — so the STATE decision trusts the payload the same way
 * `customer.subscription.deleted` does. A partial refund is a no-op: it does
 * not move `refunded` state (spec §5 enum) — only a fully refunded charge
 * does. IDENTITY resolution walks `Charge.customer` (a real, always-present
 * field on a Stripe `Charge`) to `gateway.findSubscriptionForCustomer` — NOT
 * `Charge.subscription`, which this SDK's pinned API version does not have
 * (PR #185 adversarial-review BLOCK-2: the previous version of this case
 * invented that field, so it could only ever fire against the hand-authored
 * fixture, never against a real refund). `subscription_data.metadata` at
 * Checkout time is what puts `gftb_person_id` on the subscription this walk
 * lands on.
 *
 * REFUNDED IS ABSORBING AGAINST THE SUBSCRIPTION-STATUS PROJECTION (PR #185
 * adversarial-review BLOCK-3). `stateForSubscriptionStatus` can never return
 * `'refunded'` — no branch of its switch produces it — so a retrieved
 * subscription status is never evidence FOR OR AGAINST a refund; it is
 * evidence about the SUBSCRIPTION, a different Stripe object than the CHARGE
 * a refund is a fact about. A stale or redelivered order-ambiguous event
 * (`checkout.session.completed`, `customer.subscription.{created,updated}`,
 * `invoice.{paid,payment_failed}` — spec §5's "retrieve current Stripe object
 * state before projecting" idiom) would otherwise silently resurrect
 * `stripe_active` out from under an already-recorded refund purely because
 * Stripe redelivers for up to 3 days and this worker retries for up to ~8×6h.
 * `projectStripeEvent` below enforces this with a guarded write
 * (`setAgreementStateUnlessRefunded`) for exactly those five event types —
 * `customer.subscription.deleted` and `charge.refunded` itself are NOT
 * guarded, because each is a dedicated, payload-trusted event about the exact
 * fact it asserts (deletion, refund), not a re-derivation through subscription
 * status.
 *
 * FAILURE FORENSICS COMMIT SEPARATELY (finding S2). The projection write and
 * the success stamp share the caller's transaction, so they are atomic. The
 * FAILURE stamp cannot live in that transaction — the rethrow that dead-letters
 * the job also rolls the transaction back, which would erase the stamp — so
 * `projectStripeEvent` takes a `failureStampDb` and writes
 * `process_attempts`/`last_error` through a fresh connection that commits
 * independently of the doomed transaction.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db, DbTransaction } from '../db/client';
import { withTenant } from '../db/tenant';
import { contributionAgreement, stripeEventInbox, type ContributionAgreement } from '../db/schema';
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
	/** `charge.refunded` only: Stripe's own verdict on whether the FULL amount was refunded. */
	refunded?: boolean;
	/** `charge.refunded` only: the real `Charge.customer` field — `Charge` has no `subscription`/`invoice` field. */
	customer?: string | null;
}

/** The five order-ambiguous events whose state is DERIVED from a retrieved subscription's status. */
const SUBSCRIPTION_STATUS_EVENT_TYPES: ReadonlySet<string> = new Set([
	'checkout.session.completed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'invoice.paid',
	'invoice.payment_failed',
]);

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
		case 'charge.refunded': {
			// A charge's `refunded` flag is Stripe's own verdict, not a staler
			// snapshot a later event can contradict — a FULLY refunded charge
			// (`refunded: true`) stays refunded, the same "terminal, so no
			// retrieve can improve on it" reasoning `customer.subscription.deleted`
			// uses above (finding B2's fix does not apply to a fact that cannot
			// un-happen). A PARTIAL refund (`refunded: false` even though
			// `amount_refunded > 0`) does not change contribution state — only a
			// full refund does, so anything less is a no-op rather than a
			// half-projected 'refunded'.
			if (!object?.refunded) {
				return { action: 'skipped', detail: `${event.type} is a partial refund; contribution state unchanged` };
			}
			// Identity, unlike the refund fact itself, IS worth retrieving rather
			// than trusting the charge payload alone — but `Charge.subscription`
			// does not exist (BLOCK-2). `Charge.customer` does: walk it to the
			// customer's subscription (findSubscriptionForCustomer, `status:
			// 'all'` so an already-canceled subscription still resolves) and take
			// ITS metadata, the same retrieve-the-truth preference the
			// order-ambiguous events below apply to STATUS, applied here to
			// IDENTITY instead. `personIdFrom(object)` is kept as a fallback for a
			// charge that was explicitly given metadata some other way — Charge
			// does carry a real (if normally empty for us) `metadata` field.
			let personId = personIdFrom(object);
			if (object?.customer) {
				const subscription = await gateway.findSubscriptionForCustomer(object.customer);
				personId = subscription?.metadata.gftb_person_id ?? personId;
			}
			if (!personId) return { action: 'skipped', detail: `${event.type} carries no resolvable gftb_person_id` };
			return { action: 'projected', state: 'refunded', personId, detail: event.type };
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
 * `setAgreementState`, but refuses to overwrite an already-`'refunded'`
 * agreement (PR #185 adversarial-review BLOCK-3 — see the module docstring's
 * "REFUNDED IS ABSORBING" section). Atomic: the guard rides the same UPDATE
 * statement's WHERE clause, so there is no read-then-write race between
 * checking the current state and writing the new one. Used ONLY for the five
 * `SUBSCRIPTION_STATUS_EVENT_TYPES` — `customer.subscription.deleted` and
 * `charge.refunded` itself keep calling the unguarded `setAgreementState`,
 * because each is a dedicated, payload-trusted event about the exact fact it
 * asserts, not a re-derivation through subscription status.
 */
async function setAgreementStateUnlessRefunded(
	tx: DbTransaction,
	personId: string,
	state: AgreementState,
): Promise<ContributionAgreement | undefined> {
	const rows = await tx
		.update(contributionAgreement)
		.set({ state, version: sql`${contributionAgreement.version} + 1` })
		.where(and(eq(contributionAgreement.personId, personId), ne(contributionAgreement.state, 'refunded')))
		.returning();
	return rows[0];
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
			// BLOCK-3: the five subscription-status-derived event types write
			// through the GUARDED path — 'refunded' is absorbing against them
			// (module docstring). customer.subscription.deleted and
			// charge.refunded itself are dedicated, payload-trusted events about
			// the exact fact they assert, so they keep the unguarded write.
			const guarded = SUBSCRIPTION_STATUS_EVENT_TYPES.has(event.type);
			const updated = guarded
				? await setAgreementStateUnlessRefunded(tx, outcome.personId, outcome.state)
				: await setAgreementState(tx, outcome.personId, outcome.state);
			if (!updated) {
				// Zero rows matched for one of two reasons — no agreement exists
				// for this person, or (guarded path only) the guard refused to
				// overwrite an already-'refunded' agreement. Either way this is
				// not a projection: say so instead of reporting 'projected'.
				outcome = {
					action: 'skipped',
					detail: guarded
						? `no update for person ${outcome.personId}: either no contribution agreement exists, or it is already 'refunded' and this ${event.type} projection is absorbed rather than overwriting it`
						: `no contribution agreement exists for person ${outcome.personId}; nothing to project`,
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
