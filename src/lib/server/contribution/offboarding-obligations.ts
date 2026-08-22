/**
 * Finance audience for offboarding's cancel_billing obligation (TIN-3440
 * slice S11, round 2 — adversarial review BLOCK on PR #194 @ 83947ea, B1/B2).
 *
 * `member-v0-executable-slices-2026-08-18.md:731` (§2.3, offboarding-replay
 * table, row 1) rules the audience for a permanently failed
 * `offboard.cancel_billing` job by name: "dead-letter; membership stays
 * offboarded; **finance sees an open obligation**." This module is that
 * audience's read path — the finance-role counterpart to
 * `membership/offboard.ts`'s keyholder-gated `offboardingObservability`,
 * which withholds exactly this job kind's `lastError` from keyholders
 * (spec §5's "failure detail" prohibition,
 * `launch-member-v0-system-2026-08-16.md:223-225`).
 *
 * WHY THIS FILE IS NOT IN `membership/offboard.ts`. The import boundary is
 * bidirectional and mechanically enforced
 * (`contribution/import-boundary.test.ts`): no `membership/**` module may
 * import `contribution/**` OR `stripe/**`, and no `contribution/**` or
 * `stripe/**` module may import `membership/**`, in either direction. A
 * finance-gated reader living in `membership/offboard.ts` and importing
 * `requireFinance` (`./finance-read`, PR #195, TIN-3818 slice S10) would
 * cross that fence from the membership side. Living HERE, in
 * `contribution/**`, and reading the shared `outbox_job` table directly
 * (never importing `membership/offboard.ts`, never importing
 * `OFFBOARD_JOB_KINDS` from it — the one kind this file cares about is
 * inlined as a literal below) keeps both directions clean. `outbox_job` and
 * `membership` are S1/S3 shared schema, not `membership/**` domain code —
 * `db/schema.ts` is outside both fenced directories.
 *
 * STACKED ON PR #195 for `requireFinance`/`FINANCE_ROLE`
 * (`./finance-read.ts:47,71`) — this PR (#194, S11) declares that dependency
 * explicitly (PR body, base branch) rather than duplicating the guard.
 *
 * READ-ONLY, STRUCTURALLY: no INSERT/UPDATE/DELETE anywhere in this file.
 */

import { and, desc, eq, ne } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { membership, outboxJob, person, type OutboxJob } from '../db/schema';
import { requireFinance } from './finance-read';

/**
 * The one offboarding job kind §2.3 row 1 names finance as the audience for.
 * Inlined rather than imported from `membership/offboard.ts`'s
 * `OFFBOARD_JOB_KINDS` — see the file docstring's fence note.
 */
const CANCEL_BILLING_KIND = 'offboard.cancel_billing';

/** One open (`not done`) `offboard.cancel_billing` obligation, finance-shaped. */
export interface BillingObligation {
	membershipId: string;
	personId: string;
	displayName: string;
	status: OutboxJob['status'];
	attempts: number;
	maxAttempts: number;
	/** Unredacted for finance — this is exactly the audience §2.3 row 1 names. */
	lastError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Every NOT-`done` `offboard.cancel_billing` job in the tenant — finance-
 * gated as the FIRST step, inside the caller's own `withTenant` unit of work
 * (spec §6), the `requireKeyholder` / `listReviewQueue` precedent applied to
 * `requireFinance`. `done` rows are excluded on purpose: a resolved billing
 * cancellation is not an "open obligation" (§2.3 invariant 3's language),
 * unlike `offboardingObservability`'s keyholder view, which renders every
 * state including `done` for observability's sake.
 */
export async function financeOpenBillingObligations(
	tx: DbTransaction,
	financePersonId: string,
): Promise<BillingObligation[]> {
	await requireFinance(tx, financePersonId);

	const rows = await tx
		.select({ job: outboxJob, displayName: person.displayName, personId: membership.personId })
		.from(outboxJob)
		.innerJoin(membership, eq(membership.id, outboxJob.aggregateId))
		.innerJoin(person, eq(person.id, membership.personId))
		.where(
			and(
				eq(outboxJob.aggregateType, 'membership'),
				eq(outboxJob.kind, CANCEL_BILLING_KIND),
				ne(outboxJob.status, 'done'),
			),
		)
		.orderBy(desc(outboxJob.updatedAt));

	return rows.map((row) => ({
		membershipId: row.job.aggregateId,
		personId: row.personId,
		displayName: row.displayName,
		status: row.job.status,
		attempts: row.job.attempts,
		maxAttempts: row.job.maxAttempts,
		lastError: row.job.lastError,
		createdAt: row.job.createdAt,
		updatedAt: row.job.updatedAt,
	}));
}
