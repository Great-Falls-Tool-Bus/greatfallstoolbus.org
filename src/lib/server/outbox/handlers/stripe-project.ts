/**
 * The `stripe.project` outbox handler — S9's registration against S3's
 * dispatcher (spec §1.11 Files: this exact path,
 * `src/lib/server/outbox/handlers/stripe-project.ts`).
 *
 * THE GAP THIS CLOSES. `ingestStripeEvent` (`../../stripe/inbox.ts`) has
 * always enqueued a `stripe.project` job in the same transaction as the inbox
 * row (spec §3.2), and `projectStripeEvent` (`../../stripe/project.ts`) has
 * always known how to project one correctly — but nothing claimed the job.
 * The production worker ran `EMPTY_REGISTRY` (`../handlers.ts`), so every
 * `stripe.project` row hit `UnknownJobKindError` and dead-lettered after
 * `max_attempts` (spec §3.1's deterministic-failure case), and the §1.11
 * Goal's "webhook → durable inbox → ASYNCHRONOUS projection" claim was
 * unproven end-to-end: every green test called `projectStripeEvent` directly,
 * bypassing the dispatcher entirely. This file is the missing claim.
 *
 * THE S3 WORKER IDIOM, FOLLOWED EXACTLY.
 *   - `OutboxHandler = (job: ClaimedJob) => Promise<void>` (`../schema.ts`):
 *     a handler runs AT LEAST once and must be idempotent or receipted.
 *     `projectStripeEvent` already IS idempotent by construction (its own
 *     docstring: "projecting the same event twice computes the same target
 *     state"), so no separate consumer-side receipt table is needed here —
 *     the inbox row's own `(tenant_id, event_id)` primary key plus the
 *     projector's re-read-then-write shape is the receipt.
 *   - A throw is the failure signal (dispatch.ts): the dispatcher owns
 *     `attempts`/`last_error`/backoff/dead-letter on the OUTBOX ROW itself,
 *     so this handler does no retry logic of its own — it either completes
 *     or lets the error propagate.
 *   - Per-replica `GFTB_WORKER_ID` is `worker.ts`'s concern (lease_owner
 *     OBSERVABILITY only, per dispatch.ts's HIGH-2 note); nothing here reads
 *     it, because the completion/release guard is the per-claim lease token,
 *     never the worker name.
 *
 * THE POOL FENCE STILL BINDS HERE (`eslint.config.ts`, "Fence 1"):
 * `outbox/handlers/**` is ordinary application code, not `db/**`, so this
 * file may not import `getDb`/`getPool`/`createDb`. `createStripeProjectHandler`
 * therefore takes an OPTIONAL `db: Db` (a test seam) and forwards it to
 * `withTenant(tenantId, fn, db)`; when omitted (the production wiring in
 * `../../worker.ts`), `withTenant`'s own default resolves the process-wide
 * pool from INSIDE `db/tenant.ts`, where the fence does not apply.
 *
 * `failureStampDb` (the SEPARATE-transaction forensic stamp `projectStripeEvent`
 * writes on failure, finding S2) is the same shape: this file cannot construct
 * a fresh `Db` in production either, so the production handler simply omits it
 * — `projectStripeEvent`'s own docstring says that degrades gracefully ("a
 * failure still dead-letters correctly but leaves no last_error forensics on
 * the inbox row"). The PRIMARY forensic surface for a `stripe.project` failure
 * is the outbox row's own `attempts`/`last_error`/`dead` columns, which
 * `dispatchOnce` always writes regardless — that is what an operator actually
 * watches (spec §3.1). Tests inject `db` for both purposes, matching the
 * committed integration-suite idiom that builds its own `Db` rather than
 * reaching for the fenced constructors (see `../outbox.integration.test.ts`).
 */

import type { Db } from '../../db/client';
import { withTenant } from '../../db/tenant';
import { createStripeGateway, type StripeGateway } from '../../stripe/client';
import { readStripeConfig } from '../../stripe/config';
import { STRIPE_PROJECT_JOB_KIND } from '../../stripe/inbox';
import { projectStripeEvent } from '../../stripe/project';
import type { ClaimedJob, OutboxHandler } from '../schema';

export { STRIPE_PROJECT_JOB_KIND };

/** A claimed `stripe.project` job whose payload is not the `{ eventId }` shape `inbox.ts` writes. */
export class StripeProjectPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StripeProjectPayloadError';
	}
}

function parseEventId(job: ClaimedJob): string {
	const payload = job.payload;
	const eventId =
		payload && typeof payload === 'object' && 'eventId' in payload
			? (payload as { eventId?: unknown }).eventId
			: undefined;
	if (typeof eventId !== 'string' || !eventId.trim()) {
		throw new StripeProjectPayloadError(
			`stripe.project job ${job.id} carries a malformed payload (expected { eventId: string }): ${JSON.stringify(payload)}`,
		);
	}
	return eventId;
}

export interface StripeProjectHandlerDeps {
	/** The gateway `projectStripeEvent` retrieves current object state through. */
	gateway: StripeGateway;
	/** Test seam: the db `withTenant` opens the projection transaction on. Production omits it — see the module docstring. */
	db?: Db;
	/** Test seam: the SEPARATE connection the failure forensic stamp commits through. Production omits it — see the module docstring. */
	failureStampDb?: Db;
}

/**
 * Build the `stripe.project` `OutboxHandler` over injected dependencies —
 * the seam the integration suite uses to hand it the fixture replay gateway
 * and a testcontainer/throwaway-PG `Db` instead of the process-wide pool.
 */
export function createStripeProjectHandler(deps: StripeProjectHandlerDeps): OutboxHandler {
	return async function stripeProjectHandler(job: ClaimedJob): Promise<void> {
		const eventId = parseEventId(job);
		await withTenant(
			job.tenantId,
			(tx) =>
				projectStripeEvent(tx, {
					tenantId: job.tenantId,
					eventId,
					gateway: deps.gateway,
					failureStampDb: deps.failureStampDb,
				}),
			deps.db,
		);
	};
}

/**
 * Production wiring: the gateway built from runtime Stripe config (test-mode
 * keys or, absent them, the keyless stub whose every method throws before
 * any I/O — `client.ts`'s `createDisabledGateway`). No `db` is supplied; see
 * the module docstring for why that is the pool-fence-respecting choice, not
 * an oversight. `../../worker.ts`'s default registry calls this once at
 * startup, matching `readStripeConfig`'s own "read once, fail closed" shape.
 */
export function createProductionStripeProjectHandler(env: NodeJS.ProcessEnv = process.env): OutboxHandler {
	const gateway = createStripeGateway(readStripeConfig(env));
	return createStripeProjectHandler({ gateway });
}
