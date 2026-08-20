/**
 * The outbox dispatcher: claim, execute, complete-or-retry, dead-letter
 * (TIN-3817 slice S3, spec §3.1 "Claim" / "Retry" / "Dead-letter").
 *
 * SHAPE. Three tx-first primitives mirror `enqueue(tx, job)` — `claimBatch`,
 * `completeJob`, and `releaseJob` all take the transaction handle first — and
 * `dispatchOnce` composes them the only correct way: the CLAIM commits its
 * leases in one short transaction, every handler runs OUTSIDE any transaction
 * (that is what the lease is for — a row must never sit row-locked for the
 * duration of an external effect), and each completion/release commits in its
 * own transaction afterwards.
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
 * STALE-LEASE RECLAIM. The claim admits `'leased'` rows whose
 * `lease_expires_at` has passed (spec §3.1): a worker that dies mid-job does
 * not strand its rows. The complete/release statements guard on
 * `lease_owner = $worker AND status = 'leased'`, so a dead worker's zombie
 * process cannot complete or re-schedule a row that was reclaimed from it —
 * its write simply matches zero rows and is counted as `lost`.
 *
 * RETRY. On handler failure: `attempts + 1`, `last_error` set, `available_at`
 * pushed forward by exponential FULL-jitter backoff, status back to
 * `'pending'` — and the lease columns cleared, which is not cosmetic: the
 * claim admits a row whose lease is null OR expired, so a released row that
 * kept its 60-second lease would be re-claimable the moment that lease lapsed,
 * overriding any backoff longer than the lease (spec §3.1).
 *
 * DEAD-LETTER. `attempts >= max_attempts` lands `status = 'dead'` in the same
 * release statement; dead rows are excluded by the claim's status predicate,
 * stay inspectable, and are never dropped. Operator replay (reset `attempts`
 * and `status`, audited) is a later slice's surface — spec §3.1 scopes S3 to
 * the queue, and nothing here deletes a row, ever.
 */

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
 * component keeps them retrying in lockstep.
 *
 * @param attempts the attempt count AFTER the failure being scheduled (≥ 1)
 */
export function fullJitterBackoffMs(attempts: number, options: BackoffOptions = {}): number {
	const { baseMs = DEFAULT_BACKOFF_BASE_MS, capMs = DEFAULT_BACKOFF_CAP_MS, random = Math.random } = options;
	const exponent = Math.max(1, Math.floor(attempts));
	const ceiling = Math.min(capMs, baseMs * 2 ** exponent);
	return Math.floor(random() * ceiling);
}

/** Bound `last_error` so a looping stack trace cannot bloat the row. */
export function describeFailure(error: unknown): string {
	const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return text.slice(0, MAX_LAST_ERROR_LENGTH);
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

function toClaimedJob(row: RawOutboxRow): ClaimedJob {
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
	};
}

/* ────────────────────────── tx-first primitives ────────────────────────── */

export interface ClaimOptions {
	/** Stable identity of this worker process, written to `lease_owner`. */
	worker: string;
	batchSize?: number;
	leaseSeconds?: number;
}

/**
 * Claim a bounded batch with `FOR UPDATE SKIP LOCKED` — spec §3.1's statement
 * verbatim. Two dispatchers over one batch claim disjoint rows and neither
 * blocks; rows with a live lease are skipped by the predicate, rows whose
 * lease expired are reclaimed by it.
 */
export async function claimBatch(tx: DbTransaction, options: ClaimOptions): Promise<ClaimedJob[]> {
	const { worker, batchSize = DEFAULT_BATCH_SIZE, leaseSeconds = DEFAULT_LEASE_SECONDS } = options;
	if (!worker.trim()) throw new Error('outbox claim: "worker" must be a non-empty string');
	if (!Number.isInteger(batchSize) || batchSize < 1) {
		throw new Error(`outbox claim: "batchSize" must be a positive integer, got ${batchSize}`);
	}
	if (!(leaseSeconds > 0)) {
		throw new Error(`outbox claim: "leaseSeconds" must be positive, got ${leaseSeconds}`);
	}

	const result = await tx.execute<RawOutboxRow>(sql`
		with claimed as (
			select id from outbox_job
			 where status in ('pending', 'leased')
			   and available_at <= now()
			   and (lease_expires_at is null or lease_expires_at < now())
			 order by available_at
			 limit ${batchSize}
			 for update skip locked
		)
		update outbox_job o
		   set status = 'leased',
		       lease_owner = ${worker},
		       lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
		       updated_at = now()
		  from claimed c
		 where o.id = c.id
		returning o.*
	`);

	return result.rows.map(toClaimedJob);
}

export interface LeaseRef {
	id: string;
	worker: string;
}

/**
 * Mark one leased job done. Returns false when the guard matched zero rows —
 * the lease was reclaimed by another worker after expiring, so this worker's
 * result no longer owns the row (the job may have run more than once; only the
 * consumer-side receipt is single, spec §3.1).
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
		   and lease_owner = ${ref.worker}
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
 * no longer this worker's.
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
		   and lease_owner = ${input.worker}
		returning status, attempts
	`);
	const row = result.rows[0];
	return row ? { status: row.status, attempts: row.attempts } : null;
}

/* ────────────────────────── the dispatch cycle ────────────────────────── */

export interface DispatchOptions {
	/** The one configured GFTB tenant this worker serves (TIN-3817 scope). */
	tenantId: string;
	/** Stable worker identity for `lease_owner`. */
	worker: string;
	registry: HandlerRegistry;
	/** Injection seam for tests; production flows through `withTenant`'s default. */
	db?: Db;
	batchSize?: number;
	leaseSeconds?: number;
	/** Injection seam for tests; defaults to {@link fullJitterBackoffMs}. */
	backoffMs?: (attempts: number) => number;
	/** Observability seam — called once per failed job with the outcome. */
	onFailure?: (job: ClaimedJob, error: unknown, outcome: ReleaseOutcome | null) => void;
}

export interface DispatchSummary {
	claimed: number;
	done: number;
	retried: number;
	dead: number;
	/** Completions/releases that matched zero rows: the lease had been reclaimed. */
	lost: number;
}

/**
 * One dispatch cycle: claim a batch (one transaction), run each handler
 * outside any transaction, then commit each job's outcome (one transaction
 * each). At-least-once by construction; a crash anywhere leaves rows that the
 * lease expiry re-admits.
 */
export async function dispatchOnce(options: DispatchOptions): Promise<DispatchSummary> {
	const { tenantId, worker, registry, db, batchSize, leaseSeconds } = options;
	const backoff = options.backoffMs ?? fullJitterBackoffMs;

	const claimed = await withTenant(tenantId, (tx) => claimBatch(tx, { worker, batchSize, leaseSeconds }), db);

	const summary: DispatchSummary = { claimed: claimed.length, done: 0, retried: 0, dead: 0, lost: 0 };

	for (const job of claimed) {
		try {
			const handler = registry.resolve(job.kind);
			await handler(job);
			const completed = await withTenant(tenantId, (tx) => completeJob(tx, { id: job.id, worker }), db);
			if (completed) summary.done += 1;
			else summary.lost += 1;
		} catch (error) {
			const outcome = await withTenant(
				tenantId,
				(tx) =>
					releaseJob(tx, {
						id: job.id,
						worker,
						lastError: describeFailure(error),
						backoffMs: backoff(job.attempts + 1),
					}),
				db,
			);
			if (outcome === null) summary.lost += 1;
			else if (outcome.status === 'dead') summary.dead += 1;
			else summary.retried += 1;
			options.onFailure?.(job, error, outcome);
		}
	}

	return summary;
}

/* ────────────────────────── the worker loop ────────────────────────── */

export interface WorkerLoopOptions extends DispatchOptions {
	/** Sleep between cycles that did not fill their batch. Default 1s. */
	idleDelayMs?: number;
	/** Cooperative shutdown: the loop exits after the in-flight cycle. */
	signal?: AbortSignal;
	/** Observability seam — called after every cycle. */
	onCycle?: (summary: DispatchSummary) => void;
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
 * Handlers in flight are never interrupted — abort is checked between jobs'
 * transactions only at cycle boundaries, and an abandoned lease is the
 * designed-for case anyway.
 */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
	const { idleDelayMs = 1_000, signal, onCycle, ...dispatchOptions } = options;
	const batchSize = dispatchOptions.batchSize ?? DEFAULT_BATCH_SIZE;

	while (!signal?.aborted) {
		const summary = await dispatchOnce(dispatchOptions);
		onCycle?.(summary);
		if (signal?.aborted) break;
		if (summary.claimed < batchSize) {
			await abortableDelay(idleDelayMs, signal);
		}
	}
}
