/**
 * Outbox contract surface (TIN-3817 slice S3, spec §3.1).
 *
 * WHY THIS FILE DECLARES NO TABLE. The `outbox_job` table, its
 * `unique (tenant_id, kind, idempotency_key)` constraint, and the partial
 * claim index on `(tenant_id, available_at) where status in
 * ('pending','leased')` all shipped in S1 (`src/lib/server/db/schema.ts`,
 * migrations `0000` + `0002`) in exactly spec §3.1's shape — the slice table's
 * "drizzle/ (+ one migration)" row was satisfied there, which is what let S3
 * run parallel to S2 off the S1 base. This file is the slice's CONTRACT
 * surface instead: the shapes `enqueue`, the dispatcher, and every future
 * handler (S7 offboarding, S9 Stripe) agree on, plus the spec's recorded
 * numeric ASSUMPTIONs in one greppable place.
 *
 * S3 stops at the job-execution interface. Nothing in this module sends mail,
 * calls Stripe, or reaches any live delivery target; handlers are registered
 * by later slices through `./handlers.ts`.
 */

import type { OutboxJob } from '../db/schema';
import type { DbTransaction } from '../db/client';

export type { OutboxJob } from '../db/schema';
export type { DbTransaction } from '../db/client';

/** One row's lifecycle states, mirroring the `outbox_status` enum (S1). */
export type OutboxStatus = 'pending' | 'leased' | 'done' | 'dead';

/**
 * Batch size for one claim (spec §3.1: "bounded batches"). ASSUMPTION recorded
 * in the spec, awaiting ratification sitting #2. Resolver: Jess. Per-call
 * overridable, which is what makes it cheap to change.
 */
export const DEFAULT_BATCH_SIZE = 32;

/**
 * Lease duration in seconds (spec §3.1 ASSUMPTION: 60s). A worker that dies
 * mid-job strands its rows for at most this long before the stale-lease
 * reclaim in the claim query re-admits them. Resolver: Jess.
 */
export const DEFAULT_LEASE_SECONDS = 60;

/**
 * Retry backoff envelope: exponential with FULL jitter (spec §3.1 requires the
 * jitter — offboarding fans out three jobs at the same instant, and without
 * jitter they retry in lockstep forever). The base/cap pair below bounds the
 * cumulative un-jittered retry window at roughly 4 hours for the default
 * `max_attempts = 8`; the spec's "roughly a day before an operator is asked to
 * look" figure rides on dead rows being operator-visible, and these two
 * numbers sit under the same recorded ASSUMPTION umbrella as `max_attempts`
 * and the lease (resolver: Jess). Per-worker overridable.
 */
export const DEFAULT_BACKOFF_BASE_MS = 60_000;

/** Backoff ceiling — see {@link DEFAULT_BACKOFF_BASE_MS}. */
export const DEFAULT_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * `last_error` is an operator surface, not a log sink: keep it to one bounded
 * chunk so a looping stack trace cannot bloat the row it is meant to explain.
 */
export const MAX_LAST_ERROR_LENGTH = 2_000;

/**
 * What a caller hands `enqueue(tx, job)`. The tenant is deliberately ABSENT:
 * it is read from the transaction's `app.tenant_id` GUC (set by `withTenant`),
 * so a caller cannot even express "enqueue this for some other tenant" —
 * row-level security would reject it anyway, but this fails faster and with a
 * better message.
 */
export interface EnqueueInput {
	/** Handler routing key, e.g. `member.offboard.revoke_lists` (S7's to name). */
	kind: string;
	/** The aggregate the state change happened to, e.g. `membership`. */
	aggregateType: string;
	/** UUID of that aggregate. */
	aggregateId: string;
	/** Handler input, stored as jsonb. Must never carry a secret or token. */
	payload: unknown;
	/**
	 * Consumer-side idempotency key, unique per `(tenant, kind)`. Re-enqueueing
	 * the same key is a no-op that returns the existing row — first write wins.
	 */
	idempotencyKey: string;
	/** Earliest dispatch time. Defaults to now (the column default). */
	availableAt?: Date;
	/** Dead-letter bound override for this one job. Defaults to the column's 8. */
	maxAttempts?: number;
}

export interface EnqueueResult {
	job: OutboxJob;
	/**
	 * False when the unique key already existed and the EXISTING row is being
	 * returned — the idempotent re-enqueue path. The original payload wins;
	 * a differing payload on a duplicate key is NOT written.
	 */
	enqueued: boolean;
}

/**
 * One claimed row, as the dispatcher sees it: the §3.1 field list with the
 * lease the claim just wrote.
 */
export interface ClaimedJob {
	id: string;
	tenantId: string;
	kind: string;
	aggregateType: string;
	aggregateId: string;
	payload: unknown;
	idempotencyKey: string;
	status: OutboxStatus;
	attempts: number;
	maxAttempts: number;
	availableAt: Date;
	leaseOwner: string | null;
	leaseExpiresAt: Date | null;
	lastError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * The job-execution interface S3 stops at.
 *
 * A handler runs AT LEAST once (spec §3.1): the outbox cannot promise
 * exactly-once across a process boundary, so exactly-once is the consumer's
 * property, never the queue's. A handler must therefore either be naturally
 * idempotent (unsubscribe, disable, cancel-by-id) or record a consumer-side
 * receipt keyed on `(kind, idempotency_key)` before the effect. A throw is the
 * failure signal: the dispatcher increments `attempts`, records the message in
 * `last_error`, and either re-schedules with jittered backoff or dead-letters.
 */
export type OutboxHandler = (job: ClaimedJob) => Promise<void>;

/** Resolves a handler for a job kind; throws `UnknownJobKindError` otherwise. */
export interface HandlerRegistry {
	resolve(kind: string): OutboxHandler;
	/** The kinds this registry can dispatch, for logs and operator surfaces. */
	kinds(): string[];
}

/** Re-exported so dispatch code can type its tx-first functions uniformly. */
export type OutboxTx = DbTransaction;
