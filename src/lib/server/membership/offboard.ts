/**
 * Offboarding replay — the §2.3 fan-out and the person-record obligation
 * surface (TIN-3440 slice S7; spec §4 offboarding steps; slices §2.3).
 *
 * THE SPLIT, RESTATED FROM THE CONTRACT: committed FIRST, in the transition's
 * own transaction and never retried because never independently failing —
 * the membership transition, immediate session revocation, immediate
 * tool-access revocation (borrowing is DERIVED from status, so revoking it
 * IS the status change — `canBorrow` in ./transition.ts). THEN each
 * downstream projection rides the outbox as an independently retryable job
 * via S3's `enqueue(tx, job)` — same transaction, separate jobs,
 * at-least-once with idempotent consumers.
 *
 * IDENTITY KEYS, NO CALLER SEGMENT (slices §2.2 rows 13/14 note): the job
 * keys derive from the membership id alone —
 * `<tenant>:membership:<id>:<effect>` — so a racing leave/remove pair that
 * somehow both committed still could not enqueue two effect sets; `enqueue`'s
 * unique key absorbs the second fan-out (`enqueued: false`), which is also
 * what makes whole-offboarding REPLAY idempotent (§2.3 invariant 2).
 *
 * INVARIANTS THIS MODULE CARRIES (slices §2.3, each with an S7 test row):
 *   1. a downstream failure never restores membership — structurally: the
 *      handlers cannot reach this module, and the transition committed first;
 *   2. replay converges on the standing jobs, no second external effect;
 *   3. unresolved obligations stay VISIBLE on the person's record
 *      (`personRecord`) and preserve NO login or list access;
 *   4. Member v0 DELETES NOTHING on offboarding (spec §14 item 4 — retention
 *      is the sitting #3 named gate): finance and audit records persist.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { membership, outboxJob, person, type Membership, type OutboxJob } from '../db/schema';
import { revokeAllSessions } from '../auth';
import { enqueue } from '../outbox/enqueue';

/** The three ratified offboarding projections (slices §2.3), in fan-out order. */
export const OFFBOARD_JOB_KINDS = [
	'offboard.cancel_billing',
	'offboard.remove_lists',
	'offboard.disable_mailbox',
] as const;

export type OffboardJobKind = (typeof OFFBOARD_JOB_KINDS)[number];

/** `<tenant>:membership:<id>:<effect>` — the §2.3 identity key, verbatim. */
export function offboardIdempotencyKey(tenantId: string, membershipId: string, kind: OffboardJobKind): string {
	const effect = kind.slice('offboard.'.length);
	return `${tenantId}:membership:${membershipId}:${effect}`;
}

/**
 * Immediate access revocation — the commit-first half's session step. Every
 * session the member's auth user holds dies in THIS transaction; a person
 * never linked to an auth user (offboarded before activation — e.g. a
 * `pending_assent` record removed by operator action in a later slice) has
 * no sessions to revoke and this is the documented no-op.
 */
export async function revokeMemberAccess(
	tx: DbTransaction,
	tenantId: string,
	authUserId: string | null,
): Promise<number> {
	if (!authUserId) return 0;
	return revokeAllSessions(tx, tenantId, authUserId);
}

/**
 * The §2.3 fan-out: three separate jobs, one per projection, enqueued in the
 * caller's (the transition's) transaction. Convergent on replay: `enqueue`'s
 * `(tenant, kind, idempotency_key)` unique absorbs a second fan-out and
 * returns the standing rows — the original receipt.
 *
 * Payloads carry ids only (S3 payload doctrine): the handlers read current
 * state themselves inside their own units of work.
 */
export async function enqueueOffboarding(tx: DbTransaction, row: Membership): Promise<OutboxJob[]> {
	const jobs: OutboxJob[] = [];
	for (const kind of OFFBOARD_JOB_KINDS) {
		const result = await enqueue(tx, {
			kind,
			aggregateType: 'membership',
			aggregateId: row.id,
			payload: { membershipId: row.id, personId: row.personId },
			idempotencyKey: offboardIdempotencyKey(row.tenantId, row.id, kind),
		});
		jobs.push(result.job);
	}
	return jobs;
}

/** One unresolved effect on an offboarded person's record. */
export interface OpenObligation {
	kind: string;
	/** `pending`/`leased`: projection pending. `dead`: needs an operator. */
	status: OutboxJob['status'];
	attempts: number;
	lastError: string | null;
}

export interface PersonRecord {
	membership: Membership | null;
	/**
	 * Every offboarding effect not yet `done` — "visible as projection
	 * pending, never faked manually" (§2.3; spec §7). A dead
	 * `offboard.cancel_billing` is precisely "finance sees an open
	 * obligation". Tool-custody / property-return obligations join this
	 * surface when the inventory domain (TIN-3814) lands its loan records —
	 * the SLOT is this list; the loan rows are that lane's fence.
	 */
	openObligations: OpenObligation[];
}

/**
 * The person's record for operator/keyholder surfaces (§2.3 invariant 3):
 * membership state plus every unresolved offboarding obligation. Visibility
 * here preserves NOTHING — sessions died at commit, borrowing is derived
 * from status, and list access is the remove_lists projection's to end.
 */
export async function personRecord(tx: DbTransaction, personId: string): Promise<PersonRecord> {
	const personRows = await tx.select({ id: person.id }).from(person).where(eq(person.id, personId)).limit(1);
	if (personRows.length !== 1) return { membership: null, openObligations: [] };

	const membershipRows = await tx
		.select()
		.from(membership)
		.where(eq(membership.personId, personId))
		.orderBy(membership.createdAt);
	const latest = membershipRows.at(-1) ?? null;
	if (!latest) return { membership: null, openObligations: [] };

	const jobs = await tx
		.select()
		.from(outboxJob)
		.where(
			and(
				eq(outboxJob.aggregateType, 'membership'),
				eq(outboxJob.aggregateId, latest.id),
				inArray(outboxJob.kind, [...OFFBOARD_JOB_KINDS]),
			),
		);

	return {
		membership: latest,
		openObligations: jobs
			.filter((job) => job.status !== 'done')
			.map((job) => ({
				kind: job.kind,
				status: job.status,
				attempts: job.attempts,
				lastError: job.lastError,
			})),
	};
}
