/**
 * Member projection intent (TIN-3964; unified Member v0 identity carrier).
 *
 * Activation commits one immutable, ids-only outbox row for each downstream
 * entitlement in the same transaction as the membership transition. Delivery
 * gates control claiming, never entitlement: while a protected projection
 * interface is absent, its row remains pending with zero attempts.
 *
 * This module deliberately contains no Mailman, mailbox, archive, Keycloak,
 * cluster, or credential client. Those capabilities belong to protected,
 * restricted interfaces outside this public application repository.
 */

import { inArray } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import type { Membership, OutboxJob } from '../db/schema';
import { membership as membershipTable } from '../db/schema';
import { DeadIdempotencyKeyError, enqueue } from '../outbox/enqueue';

export const PROVISION_JOB_KINDS = [
	'provision.ensure_identity',
	'provision.enable_mailbox',
	'provision.add_lists',
	'provision.ensure_archive',
] as const;

export const PROVISION_GENERATION = 1 as const;

export type ProvisionJobKind = (typeof PROVISION_JOB_KINDS)[number];

/** `<tenant>:membership:<id>:<effect>:g1` — one receipt per projection generation. */
export function provisionIdempotencyKey(tenantId: string, membershipId: string, kind: ProvisionJobKind): string {
	const effect = kind.slice('provision.'.length);
	return `${tenantId}:membership:${membershipId}:${effect}:g${PROVISION_GENERATION}`;
}

async function enqueueProjection(tx: DbTransaction, row: Membership, kind: ProvisionJobKind) {
	return enqueue(tx, {
		kind,
		aggregateType: 'membership',
		aggregateId: row.id,
		payload: {
			schemaVersion: 1,
			tenantId: row.tenantId,
			membershipId: row.id,
			personId: row.personId,
			generation: PROVISION_GENERATION,
		},
		idempotencyKey: provisionIdempotencyKey(row.tenantId, row.id, kind),
	});
}

/** Enqueue the four projection intents inside the activation transaction. */
export async function enqueueProvisioning(tx: DbTransaction, row: Membership): Promise<OutboxJob[]> {
	const jobs: OutboxJob[] = [];
	for (const kind of PROVISION_JOB_KINDS) {
		jobs.push((await enqueueProjection(tx, row, kind)).job);
	}
	return jobs;
}

/**
 * A verified-email change is a new request to converge the same list
 * entitlement. The inserted person-email row id identifies the address
 * revision without putting the mutable address in the outbox payload.
 */
export function emailListReconciliationIdempotencyKey(
	tenantId: string,
	membershipId: string,
	personEmailId: string,
): string {
	return `${tenantId}:membership:${membershipId}:add_lists:email:${personEmailId}`;
}

export async function enqueueEmailListReconciliation(
	tx: DbTransaction,
	row: Membership,
	personEmailId: string,
): Promise<OutboxJob> {
	const result = await enqueue(tx, {
		kind: 'provision.add_lists',
		aggregateType: 'membership',
		aggregateId: row.id,
		payload: {
			schemaVersion: 1,
			tenantId: row.tenantId,
			membershipId: row.id,
			personId: row.personId,
			generation: PROVISION_GENERATION,
		},
		idempotencyKey: emailListReconciliationIdempotencyKey(row.tenantId, row.id, personEmailId),
	});
	return result.job;
}

/**
 * Add missing generation-1 intent for Active/paused members created before
 * this carrier. A standing dead row is already durable evidence requiring the
 * audited replay lane; it must not abort worker startup or prevent unrelated
 * members and projection kinds from being repaired.
 *
 * Returns the number of memberships for which at least one missing intent was
 * inserted, not the number scanned.
 */
export async function reconcileActiveProvisioning(tx: DbTransaction): Promise<number> {
	const rows = await tx
		.select()
		.from(membershipTable)
		.where(inArray(membershipTable.status, ['active', 'paused']))
		.orderBy(membershipTable.createdAt, membershipTable.id);

	let repaired = 0;
	for (const row of rows) {
		let insertedForMembership = false;
		for (const kind of PROVISION_JOB_KINDS) {
			try {
				const result = await enqueueProjection(tx, row, kind);
				insertedForMembership ||= result.enqueued;
			} catch (error) {
				if (error instanceof DeadIdempotencyKeyError) continue;
				throw error;
			}
		}
		if (insertedForMembership) repaired += 1;
	}
	return repaired;
}
