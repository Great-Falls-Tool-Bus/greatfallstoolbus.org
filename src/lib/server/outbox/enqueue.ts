/**
 * `enqueue(tx, job)` — the only way a side effect enters the outbox
 * (TIN-3817 slice S3, spec §3.1 "Enqueue").
 *
 * THE SIGNATURE IS THE MECHANISM. The first parameter is the caller's
 * transaction handle and there is deliberately NO overload that opens its own:
 * the enqueue rides the SAME transaction as the domain write that caused it,
 * so "a rolled-back transaction leaves zero outbox rows" is structurally true
 * rather than a discipline (spec §3.1). If you are holding a `Db` and not a
 * `DbTransaction`, you are in the wrong place — go through
 * `withTenant(tenantId, fn)` and do your domain write and this enqueue inside
 * the same `fn`.
 *
 * TENANT COMES FROM THE TRANSACTION, NOT FROM THE CALLER. The row's
 * `tenant_id` is read back from the `app.tenant_id` GUC that `withTenant`
 * pinned inside this transaction. A caller cannot express "enqueue for another
 * tenant"; a transaction with no tenant fails fast here with a real message
 * instead of failing later as an RLS `WITH CHECK` violation.
 *
 * IDEMPOTENCY ON THE UNIQUE KEY. `outbox_job_idem_uniq (tenant_id, kind,
 * idempotency_key)` is the dedupe line: a second enqueue with the same key is
 * absorbed (`ON CONFLICT DO NOTHING`) and the EXISTING row is returned with
 * `enqueued: false`. First write wins — a differing payload on a duplicate key
 * is not written, because two payloads under one idempotency key is a caller
 * bug the queue must not paper over by guessing which one is true.
 *
 * EXCEPT WHEN THE STANDING ROW IS DEAD. A dead-lettered row holds its unique
 * key forever, so silently absorbing a re-enqueue against it would tell the
 * caller "queued" about a job nothing will ever run (PR #173 review,
 * MEDIUM-2). That case throws `DeadIdempotencyKeyError` — loudly, inside the
 * caller's transaction, so the domain write rolls back with it and the caller
 * decides deliberately. Recovering the key is the operator's replay surface
 * (spec §3.1: reset attempts/status, audited — a named hand-off, not yet
 * built); whether enqueue should some day resurrect instead is flagged for
 * ratification sitting #2, resolver Jess.
 */

import { and, eq } from 'drizzle-orm';
import { outboxJob } from '../db/schema';
import { currentTenantId } from '../db/tenant';
import type { DbTransaction, EnqueueInput, EnqueueResult } from './schema';

/**
 * The `(tenant, kind, idempotency_key)` already dead-lettered; the enqueue was
 * refused rather than silently absorbed. The caller's transaction (domain
 * write included) rolls back unless the caller catches this deliberately.
 */
export class DeadIdempotencyKeyError extends Error {
	readonly kind: string;
	readonly idempotencyKey: string;

	constructor(kind: string, idempotencyKey: string) {
		super(
			`outbox enqueue: (${kind}, ${idempotencyKey}) is dead-lettered after exhausting its attempts — ` +
				'nothing will ever run it. Re-enqueueing the same key cannot revive it; a dead row is ' +
				'replayable only through the audited operator surface (spec §3.1). Use a new idempotency key ' +
				'only if this is genuinely a NEW effect.',
		);
		this.name = 'DeadIdempotencyKeyError';
		this.kind = kind;
		this.idempotencyKey = idempotencyKey;
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fail fast on the inputs the unique key and the dispatcher depend on. */
function assertInput(input: EnqueueInput): void {
	if (!input.kind?.trim()) throw new Error('outbox enqueue: "kind" must be a non-empty string');
	if (!input.idempotencyKey?.trim()) {
		throw new Error('outbox enqueue: "idempotencyKey" must be a non-empty string');
	}
	if (!input.aggregateType?.trim()) {
		throw new Error('outbox enqueue: "aggregateType" must be a non-empty string');
	}
	if (!UUID_RE.test(input.aggregateId ?? '')) {
		throw new Error(`outbox enqueue: "aggregateId" must be a UUID, got ${JSON.stringify(input.aggregateId)}`);
	}
	if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1)) {
		throw new Error(`outbox enqueue: "maxAttempts" must be a positive integer, got ${input.maxAttempts}`);
	}
	if (input.payload === undefined) {
		throw new Error('outbox enqueue: "payload" is required (use null for an intentionally empty payload)');
	}
}

/**
 * Insert one job into the outbox, inside the caller's transaction.
 *
 * @param tx the SAME transaction handle the domain write is using — from
 *   `withTenant(tenantId, fn)`. Never a bare pool or `Db`.
 * @param input see {@link EnqueueInput}
 * @returns the inserted row (`enqueued: true`) or, when the
 *   `(tenant, kind, idempotency_key)` unique key already existed, the
 *   pre-existing row (`enqueued: false`).
 */
export async function enqueue(tx: DbTransaction, input: EnqueueInput): Promise<EnqueueResult> {
	assertInput(input);

	const tenantId = await currentTenantId(tx);
	if (!tenantId) {
		throw new Error(
			'outbox enqueue: this transaction has no app.tenant_id — enqueue only inside withTenant(tenantId, fn), ' +
				'riding the same transaction as the domain write that caused the job.',
		);
	}

	const inserted = await tx
		.insert(outboxJob)
		.values({
			tenantId,
			kind: input.kind,
			aggregateType: input.aggregateType,
			aggregateId: input.aggregateId,
			payload: input.payload,
			idempotencyKey: input.idempotencyKey,
			...(input.availableAt !== undefined ? { availableAt: input.availableAt } : {}),
			...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
		})
		.onConflictDoNothing({
			target: [outboxJob.tenantId, outboxJob.kind, outboxJob.idempotencyKey],
		})
		.returning();

	if (inserted.length === 1) {
		return { job: inserted[0], enqueued: true };
	}

	// The unique key already exists: the idempotent re-enqueue path. Read the
	// standing row back inside the same transaction so the caller gets the row
	// that actually governs dispatch.
	const existing = await tx
		.select()
		.from(outboxJob)
		.where(
			and(
				eq(outboxJob.tenantId, tenantId),
				eq(outboxJob.kind, input.kind),
				eq(outboxJob.idempotencyKey, input.idempotencyKey),
			),
		)
		.limit(1);

	if (existing.length !== 1) {
		// Unreachable unless the conflicting row was deleted between the insert
		// and this read by a concurrent transaction — surface it rather than
		// inventing a row.
		throw new Error(
			`outbox enqueue: ON CONFLICT absorbed (${input.kind}, ${input.idempotencyKey}) but the standing row is gone`,
		);
	}

	if (existing[0].status === 'dead') {
		throw new DeadIdempotencyKeyError(input.kind, input.idempotencyKey);
	}

	return { job: existing[0], enqueued: false };
}
