/**
 * The outbox dispatcher: claim, execute, complete-or-retry, dead-letter
 * (TIN-3817 slice S3, spec §3.1 "Claim" / "Retry" / "Dead-letter";
 * hardened per the PR #173 adversarial review).
 *
 * SHAPE. Four tx-first primitives mirror `enqueue(tx, job)` — `claimBatch`,
 * `renewLease`, `completeJob`, and `releaseJob` all take the transaction
 * handle first — and `dispatchOnce` composes them the only correct way: the
 * CLAIM commits its leases in one short transaction, every handler runs
 * OUTSIDE any transaction (that is what the lease is for — a row must never
 * sit row-locked for the duration of an external effect), and each renewal
 * and completion/release commits in its own transaction.
 *
 * TENANT SCOPE. Every transaction here is opened through `withTenant`, so
 * row-level security supplies the `tenant_id = <GUC>` predicate; combined with
 * the claim's own `status in ('pending','leased')` and `available_at <= now()`
 * conditions, the query is exactly the shape S1's partial claim index
 * `outbox_job_claimable (tenant_id, available_at) where status in
 * ('pending','leased')` serves. The integration suite pins that with an
 * EXPLAIN under `enable_seqscan = off`, so the index and the query cannot
 * silently drift apart.
 *
 * THE LEASE COVERS THE EXECUTION, NOT JUST THE CLAIM (review HIGH-1). The
 * claim writes one lease for the whole batch, which alone would give job N of
 * a batch only `leaseSeconds − (time spent on jobs 1..N−1)` of protection —
 * steady-state double execution for any handler slower than
 * `leaseSeconds / batchSize`. So `dispatchOnce` RENEWS the lease immediately
 * before running each handler: every job begins execution with a fresh, full
 * `leaseSeconds` window, and a renewal that matches zero rows means the row
 * was reclaimed while queued behind its batch — the job is SKIPPED (counted
 * `lost`), never run on a lease this worker no longer holds. The surviving
 * invariant a deployment must hold is `leaseSeconds > p99(ONE handler)`; a
 * single handler that outlives its own fresh lease is still at-least-once,
 * by contract.
 *
 * THE GUARD IS A PER-CLAIM TOKEN, NOT A WORKER NAME (review HIGH-2).
 * `lease_owner` is written as `<worker>#<uuid>`: the worker identity for
 * observability, plus entropy minted per claim. Renewal, completion, and
 * release all guard on the WHOLE token, so two replicas that share a
 * Deployment-level `GFTB_WORKER_ID` still cannot stomp each other's rows — a
 * zombie's write matches zero rows and is counted `lost`.
 *
 * STALE-LEASE RECLAIM. The claim admits `'leased'` rows whose
 * `lease_expires_at` has passed (spec §3.1): a worker that dies mid-job does
 * not strand its rows beyond one lease.
 *
 * COMPLETION FAILURE IS NOT HANDLER FAILURE (review MEDIUM-1). The completion
 * transaction commits under its own error handling: a database blip while
 * recording success is counted `lost` (the lease expires, the row re-runs,
 * the consumer's receipt absorbs the repeat) — it must never be recorded as a
 * handler failure, because with `max_attempts = 1` that misclassification
 * dead-letters a job whose effect SUCCEEDED and lies to the operator reading
 * the dead-letter queue.
 *
 * RETRY. On handler failure: `attempts + 1`, `last_error` set (bounded and
 * secret-redacted — review LOW-3), `available_at` pushed forward by
 * exponential FULL-jitter backoff, status back to `'pending'` — and the lease
 * columns cleared, which is not cosmetic: the claim admits a row whose lease
 * is null OR expired, so a released row that kept its lease would be
 * re-claimable the moment that lease lapsed, overriding any backoff longer
 * than the lease (spec §3.1).
 *
 * DEAD-LETTER. `attempts >= max_attempts` lands `status = 'dead'` in the same
 * release statement; dead rows are excluded by the claim's status predicate,
 * stay inspectable, and are never dropped. Operator replay (reset `attempts`
 * and `status`, audited) is a later slice's surface — spec §3.1 scopes S3 to
 * the queue, and nothing here deletes a row, ever. A dead row also HOLDS its
 * idempotency key: see `DeadIdempotencyKeyError` in `./enqueue.ts`.
 *
 * ISOLATION. `FOR UPDATE SKIP LOCKED` skips under READ COMMITTED but raises
 * 40001 under REPEATABLE READ / SERIALIZABLE (review LOW-1). `claimBatch`
 * asserts the transaction's isolation level rather than assuming it, so a
 * future change to `withTenant` (S1's file, not this slice's to edit) fails
 * loudly here instead of surfacing as serialization errors in production.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { withTenant } from '../db/tenant';
import {
	DEFAULT_BACKOFF_BASE_MS,
	DEFAULT_BACKOFF_CAP_MS,
	DEFAULT_BATCH_SIZE,
	DEFAULT_LEASE_SECONDS,
	MAX_LAST_ERROR_LENGTH,
	type ClaimedJob,
	type DbTransaction,
	type HandlerRegistry,
	type OutboxStatus,
} from './schema';

/* ────────────────────────── backoff ────────────────────────── */

export interface BackoffOptions {
	baseMs?: number;
	capMs?: number;
	/** Injection seam for the unit tests; production uses Math.random. */
	random?: () => number;
}

/**
 * Exponential backoff with FULL jitter: a uniform draw from
 * `[0, min(capMs, baseMs * 2^attempts))`. Full jitter (rather than equal or
 * decorrelated) because spec §3.1 names the failure mode it prevents:
 * offboarding fans out three jobs at the same instant, and any deterministic
 * component keeps them retrying in lockstep. No floor, by construction — an
 * unlucky sequence of small draws is spec-conformant (see the envelope note
 * on DEFAULT_BACKOFF_BASE_MS).
 *
 * @param attempts the attempt count AFTER the failure being scheduled (≥ 1)
 */
export function fullJitterBackoffMs(attempts: number, options: BackoffOptions = {}): number {
	const { baseMs = DEFAULT_BACKOFF_BASE_MS, capMs = DEFAULT_BACKOFF_CAP_MS, random = Math.random } = options;
	const exponent = Math.max(1, Math.floor(attempts));
	const ceiling = Math.min(capMs, baseMs * 2 ** exponent);
	return Math.floor(random() * ceiling);
}

/**
 * Redact the credential shapes that routinely ride third-party client errors
 * (review LOW-3): URL userinfo (`scheme://user:pass@`), bearer tokens, and
 * `key=value` pairs whose key names a credential. A backstop, not a licence —
 * `last_error` carries the same "never a secret" contract as `payload`.
 */
export function redactSecrets(text: string): string {
	return text
		.replace(/\/\/[^\s/@]+:[^\s@]+@/g, '//***:***@')
		.replace(/\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, '$1 ***')
		.replace(
			/\b(api[-_]?key|access[-_]?token|token|secret|password|passwd|pwd|authorization|signature|sig)\b(\s*[=:]\s*)[^\s&"']{6,}/gi,
			'$1$2***',
		);
}

/** Bound and redact `last_error` so the row explains without leaking or bloating. */
export function describeFailure(error: unknown): string {
	const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return redactSecrets(text).slice(0, MAX_LAST_ERROR_LENGTH);
}

/* ────────────────────────── row mapping ────────────────────────── */

interface RawOutboxRow extends Record<string, unknown> {
	id: string;
	tenant_id: string;
	kind: string;
	aggregate_type: string;
	aggregate_id: string;
	payload: unknown;
	idempotency_key: string;
	status: OutboxStatus;
	attempts: number;
	max_attempts: number;
	available_at: Date;
	lease_owner: string | null;
	lease_expires_at: Date | null;
	last_error: string | null;
	created_at: Date;
	updated_at: Date;
}

function toClaimedJob(row: RawOutboxRow, leaseToken: string): ClaimedJob {
	return {
		id: row.id,
		tenantId: row.tenant_id,
		kind: row.kind,
		aggregateType: row.aggregate_type,
		aggregateId: row.aggregate_id,
		payload: row.payload,
		idempotencyKey: row.idempotency_key,
		status: row.status,
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		availableAt: row.available_at,
		leaseOwner: row.lease_owner,
		leaseExpiresAt: row.lease_expires_at,
		lastError: row.last_error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		leaseToken,
	};
}

/* ────────────────────────── tx-first primitives ────────────────────────── */

export interface ClaimOptions {
	/**
	 * Worker identity, written into `lease_owner` for OBSERVABILITY only — the
	 * guard is the per-claim token minted here, so a Deployment-level shared
	 * identity cannot collapse it (review HIGH-2).
	 */
	worker: string;
	batchSize?: number;
	leaseSeconds?: number;
	/**
	 * Kinds whose delivery gate is closed. They remain pending with attempts=0
	 * and become claimable automatically when a later worker omits the kind.
	 */
	deferredKinds?: readonly string[];
}

/**
 * Claim a bounded batch with `FOR UPDATE SKIP LOCKED` — spec §3.1's statement
 * verbatim. Two dispatchers over one batch claim disjoint rows and neither
 * blocks; rows with a live lease are skipped by the predicate, rows whose
 * lease expired are reclaimed by it. Every returned job carries the claim's
 * `leaseToken`; execution-time protection additionally requires the per-job
 * `renewLease` that `dispatchOnce` performs (see the module header, HIGH-1).
 */
export async function claimBatch(tx: DbTransaction, options: ClaimOptions): Promise<ClaimedJob[]> {
	const { worker, batchSize = DEFAULT_BATCH_SIZE, leaseSeconds = DEFAULT_LEASE_SECONDS, deferredKinds = [] } = options;
	if (!worker.trim()) throw new Error('outbox claim: "worker" must be a non-empty string');
	if (worker.includes('#')) {
		throw new Error('outbox claim: "worker" must not contain "#" — it delimits the per-claim lease token');
	}
	if (!Number.isInteger(batchSize) || batchSize < 1) {
		throw new Error(`outbox claim: "batchSize" must be a positive integer, got ${batchSize}`);
	}
	if (!(leaseSeconds > 0)) {
		throw new Error(`outbox claim: "leaseSeconds" must be positive, got ${leaseSeconds}`);
	}

	// SKIP LOCKED semantics are isolation-dependent: READ COMMITTED skips,
	// REPEATABLE READ / SERIALIZABLE raise 40001 (review LOW-1). withTenant
	// does not pin an isolation level (S1's file), so assert rather than assume.
	const iso = await tx.execute<{ level: string } & Record<string, unknown>>(
		sql`select current_setting('transaction_isolation') as level`,
	);
	const level = iso.rows[0]?.level;
	if (level !== 'read committed') {
		throw new Error(
			`outbox claim: requires READ COMMITTED, got '${level}' — FOR UPDATE SKIP LOCKED raises 40001 ` +
				'instead of skipping under stricter isolation (PR #173 review, LOW-1)',
		);
	}

	const leaseToken = `${worker}#${randomUUID()}`;

	const result = await tx.execute<RawOutboxRow>(sql`
		with claimed as (
			select id from outbox_job
			 where status in ('pending', 'leased')
			   and available_at <= now()
			   and (lease_expires_at is null or lease_expires_at < now())
			   and not (kind = any(${deferredKinds}::text[]))
			 order by available_at
			 limit ${batchSize}
			 for update skip locked
		)
		update outbox_job o
		   set status = 'leased',
		       lease_owner = ${leaseToken},
		       lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
		       updated_at = now()
		  from claimed c
		 where o.id = c.id
		returning o.*
	`);

	return result.rows.map((row) => toClaimedJob(row, leaseToken));
}

export interface LeaseRef {
	id: string;
	/** The exact `leaseToken` the claim returned (`<worker>#<uuid>`). */
	token: string;
}

/**
 * Give one leased job a fresh, full lease window — called by `dispatchOnce`
 * immediately before each handler runs, so execution is protected per job
 * rather than per batch (review HIGH-1). Returns false when the token no
 * longer holds the row: it was reclaimed while queued, and MUST NOT be run.
 */
export async function renewLease(tx: DbTransaction, ref: LeaseRef & { leaseSeconds?: number }): Promise<boolean> {
	const leaseSeconds = ref.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
	if (!(leaseSeconds > 0)) {
		throw new Error(`outbox renew: "leaseSeconds" must be positive, got ${leaseSeconds}`);
	}
	const result = await tx.execute(sql`
		update outbox_job
		   set lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
		       updated_at = now()
		 where id = ${ref.id}
		   and status = 'leased'
		   and lease_owner = ${ref.token}
	`);
	return (result.rowCount ?? 0) === 1;
}

/**
 * Mark one leased job done. Returns false when the guard matched zero rows —
 * the lease was reclaimed after expiring, so this worker's result no longer
 * owns the row (the job may have run more than once; only the consumer-side
 * receipt is single, spec §3.1).
 */
export async function completeJob(tx: DbTransaction, ref: LeaseRef): Promise<boolean> {
	const result = await tx.execute(sql`
		update outbox_job
		   set status = 'done',
		       lease_owner = null,
		       lease_expires_at = null,
		       updated_at = now()
		 where id = ${ref.id}
		   and status = 'leased'
		   and lease_owner = ${ref.token}
	`);
	return (result.rowCount ?? 0) === 1;
}

export interface ReleaseInput extends LeaseRef {
	/** What failed, bounded to {@link MAX_LAST_ERROR_LENGTH} by the caller. */
	lastError: string;
	/** Backoff delay before the row becomes claimable again. */
	backoffMs: number;
}

export interface ReleaseOutcome {
	status: Extract<OutboxStatus, 'pending' | 'dead'>;
	attempts: number;
}

/**
 * Record a handler failure: increment `attempts`, set `last_error`, clear the
 * lease, and either push `available_at` forward (retry) or land `'dead'` when
 * the bounded attempt count is spent — one statement, so a crash between "count
 * the failure" and "decide dead" cannot exist. Returns null when the lease was
 * no longer this claim's.
 */
export async function releaseJob(tx: DbTransaction, input: ReleaseInput): Promise<ReleaseOutcome | null> {
	const backoffMs = Math.max(0, Math.floor(input.backoffMs));
	const result = await tx.execute<{ status: 'pending' | 'dead'; attempts: number } & Record<string, unknown>>(sql`
		update outbox_job
		   set attempts = attempts + 1,
		       last_error = ${input.lastError},
		       status = case when attempts + 1 >= max_attempts
		                     then 'dead'::outbox_status
		                     else 'pending'::outbox_status end,
		       available_at = case when attempts + 1 >= max_attempts
		                           then available_at
		                           else now() + make_interval(secs => ${backoffMs / 1000}) end,
		       lease_owner = null,
		       lease_expires_at = null,
		       updated_at = now()
		 where id = ${input.id}
		   and status = 'leased'
		   and lease_owner = ${input.token}
		returning status, attempts
	`);
	const row = result.rows[0];
	return row ? { status: row.status, attempts: row.attempts } : null;
}

/* ────────────────────────── the dispatch cycle ────────────────────────── */

export interface DispatchOptions {
	/** The one configured GFTB tenant this worker serves (TIN-3817 scope). */
	tenantId: string;
	/** Worker identity for lease_owner observability; the guard is per-claim. */
	worker: string;
	registry: HandlerRegistry;
	/** Injection seam for tests; production flows through `withTenant`'s default. */
	db?: Db;
	batchSize?: number;
	leaseSeconds?: number;
	/** Delivery-gated kinds to leave pending without consuming an attempt. */
	deferredKinds?: readonly string[];
	/** Injection seam for tests; defaults to {@link fullJitterBackoffMs}. */
	backoffMs?: (attempts: number) => number;
	/**
	 * Cooperative shutdown, checked BETWEEN JOBS (review LOW-4): an aborted
	 * cycle stops before its next handler; already-claimed rows stay leased and
	 * are re-admitted by lease expiry. The in-flight handler is never killed.
	 */
	signal?: AbortSignal;
	/** Observability seam — called once per failed job with the outcome. */
	onFailure?: (job: ClaimedJob, error: unknown, outcome: ReleaseOutcome | null) => void;
	/**
	 * Observability seam for a failed BOOKKEEPING transaction (renewal,
	 * completion, release): the handler outcome is real but could not be
	 * recorded; the row is left to lease expiry (counted `lost`).
	 */
	onBookkeepingError?: (job: ClaimedJob, error: unknown) => void;
}

export interface DispatchSummary {
	claimed: number;
	done: number;
	retried: number;
	dead: number;
	/**
	 * Rows this cycle no longer owns or could not record: lease reclaimed
	 * before/during execution, a zombie-guarded write matching zero rows, a
	 * bookkeeping transaction failing, or an abort between jobs. Lease expiry
	 * re-admits every one of them; at-least-once absorbs the repeat.
	 */
	lost: number;
}

/**
 * One dispatch cycle: claim a batch (one transaction), then per job — renew
 * the lease (fresh full window, or skip as `lost` if reclaimed), run the
 * handler outside any transaction, and commit the outcome in its own
 * transaction. Handler failure and bookkeeping failure are DISTINCT paths:
 * only the handler's own throw can consume an attempt (review MEDIUM-1).
 */
export async function dispatchOnce(options: DispatchOptions): Promise<DispatchSummary> {
	const { tenantId, worker, registry, db, batchSize, leaseSeconds, deferredKinds, signal } = options;
	const backoff = options.backoffMs ?? fullJitterBackoffMs;

	const claimed = await withTenant(
		tenantId,
		(tx) => claimBatch(tx, { worker, batchSize, leaseSeconds, deferredKinds }),
		db,
	);

	const summary: DispatchSummary = { claimed: claimed.length, done: 0, retried: 0, dead: 0, lost: 0 };

	for (let i = 0; i < claimed.length; i += 1) {
		// LOW-4: stop between jobs on shutdown. The remaining rows keep their
		// batch lease and are re-admitted when it expires.
		if (signal?.aborted) {
			summary.lost += claimed.length - i;
			break;
		}
		const job = claimed[i];

		const ref = { id: job.id, token: job.leaseToken };

		// HIGH-1: a fresh, full lease window before THIS job runs. Zero rows
		// means the row was reclaimed while queued behind its batch — running it
		// anyway would be the double-execution the review demonstrated.
		let renewed: boolean;
		try {
			renewed = await withTenant(tenantId, (tx) => renewLease(tx, { ...ref, leaseSeconds }), db);
		} catch (error) {
			summary.lost += 1;
			options.onBookkeepingError?.(job, error);
			continue;
		}
		if (!renewed) {
			summary.lost += 1;
			continue;
		}

		// The handler's OWN failure path: resolve + run. Nothing else shares
		// this try (MEDIUM-1).
		let handlerFailure: { error: unknown } | undefined;
		try {
			const handler = registry.resolve(job.kind);
			await handler(job);
		} catch (error) {
			handlerFailure = { error };
		}

		if (handlerFailure === undefined) {
			// Success bookkeeping — a blip here is `lost`, never a handler failure.
			try {
				const completed = await withTenant(tenantId, (tx) => completeJob(tx, ref), db);
				if (completed) summary.done += 1;
				else summary.lost += 1;
			} catch (error) {
				summary.lost += 1;
				options.onBookkeepingError?.(job, error);
			}
			continue;
		}

		// Failure bookkeeping.
		try {
			const outcome = await withTenant(
				tenantId,
				(tx) =>
					releaseJob(tx, {
						...ref,
						lastError: describeFailure(handlerFailure.error),
						backoffMs: backoff(job.attempts + 1),
					}),
				db,
			);
			if (outcome === null) summary.lost += 1;
			else if (outcome.status === 'dead') summary.dead += 1;
			else summary.retried += 1;
			options.onFailure?.(job, handlerFailure.error, outcome);
		} catch (error) {
			summary.lost += 1;
			options.onBookkeepingError?.(job, error);
		}
	}

	return summary;
}

/* ────────────────────────── the worker loop ────────────────────────── */

export interface WorkerLoopOptions extends DispatchOptions {
	/** Sleep between cycles that did not fill their batch. Default 1s. */
	idleDelayMs?: number;
	/**
	 * Transient-cycle tolerance (review NIT-1): a cycle that throws (database
	 * blip) is logged via `onCycleError` and the loop idles and retries rather
	 * than exiting; after this many CONSECUTIVE failures the error is rethrown
	 * so the Deployment's 78-restart path still exists for a database that is
	 * genuinely down. Default 5.
	 */
	maxConsecutiveCycleFailures?: number;
	/** Observability seam — called after every successful cycle. */
	onCycle?: (summary: DispatchSummary) => void;
	/** Observability seam — called on each failed cycle with the running count. */
	onCycleError?: (error: unknown, consecutiveFailures: number) => void;
	/** Injection seam for tests; defaults to {@link dispatchOnce}. */
	dispatchOnceFn?: typeof dispatchOnce;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done(): void {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve();
		}
		signal?.addEventListener('abort', done, { once: true });
	});
}

/**
 * Poll until aborted. A cycle that filled its whole batch loops immediately
 * (there is probably more work); anything less idles for `idleDelayMs`.
 * Shutdown is cooperative at JOB granularity (the signal is passed into
 * `dispatchOnce`, review LOW-4) — the in-flight handler is never interrupted,
 * so the infra Deployment's `terminationGracePeriodSeconds` must cover one
 * handler plus one bookkeeping transaction, not a whole batch.
 */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
	const {
		idleDelayMs = 1_000,
		maxConsecutiveCycleFailures = 5,
		onCycle,
		onCycleError,
		dispatchOnceFn = dispatchOnce,
		...dispatchOptions
	} = options;
	const batchSize = dispatchOptions.batchSize ?? DEFAULT_BATCH_SIZE;
	const signal = dispatchOptions.signal;

	let consecutiveFailures = 0;
	while (!signal?.aborted) {
		let summary: DispatchSummary;
		try {
			summary = await dispatchOnceFn(dispatchOptions);
			consecutiveFailures = 0;
		} catch (error) {
			consecutiveFailures += 1;
			onCycleError?.(error, consecutiveFailures);
			if (consecutiveFailures >= maxConsecutiveCycleFailures) throw error;
			await abortableDelay(idleDelayMs, signal);
			continue;
		}
		onCycle?.(summary);
		if (signal?.aborted) break;
		if (summary.claimed < batchSize) {
			await abortableDelay(idleDelayMs, signal);
		}
	}
}
