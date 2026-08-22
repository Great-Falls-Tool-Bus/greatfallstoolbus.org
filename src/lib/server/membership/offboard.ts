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

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { membership, outboxJob, person, type Membership, type OutboxJob } from '../db/schema';
import { revokeAllSessions } from '../auth';
import { enqueue } from '../outbox/enqueue';
import { requireKeyholder } from '../application/claim';

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

/**
 * S11 — offboarding HTTP observability (TIN-3440; L70 mandate, sitting-2 QA
 * gap item, targeted for 2026-08-30). Read-only: this module writes NOTHING,
 * has no mutation entry point, and the outbox rows it reads are S3/S7's
 * standing state — no new state is introduced here.
 *
 * ROLE VISIBILITY — FLAGGED ASSUMPTION, not a ratified rule. The launch spec
 * §5 states plainly that "only the finance role can read amount, rail,
 * processor/customer identifiers, cash notes, or failure detail" for
 * CONTRIBUTION data, and that general keyholders see only whether a
 * contribution step was offered. Neither the launch spec, the executable
 * slices doc (§1.9 S7, §2.3), nor decisions/0018's ratified role model
 * (`member`/`keyholder`/`finance`) says anything about who may read
 * OFFBOARDING JOB QUEUE STATE (kind/status/attempts/timestamps/dead-letter
 * reason) over HTTP — that surface did not exist before this slice, so
 * neither ratified document could have addressed it. `requireFinance`-shaped
 * enforcement does not exist anywhere in this codebase yet (S8's
 * `contribution/visibility.ts` ships the finance/keyholder SHAPE split but
 * explicitly defers enforcement to "S8" — grep shows no such guard has
 * landed). Building a new finance-gated path here would invent both a
 * capability and a role-check the ratified record never asked for. Per this
 * slice's own operating instructions, an unstated design point takes the
 * MOST RESTRICTIVE defensible reading: this surface is gated on a live
 * `keyholder` grant ONLY — the same `requireKeyholder` guard `/remove` and
 * `/review` already use (spec §6 "authorization checked against the current
 * membership/role in the same unit of work") — and finance is deliberately
 * NOT admitted. `offboard.cancel_billing`'s queue state can imply a person
 * had a billing relationship that needed cancelling, which sits closer to
 * financial inference than "offered/not offered"; restricting to keyholder
 * (never finance, never public) is the narrower of the two plausible readings
 * TIN-3440's "keyholder... executes decisions" framing supports. Flagged for
 * the operator: if a sitting later rules finance should ALSO read this
 * surface (e.g. to see cancel_billing dead-letters without a keyholder
 * intermediary), that is an ADDITIVE follow-up, not a revert — finance
 * enforcement does not exist yet to widen.
 *
 * WHY OUTBOX ROWS DIRECTLY, NOT `personRecord`'s `openObligations`.
 * `personRecord` (above) intentionally filters to non-`done` rows for the
 * operator "what's still owed" surface (§2.3 invariant 3). This slice's
 * acceptance instead requires "correct rendering of ALL outbox states incl.
 * dead-letter" — a `done` job is exactly as much "offboarding observability"
 * as a `dead` one, so this function does not filter by status at all.
 */
export interface OffboardJobStatus {
	kind: OffboardJobKind;
	/** `pending` (queued) | `leased` (a worker is running it) | `done` | `dead` (dead-lettered). */
	status: OutboxJob['status'];
	attempts: number;
	maxAttempts: number;
	availableAt: Date;
	leaseExpiresAt: Date | null;
	/** Set only when `status === 'dead'` OR a retry is pending after a failed attempt; already redacted at write time (`describeFailure`, outbox/schema.ts). */
	lastError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface OffboardedMembershipObservability {
	membershipId: string;
	personId: string;
	displayName: string;
	/** `left` | `removed` — the two terminal states that fan out offboarding jobs. */
	status: string;
	endedAt: Date | null;
	/** Every offboarding job this membership has ever enqueued, newest first. Empty when offboarding has not yet run (job creation and the membership-status commit are not the same instant to a READER, even though they are the same transaction to the writer). */
	jobs: OffboardJobStatus[];
}

/**
 * The read-only observability surface: every offboarded (`left`/`removed`)
 * membership, tenant-scoped by RLS via the transaction's GUC, joined to the
 * full history of its offboarding outbox jobs. Keyholder-gated as the FIRST
 * step, inside the caller's `withTenant` unit of work, matching
 * `listReviewQueue`'s shape (spec §6) — a grant revoked mid-request is
 * refused before any row is read.
 */
export async function offboardingObservability(
	tx: DbTransaction,
	keyholderPersonId: string,
): Promise<OffboardedMembershipObservability[]> {
	await requireKeyholder(tx, keyholderPersonId);

	const rows = await tx
		.select({ m: membership, displayName: person.displayName })
		.from(membership)
		.innerJoin(person, eq(person.id, membership.personId))
		.where(inArray(membership.status, ['left', 'removed']))
		.orderBy(desc(membership.updatedAt));
	if (rows.length === 0) return [];

	const membershipIds = rows.map((row) => row.m.id);
	const jobs = await tx
		.select()
		.from(outboxJob)
		.where(
			and(
				eq(outboxJob.aggregateType, 'membership'),
				inArray(outboxJob.aggregateId, membershipIds),
				inArray(outboxJob.kind, [...OFFBOARD_JOB_KINDS]),
			),
		)
		.orderBy(desc(outboxJob.createdAt));

	const byMembership = new Map<string, OutboxJob[]>();
	for (const job of jobs) {
		const list = byMembership.get(job.aggregateId) ?? [];
		list.push(job);
		byMembership.set(job.aggregateId, list);
	}

	return rows.map((row) => ({
		membershipId: row.m.id,
		personId: row.m.personId,
		displayName: row.displayName,
		status: row.m.status,
		endedAt: row.m.endedAt,
		jobs: (byMembership.get(row.m.id) ?? []).map((job) => ({
			kind: job.kind as OffboardJobKind,
			status: job.status,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			availableAt: job.availableAt,
			leaseExpiresAt: job.leaseExpiresAt,
			lastError: job.lastError,
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
		})),
	}));
}
