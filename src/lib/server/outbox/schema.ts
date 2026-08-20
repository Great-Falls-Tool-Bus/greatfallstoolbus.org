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
 *
 * NOT independent of {@link DEFAULT_LEASE_SECONDS}. The claim writes one lease
 * for the whole batch, and the dispatcher then RENEWS that lease per job
 * immediately before running its handler (PR #173 review, HIGH-1) — so the
 * invariant a deployment must hold is `leaseSeconds > p99(one handler)`, not
 * `leaseSeconds > batchSize × p99(handler)`. A handler slower than the lease
 * still loses its row to reclaim mid-flight, and at-least-once (not
 * exactly-once) is what the queue promises in that case.
 */
export const DEFAULT_BATCH_SIZE = 32;

/**
 * Lease duration in seconds (spec §3.1 ASSUMPTION: 60s). A worker that dies
 * mid-job strands its rows for at most this long before the stale-lease
 * reclaim in the claim query re-admits them. Renewed per job before each
 * handler runs, so this bounds ONE handler's protected window, not a whole
 * batch's — see the invariant note on {@link DEFAULT_BATCH_SIZE}.
 * Resolver: Jess.
 */
export const DEFAULT_LEASE_SECONDS = 60;

/**
 * Retry backoff envelope: exponential with FULL jitter (spec §3.1 requires the
 * jitter — offboarding fans out three jobs at the same instant, and without
 * jitter they retry in lockstep forever).
 *
 * Base 5 minutes, cap 6 hours (PR #173 review, LOW-2): the expected cumulative
 * window across attempts 1–7 is ≈8–11 h, which keeps `max_attempts = 8`'s
 * "roughly a day of jittered retry before an operator is asked to look"
 * (spec §3.1) at the right order of magnitude — the previous 60 s base gave an
 * expected ≈2.1 h, an afternoon. Two honest caveats, both spec-conformant:
 * full jitter has NO FLOOR, so an unlucky draw sequence can burn all eight
 * attempts in seconds; and the "day" figure is an expectation, not a bound.
 * Both numbers sit under the same recorded ASSUMPTION umbrella as
 * `max_attempts`, the lease, and the batch (resolver: Jess, sitting #2).
 * Per-worker overridable.
 */
export const DEFAULT_BACKOFF_BASE_MS = 5 * 60_000;

/** Backoff ceiling — see {@link DEFAULT_BACKOFF_BASE_MS}. */
export const DEFAULT_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

/**
 * `last_error` is an operator surface, not a log sink: keep it to one bounded
 * chunk so a looping stack trace cannot bloat the row it is meant to explain.
 *
 * Like `payload`, `last_error` must never carry a secret or token — this
 * repository is public and the column is durable and operator-visible.
 * `describeFailure` redacts URL userinfo, bearer tokens, and key=value
 * credential shapes before writing (PR #173 review, LOW-3), but redaction is a
 * backstop: handlers that talk to external systems (S7/S9) must not put raw
 * client errors carrying credentials into thrown messages in the first place.
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
	 *
	 * A standing row in `'dead'` is NOT silently absorbed: `enqueue` throws
	 * `DeadIdempotencyKeyError` instead, because "the caller believes the job
	 * is queued and nothing will ever run it" is the shape a real incident
	 * takes (PR #173 review, MEDIUM-2). Whether re-enqueue should instead
	 * resurrect the dead row (an audited operator action per spec §3.1) is a
	 * spec-level question flagged for sitting #2; resolver: Jess.
	 */
	enqueued: boolean;
}

/**
 * One claimed row, as the dispatcher sees it: the §3.1 field list with the
 * lease the claim just wrote.
 *
 * `leaseOwner` carries `<worker>#<uuid>` — the worker identity for
 * OBSERVABILITY, plus per-claim entropy that is the actual completion/release
 * guard (PR #173 review, HIGH-2). Guarding on the raw worker name collapses
 * when an operator sets `GFTB_WORKER_ID` once at Deployment level and every
 * replica shares it; the per-claim token cannot be flattened by configuration.
 * A dedicated `lease_token uuid` column is the cleaner long-term shape, but a
 * new S3 migration would join the `0003` journal collision already pending
 * between S2 and PR #174 — the composed value is the fence-respecting form.
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
	/** The exact `lease_owner` value this claim wrote — pass to complete/release/renew. */
	leaseToken: string;
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
