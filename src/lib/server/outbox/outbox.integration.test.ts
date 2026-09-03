/**
 * S3 acceptance rows against real PostgreSQL (TIN-3817, spec §1.5 + §3.1).
 *
 * Row map, in the slice table's order:
 *
 *   rolled-back tx leaves zero outbox rows      "enqueue rides the domain tx"
 *   two dispatchers claim disjoint, non-blocking SKIP LOCKED, proved with BOTH
 *                                               transactions held open
 *   throwing handler → attempts+1, later        retry/backoff, row never lost
 *     available_at, row kept
 *   dead worker's lease reclaimed; receipt      at-least-once, exactly-one
 *     observed exactly once                     RECEIPT (job may run twice)
 *   attempts ≥ max_attempts → 'dead', unclaimed dead-letter terminal
 *   same idempotency_key twice → one effect     unique-key dedupe + consumer
 *   permanently failing projection leaves the   committed state is never
 *     committed domain row untouched            rolled back by the queue
 *
 * Plus the PR #173 adversarial review's executed hostile scenarios, committed
 * here so they cannot regress: per-job lease renewal under the reviewer's
 * batch-3/1s-lease/900ms-handler race (HIGH-1); the shared-GFTB_WORKER_ID
 * zombie (HIGH-2); a completion-transaction blip on a succeeded effect
 * (MEDIUM-1); re-enqueue against a dead key (MEDIUM-2); a ghost tenant at the
 * worker boundary (MEDIUM-3); the READ COMMITTED assertion (LOW-1); and
 * shutdown between jobs (LOW-4).
 *
 * Every test runs in its OWN tenant, so row-level security isolates each row's
 * world and no test can claim another's jobs — which is itself a standing
 * assertion that the dispatcher cannot cross tenants.
 *
 * Suite runs as `gftb_app` (DML-only, non-owner) — the role the worker
 * Deployment really gets — over migrations applied by `gftb_migrator`, exactly
 * like the S1 suite. Fixture provenance (testcontainer postgres:16.15 vs the
 * server named by GFTB_TEST_PG_SUPERUSER_DSN) is reported by
 * `just test-integration`; only the container path proves the 16.15 pin.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The db/client seam (getDb/createDb) is lint-fenced to application code going
// through withTenant. This FIXTURE builds its own client over the runtime
// role's DSN the same way db/client does, because the process-wide pool reads
// DATABASE_URL, which deliberately does not exist here.
import { schema, type Db } from '../db/client';
import { withTenant } from '../db/tenant';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { runMigrator } from '../db/migrate';
import { claimBatch, completeJob, dispatchOnce, releaseJob } from './dispatch';
import { DeadIdempotencyKeyError, enqueue } from './enqueue';
import { EMPTY_REGISTRY, createHandlerRegistry } from './handlers';
import type { ClaimedJob, DbTransaction, OutboxHandler } from './schema';
import { WORKER_EXIT, runWorker } from '../worker';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

beforeAll(async () => {
	fixture = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', fixture.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(fixture);

	pool = new pg.Pool({ connectionString: fixture.runtimeDsn, max: 8 });
	db = drizzle(pool, { schema });
}, 240_000);

afterAll(async () => {
	await pool?.end();
	await fixture?.stop();
});

/** A fresh RLS-isolated world per test. */
async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s3-${randomUUID().slice(0, 8)}`);
}

function jobInput(overrides: Partial<Parameters<typeof enqueue>[1]> = {}) {
	return {
		kind: 'fixture.noop',
		aggregateType: 'fixture',
		aggregateId: randomUUID(),
		payload: { fixture: true },
		idempotencyKey: randomUUID(),
		...overrides,
	};
}

async function outboxRows(tenantId: string): Promise<Array<Record<string, unknown>>> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select id, kind, status, attempts, max_attempts, lease_owner, lease_expires_at,
			        last_error, available_at, available_at > now() as available_in_future
			   from outbox_job order by created_at`,
		);
		return rows;
	});
}

async function displayName(tenantId: string): Promise<string> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query<{ display_name: string }>('select display_name from tenant');
		return rows[0].display_name;
	});
}

/**
 * A consumer with a receipt store — the §3.1 contract that exactly-once is the
 * CONSUMER's property: the receipt is checked before the effect, so the job
 * may run any number of times while the effect happens once.
 */
function receiptConsumer() {
	const receipts = new Map<string, number>();
	let invocations = 0;
	const handler: OutboxHandler = async (job) => {
		invocations += 1;
		if (receipts.has(job.idempotencyKey)) return;
		receipts.set(job.idempotencyKey, invocations);
	};
	return { handler, receipts, invocations: () => invocations };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('enqueue rides the SAME transaction as the domain write', () => {
	it('a rolled-back transaction leaves zero outbox rows AND no domain write', async () => {
		const tenantId = await newTenant();
		const before = await displayName(tenantId);

		await expect(
			withTenant(
				tenantId,
				async (tx) => {
					// The domain write the job is about — same unit of work.
					await tx.execute(sql`update tenant set display_name = 'never-committed'`);
					await enqueue(tx, jobInput({ kind: 'fixture.rollback' }));
					throw new Error('crash between enqueue and commit');
				},
				db,
			),
		).rejects.toThrow('crash between enqueue and commit');

		expect(await outboxRows(tenantId)).toEqual([]);
		expect(await displayName(tenantId)).toBe(before);
	});

	it('a committed transaction leaves the domain write and the job together', async () => {
		const tenantId = await newTenant();
		const result = await withTenant(
			tenantId,
			async (tx) => {
				await tx.execute(sql`update tenant set display_name = 'committed-together'`);
				return enqueue(tx, jobInput({ kind: 'fixture.commit' }));
			},
			db,
		);

		expect(result.enqueued).toBe(true);
		expect(result.job.status).toBe('pending');
		const rows = await outboxRows(tenantId);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('fixture.commit');
		expect(await displayName(tenantId)).toBe('committed-together');
	});

	it('refuses a transaction that carries no tenant', async () => {
		await expect(db.transaction(async (tx) => enqueue(tx, jobInput()))).rejects.toThrow(/no app\.tenant_id/);
	});
});

describe('idempotency on the unique key (tenant_id, kind, idempotency_key)', () => {
	it('re-enqueueing the same key returns the standing row and writes nothing', async () => {
		const tenantId = await newTenant();
		const key = randomUUID();

		const first = await withTenant(
			tenantId,
			(tx) => enqueue(tx, jobInput({ kind: 'fixture.idem', idempotencyKey: key, payload: { version: 1 } })),
			db,
		);
		const second = await withTenant(
			tenantId,
			(tx) => enqueue(tx, jobInput({ kind: 'fixture.idem', idempotencyKey: key, payload: { version: 2 } })),
			db,
		);

		expect(first.enqueued).toBe(true);
		expect(second.enqueued).toBe(false);
		expect(second.job.id).toBe(first.job.id);
		// First write wins: the duplicate's differing payload was NOT written.
		expect(second.job.payload).toEqual({ version: 1 });
		expect(await outboxRows(tenantId)).toHaveLength(1);
	});

	it('an idempotent consumer invoked twice with the same key produces one external effect', async () => {
		const tenantId = await newTenant();
		const key = randomUUID();
		const consumer = receiptConsumer();
		const registry = createHandlerRegistry({ 'fixture.effect': consumer.handler });

		// Two enqueues (one absorbed), then a dispatch, then a REPLAY of the same
		// key after the row completed — the consumer's receipt is what keeps the
		// external effect single across all of it.
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.effect', idempotencyKey: key })), db);
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.effect', idempotencyKey: key })), db);

		const summary = await dispatchOnce({ tenantId, worker: 'idem-worker', registry, db });
		expect(summary).toMatchObject({ claimed: 1, done: 1 });

		// Force the job to run AGAIN (operator-replay shape: reset status), so the
		// handler genuinely executes twice with the same idempotency key.
		await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			await client.query(
				`update outbox_job set status = 'pending', available_at = now() where kind = 'fixture.effect'`,
			);
		});
		const replay = await dispatchOnce({ tenantId, worker: 'idem-worker', registry, db });
		expect(replay).toMatchObject({ claimed: 1, done: 1 });

		expect(consumer.invocations()).toBe(2);
		expect(consumer.receipts.size).toBe(1);
	});
});

describe('claim: bounded batches, FOR UPDATE SKIP LOCKED, lease-based', () => {
	it('two dispatchers over one batch claim disjoint rows and neither blocks', async () => {
		const tenantId = await newTenant();
		for (let i = 0; i < 4; i += 1) {
			await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.race' })), db);
		}

		let releaseA!: () => void;
		const holdA = new Promise<void>((resolve) => (releaseA = resolve));
		let signalAClaimed!: () => void;
		const aClaimed = new Promise<void>((resolve) => (signalAClaimed = resolve));

		// Dispatcher A claims 2 and HOLDS ITS TRANSACTION OPEN — its row locks
		// are live while B claims. Without SKIP LOCKED, B would block on them.
		const a = withTenant(
			tenantId,
			async (tx) => {
				const rows = await claimBatch(tx, { worker: 'racer-a', batchSize: 2 });
				signalAClaimed();
				await holdA;
				return rows;
			},
			db,
		);

		const b = (async () => {
			await aClaimed;
			const started = Date.now();
			const rows = await withTenant(tenantId, (tx) => claimBatch(tx, { worker: 'racer-b', batchSize: 4 }), db);
			return { rows, elapsedMs: Date.now() - started };
		})();

		let bResult: Awaited<typeof b>;
		try {
			bResult = (await Promise.race([
				b,
				sleep(5_000).then(() => {
					throw new Error('dispatcher B blocked on dispatcher A’s open transaction — SKIP LOCKED is not working');
				}),
			])) as Awaited<typeof b>;
		} finally {
			releaseA();
		}
		const aRows = await a;

		expect(aRows).toHaveLength(2);
		expect(bResult.rows).toHaveLength(2);
		expect(bResult.elapsedMs).toBeLessThan(4_000);
		const aIds = new Set(aRows.map((row: ClaimedJob) => row.id));
		for (const row of bResult.rows) expect(aIds.has(row.id)).toBe(false);
		for (const row of [...aRows, ...bResult.rows]) {
			expect(row.status).toBe('leased');
			expect(row.leaseExpiresAt).not.toBeNull();
		}
	});

	it('honors the partial claim index: the planner uses outbox_job_claimable for the claim predicate', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.plan' })), db);

		const plan = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			// Bias the planner away from a small-table seqscan so the row asserts
			// index USABILITY: if the query shape ever drifts off the partial
			// index's predicate, no setting makes this index appear.
			await client.query('set enable_seqscan = off');
			const { rows } = await client.query<{ 'QUERY PLAN': string }>(
				`explain (format text)
				 select id from outbox_job
				  where status in ('pending', 'leased')
				    and available_at <= now()
				    and (lease_expires_at is null or lease_expires_at < now())
				  order by available_at
				  limit 32
				  for update skip locked`,
			);
			return rows.map((row) => row['QUERY PLAN']).join('\n');
		});

		expect(plan).toContain('outbox_job_claimable');
	});

	it('refuses a non-READ COMMITTED transaction rather than raising 40001 mid-claim (review LOW-1)', async () => {
		// SKIP LOCKED skips under READ COMMITTED but raises serialization
		// failures under stricter isolation. withTenant does not pin a level
		// (S1's file, not this slice's to edit), so claimBatch asserts it.
		const tenantId = await newTenant();
		await expect(
			db.transaction(async (tx) => {
				await tx.execute(sql`set transaction isolation level repeatable read`);
				await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
				return claimBatch(tx, { worker: 'iso-probe' });
			}),
		).rejects.toThrow(/READ COMMITTED/);
	});

	it('does not claim a job whose available_at is in the future', async () => {
		const tenantId = await newTenant();
		await withTenant(
			tenantId,
			(tx) => enqueue(tx, jobInput({ kind: 'fixture.later', availableAt: new Date(Date.now() + 60_000) })),
			db,
		);

		const summary = await dispatchOnce({ tenantId, worker: 'early-bird', registry: EMPTY_REGISTRY, db });
		expect(summary.claimed).toBe(0);
	});

	it('never claims across tenants: another tenant’s claimable rows are invisible', async () => {
		const tenantA = await newTenant();
		const tenantB = await newTenant();
		await withTenant(tenantB, (tx) => enqueue(tx, jobInput({ kind: 'fixture.other-tenant' })), db);

		const summary = await dispatchOnce({ tenantId: tenantA, worker: 'wrong-tenant', registry: EMPTY_REGISTRY, db });
		expect(summary.claimed).toBe(0);
		const bRows = await outboxRows(tenantB);
		expect(bRows[0].status).toBe('pending');
	});
});

describe('retry: failure increments attempts, pushes available_at forward, keeps the row', () => {
	it('a handler that throws re-schedules with backoff and a recorded error', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.fails' })), db);
		const registry = createHandlerRegistry({
			'fixture.fails': async () => {
				throw new Error('boom: downstream 503');
			},
		});

		const summary = await dispatchOnce({
			tenantId,
			worker: 'retry-worker',
			registry,
			db,
			backoffMs: () => 60_000,
		});
		expect(summary).toMatchObject({ claimed: 1, retried: 1, done: 0, dead: 0 });

		const [row] = await outboxRows(tenantId);
		expect(row.status).toBe('pending');
		expect(row.attempts).toBe(1);
		expect(row.available_in_future).toBe(true);
		// Clearing the lease is load-bearing (spec §3.1): a released row that
		// kept its lease would be re-claimable when the lease lapsed, overriding
		// any backoff longer than the lease.
		expect(row.lease_owner).toBeNull();
		expect(row.lease_expires_at).toBeNull();
		expect(row.last_error).toContain('boom: downstream 503');

		// And the backoff is real: the row is not claimable again right now.
		const second = await dispatchOnce({ tenantId, worker: 'retry-worker', registry, db });
		expect(second.claimed).toBe(0);
	});
});

describe('stale-lease reclaim: a dead worker’s row is recovered, the receipt stays single', () => {
	it('reclaims after lease expiry; the job runs twice, the consumer-side receipt is observed exactly once', async () => {
		const tenantId = await newTenant();
		const consumer = receiptConsumer();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.reclaim' })), db);

		// Worker A claims with a 1-second lease, performs the effect, and DIES
		// before completing — the crash window §3.1's "job may run more than
		// once" names.
		const claimed = await withTenant(
			tenantId,
			(tx) => claimBatch(tx, { worker: 'doomed-worker', batchSize: 1, leaseSeconds: 1 }),
			db,
		);
		expect(claimed).toHaveLength(1);
		await consumer.handler(claimed[0]);
		expect(consumer.receipts.size).toBe(1);

		// While the lease is live, nobody else can have the row.
		const tooEarly = await withTenant(tenantId, (tx) => claimBatch(tx, { worker: 'rescue-worker', batchSize: 8 }), db);
		expect(tooEarly).toHaveLength(0);

		await sleep(1_200);

		// Lease expired: the ordinary claim query re-admits the row.
		const registry = createHandlerRegistry({ 'fixture.reclaim': consumer.handler });
		const rescue = await dispatchOnce({ tenantId, worker: 'rescue-worker', registry, db });
		expect(rescue).toMatchObject({ claimed: 1, done: 1 });

		expect(consumer.invocations()).toBe(2); // the job ran twice
		expect(consumer.receipts.size).toBe(1); // the receipt is single
		const [row] = await outboxRows(tenantId);
		expect(row.status).toBe('done');
	});

	it('a zombie cannot complete or release a reclaimed row EVEN when every replica shares one GFTB_WORKER_ID (review HIGH-2)', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.zombie' })), db);

		// Both replicas run with the SAME Deployment-level identity — the exact
		// configuration the review demonstrated collapsing a worker-name guard
		// (a shared name made the zombie's completeJob return true on a row the
		// reclaimer was mid-flight on).
		const [asDoomed] = await withTenant(
			tenantId,
			(tx) => claimBatch(tx, { worker: 'gftb-worker', batchSize: 1, leaseSeconds: 1 }),
			db,
		);
		await sleep(1_200);
		const [asRescuer] = await withTenant(tenantId, (tx) => claimBatch(tx, { worker: 'gftb-worker', batchSize: 1 }), db);
		expect(asRescuer.id).toBe(asDoomed.id);
		expect(asRescuer.leaseToken).not.toBe(asDoomed.leaseToken);

		// The zombie wakes up and reports success — the per-claim token guard
		// makes its write match zero rows instead of stomping the rescuer's claim.
		const zombieCompleted = await withTenant(
			tenantId,
			(tx) => completeJob(tx, { id: asDoomed.id, token: asDoomed.leaseToken }),
			db,
		);
		expect(zombieCompleted).toBe(false);

		// And its releaseJob is equally inert, so the rescuer's own failure can
		// never be swallowed by a zombie's earlier lease.
		const zombieReleased = await withTenant(
			tenantId,
			(tx) =>
				releaseJob(tx, {
					id: asDoomed.id,
					token: asDoomed.leaseToken,
					lastError: 'zombie says it failed',
					backoffMs: 0,
				}),
			db,
		);
		expect(zombieReleased).toBeNull();

		const [row] = await outboxRows(tenantId);
		expect(row.status).toBe('leased');
		expect(row.lease_owner).toBe(asRescuer.leaseToken);
		expect(row.last_error).toBeNull();
	});
});

describe('the lease covers the execution, not just the claim (review HIGH-1)', () => {
	it('reviewer scenario — batch 3, 1s lease, 900ms handlers, second worker at 1.4s: every job executes exactly once', async () => {
		const tenantId = await newTenant();
		for (let i = 0; i < 3; i += 1) {
			await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.slow' })), db);
		}

		const runsPerJob = new Map<string, number>();
		const inFlight = new Set<string>();
		let overlapped = false;
		const handler: OutboxHandler = async (job) => {
			if (inFlight.has(job.id)) overlapped = true;
			inFlight.add(job.id);
			runsPerJob.set(job.id, (runsPerJob.get(job.id) ?? 0) + 1);
			await sleep(900);
			inFlight.delete(job.id);
		};
		const registry = createHandlerRegistry({ 'fixture.slow': handler });

		// The review's failing run: worker A claimed all 3 under ONE 1s lease,
		// and worker B (arriving at 1.4s) re-claimed and re-ran jobs A was still
		// working through — 2 of 3 jobs executed concurrently by both, A ending
		// { claimed: 3, done: 1, lost: 2 }. Per-job renewal makes each job start
		// with a fresh full lease or be skipped as lost — never run twice.
		const workerA = dispatchOnce({ tenantId, worker: 'lease-a', registry, db, batchSize: 3, leaseSeconds: 1 });
		const workerB = (async () => {
			await sleep(1_400);
			return dispatchOnce({ tenantId, worker: 'lease-b', registry, db, batchSize: 3, leaseSeconds: 1 });
		})();
		const [a, b] = await Promise.all([workerA, workerB]);

		expect(overlapped).toBe(false);
		expect([...runsPerJob.values()]).toEqual([1, 1, 1]);
		expect(a.done + b.done).toBe(3);
		expect(a.lost).toBe(a.claimed - a.done);
		expect(b.lost).toBe(b.claimed - b.done);
		const rows = await outboxRows(tenantId);
		expect(rows.map((row) => row.status)).toEqual(['done', 'done', 'done']);
	}, 20_000);

	it('shutdown between jobs stops the cycle; the remainder is lost to lease expiry, never executed (review LOW-4)', async () => {
		const tenantId = await newTenant();
		for (let i = 0; i < 3; i += 1) {
			await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.abort' })), db);
		}
		const controller = new AbortController();
		let runs = 0;
		const registry = createHandlerRegistry({
			'fixture.abort': async () => {
				runs += 1;
				controller.abort(); // SIGTERM lands mid-first-handler
			},
		});

		const summary = await dispatchOnce({
			tenantId,
			worker: 'shutdown-worker',
			registry,
			db,
			signal: controller.signal,
		});

		// The in-flight job finishes and records; the un-run remainder is not
		// started — it stays leased and lease expiry re-admits it later.
		expect(runs).toBe(1);
		expect(summary).toMatchObject({ claimed: 3, done: 1, retried: 0, dead: 0, lost: 2 });
		const rows = await outboxRows(tenantId);
		expect(rows.filter((row) => row.status === 'done')).toHaveLength(1);
		expect(rows.filter((row) => row.status === 'leased')).toHaveLength(2);
	});
});

describe('completion failure is not handler failure (review MEDIUM-1)', () => {
	it('a completion-transaction blip is lost — a succeeded effect can never dead-letter', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.blip', maxAttempts: 1 })), db);
		let handlerRuns = 0;
		const registry = createHandlerRegistry({
			'fixture.blip': async () => {
				handlerRuns += 1;
			},
		});

		// Fail exactly the cycle's THIRD transaction — claim (1), per-job
		// renewal (2), completion (3) — reproducing the review's injected
		// connection failure on the completion commit only.
		let txCount = 0;
		const flaky = new Proxy(db, {
			get(target, prop) {
				if (prop === 'transaction') {
					return (fn: (tx: DbTransaction) => Promise<unknown>) => {
						txCount += 1;
						if (txCount === 3) return Promise.reject(new Error('connection terminated unexpectedly'));
						return target.transaction(fn);
					};
				}
				return Reflect.get(target, prop, target);
			},
		}) as Db;

		const bookkeeping: unknown[] = [];
		const summary = await dispatchOnce({
			tenantId,
			worker: 'blip-worker',
			registry,
			db: flaky,
			onBookkeepingError: (_job, error) => bookkeeping.push(error),
		});

		expect(handlerRuns).toBe(1);
		expect(summary).toMatchObject({ claimed: 1, done: 0, retried: 0, dead: 0, lost: 1 });
		expect(bookkeeping).toHaveLength(1);

		// The review's failing shape was attempts=1 / status='dead' /
		// last_error='connection terminated…' on a job whose effect SUCCEEDED —
		// with max_attempts=1, a lie in the dead-letter queue. The truth now:
		// the blip never touches the row; lease expiry re-admits it and the
		// consumer's receipt absorbs the repeat.
		const [row] = await outboxRows(tenantId);
		expect(row.attempts).toBe(0);
		expect(row.status).toBe('leased');
		expect(row.last_error).toBeNull();
	});
});

describe('a dead key refuses re-enqueue loudly (review MEDIUM-2)', () => {
	it('throws DeadIdempotencyKeyError and rolls the caller’s domain write back with it', async () => {
		const tenantId = await newTenant();
		const key = randomUUID();
		await withTenant(
			tenantId,
			(tx) => enqueue(tx, jobInput({ kind: 'fixture.dead-key', idempotencyKey: key, maxAttempts: 1 })),
			db,
		);
		const burned = await dispatchOnce({
			tenantId,
			worker: 'burner',
			registry: EMPTY_REGISTRY,
			db,
			backoffMs: () => 0,
		});
		expect(burned.dead).toBe(1);

		// The review's silent shape: { enqueued: false, status: 'dead' }, new
		// payload dropped on the floor, caller told "queued". Now: loud, and the
		// domain write in the same transaction rolls back with it.
		const before = await displayName(tenantId);
		await expect(
			withTenant(
				tenantId,
				async (tx) => {
					await tx.execute(sql`update tenant set display_name = 'must-roll-back'`);
					await enqueue(tx, jobInput({ kind: 'fixture.dead-key', idempotencyKey: key }));
				},
				db,
			),
		).rejects.toThrow(DeadIdempotencyKeyError);

		expect(await displayName(tenantId)).toBe(before);
		expect(await outboxRows(tenantId)).toHaveLength(1);
	});
});

describe('the worker boundary fails closed on an unknown tenant (review MEDIUM-3)', () => {
	it('a ghost tenant id exits 78 naming the tenant; a real one dispatches', async () => {
		// The review executed this at the bundled boundary: a random-but-valid
		// UUID produced `claimed=0 … exit 0` — a worker indistinguishable from a
		// healthy idle one, forever. This runs the SAME runWorker path (real
		// probe, real database, gftb_app credentials) in-process.
		const previous = process.env.DATABASE_URL;
		process.env.DATABASE_URL = fixture.runtimeDsn;
		try {
			const stderr: string[] = [];
			const ghost = randomUUID();
			const code = await runWorker({
				args: ['--once', '--tenant', ghost],
				io: { stdout: { write: () => undefined }, stderr: { write: (chunk: string) => stderr.push(chunk) } },
			});
			expect(code).toBe(WORKER_EXIT.UNAVAILABLE);
			expect(stderr.join('')).toContain(ghost);
			expect(stderr.join('')).toContain('does not exist');

			const tenantId = await newTenant();
			const stdout: string[] = [];
			const ok = await runWorker({
				args: ['--once', '--tenant', tenantId],
				io: { stdout: { write: (chunk: string) => stdout.push(chunk) }, stderr: { write: () => undefined } },
			});
			expect(ok).toBe(WORKER_EXIT.OK);
			expect(stdout.join('')).toContain('claimed=0');
		} finally {
			if (previous === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previous;
		}
	});
});

describe('dead-letter: bounded attempts, terminal, never rolls back the committed change', () => {
	it('a permanently failing projection dead-letters visibly and the committed domain row is untouched', async () => {
		const tenantId = await newTenant();

		// The committed state change the job projects — same transaction.
		await withTenant(
			tenantId,
			async (tx) => {
				await tx.execute(sql`update tenant set display_name = 'committed-fact'`);
				await enqueue(tx, jobInput({ kind: 'fixture.poison', maxAttempts: 2 }));
			},
			db,
		);

		const registry = createHandlerRegistry({
			'fixture.poison': async () => {
				throw new Error('projection target permanently gone');
			},
		});
		const run = () => dispatchOnce({ tenantId, worker: 'dead-worker', registry, db, backoffMs: () => 0 });

		expect(await run()).toMatchObject({ claimed: 1, retried: 1, dead: 0 });
		expect(await run()).toMatchObject({ claimed: 1, retried: 0, dead: 1 });

		const [row] = await outboxRows(tenantId);
		expect(row.status).toBe('dead');
		expect(row.attempts).toBe(2);
		expect(row.last_error).toContain('permanently gone');

		// Terminal: it stops being claimed…
		expect(await run()).toMatchObject({ claimed: 0 });
		// …it is never dropped…
		expect(await outboxRows(tenantId)).toHaveLength(1);
		// …and the committed membership-shaped fact it failed to project is untouched.
		expect(await displayName(tenantId)).toBe('committed-fact');
	});

	it('unknown work dead-letters visibly while an explicitly deferred kind stays pending at attempts=0', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.removed-kind', maxAttempts: 1 })), db);
		await withTenant(tenantId, (tx) => enqueue(tx, jobInput({ kind: 'fixture.delivery-gated' })), db);

		const summary = await dispatchOnce({
			tenantId,
			worker: 'no-handlers',
			registry: EMPTY_REGISTRY,
			deferredKinds: ['fixture.delivery-gated'],
			db,
			backoffMs: () => 0,
		});
		expect(summary).toMatchObject({ claimed: 1, dead: 1 });

		const rows = await outboxRows(tenantId);
		const unknown = rows.find((row) => row.kind === 'fixture.removed-kind');
		const deferred = rows.find((row) => row.kind === 'fixture.delivery-gated');
		expect(unknown).toMatchObject({ status: 'dead', attempts: 1 });
		expect(unknown?.last_error).toContain('UnknownJobKindError');
		expect(unknown?.last_error).toContain('fixture.removed-kind');
		expect(deferred).toMatchObject({ status: 'pending', attempts: 0, lease_owner: null });
	});
});
