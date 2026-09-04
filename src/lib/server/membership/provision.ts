/**
 * Member projection intent (TIN-3964; unified Member v0 identity carrier).
 *
 * Activation commits the two immutable, ids-only outbox rows ratified by Meta
 * #58 P1 in the same transaction as the membership transition. Delivery gates
 * control claiming, never entitlement: while a protected projection interface
 * is absent, its row remains pending with zero attempts.
 *
 * This module deliberately contains no Mailman, mailbox, archive, Keycloak,
 * cluster, or credential client. Those capabilities belong to protected,
 * restricted interfaces outside this public application repository.
 */

import { eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import type { Membership, OutboxJob } from '../db/schema';
import { membership as membershipTable } from '../db/schema';
import { DeadIdempotencyKeyError, enqueue } from '../outbox/enqueue';

export const PROVISION_JOB_KINDS = ['provision.add_lists', 'provision.enable_mailbox'] as const;

export const REKEY_EMAIL_JOB_KIND = 'projection.rekey_email' as const;

export type ProvisionJobKind = (typeof PROVISION_JOB_KINDS)[number];

/** `<tenant>:membership:<id>:<effect>` — one receipt per activation effect. */
export function provisionIdempotencyKey(tenantId: string, membershipId: string, kind: ProvisionJobKind): string {
	const effect = kind.slice('provision.'.length);
	return `${tenantId}:membership:${membershipId}:${effect}`;
}

async function enqueueProjection(tx: DbTransaction, row: Membership, kind: ProvisionJobKind) {
	return enqueue(tx, {
		kind,
		aggregateType: 'membership',
		aggregateId: row.id,
		payload: {
			membershipId: row.id,
			personId: row.personId,
		},
		idempotencyKey: provisionIdempotencyKey(row.tenantId, row.id, kind),
	});
}

/** Enqueue the exact two P1 projection intents inside the activation transaction. */
export async function enqueueProvisioning(tx: DbTransaction, row: Membership): Promise<OutboxJob[]> {
	const jobs: OutboxJob[] = [];
	for (const kind of PROVISION_JOB_KINDS) {
		jobs.push((await enqueueProjection(tx, row, kind)).job);
	}
	return jobs;
}

/**
 * P4 keys the email re-projection by the immutable person and new address-row
 * ids. Both address-row ids ride in the payload; mutable addresses never do.
 */
export function emailRekeyIdempotencyKey(tenantId: string, personId: string, newEmailId: string): string {
	return `${tenantId}:person:${personId}:rekey:${newEmailId}`;
}

export async function enqueueEmailRekey(
	tx: DbTransaction,
	input: {
		tenantId: string;
		personId: string;
		oldEmailId: string;
		newEmailId: string;
	},
): Promise<OutboxJob> {
	const result = await enqueue(tx, {
		kind: REKEY_EMAIL_JOB_KIND,
		aggregateType: 'person',
		aggregateId: input.personId,
		payload: {
			personId: input.personId,
			oldEmailId: input.oldEmailId,
			newEmailId: input.newEmailId,
		},
		idempotencyKey: emailRekeyIdempotencyKey(input.tenantId, input.personId, input.newEmailId),
	});
	return result.job;
}

/**
 * Add missing P1 intent for Active members created before this carrier. A
 * standing dead row is already durable evidence requiring the audited replay
 * lane; it must not abort worker startup or prevent unrelated members and
 * projection kinds from being repaired.
 *
 * Returns the number of memberships for which at least one missing intent was
 * inserted, not the number scanned.
 */
export async function reconcileActiveProvisioning(tx: DbTransaction): Promise<number> {
	const rows = await tx
		.select()
		.from(membershipTable)
		.where(eq(membershipTable.status, 'active'))
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
