/**
 * Keyholder claim + tour scheduling — A4 `claim` and A5 `schedule_tour`
 * (TIN-3440 slice S5; spec §4 application state machine; slices §2.2 rows
 * 4-5; spec §6 "one keyholder claims a review at a time").
 *
 * EVERY function takes the transaction handle `withTenant(tenantId, fn)`
 * produced, first, and none opens a transaction of its own — the S2/S4
 * discipline, inherited. The keyholder-grant check, the claim insert, and the
 * status transition commit or roll back as ONE unit of work, which is exactly
 * what spec §6 means by "authorization is checked against the current
 * membership/role in the same unit of work": a grant revoked before this
 * transaction opened is a grant this transaction refuses.
 *
 * CLAIM SEMANTICS (spec §4; TIN-3440): exactly one keyholder claims a review
 * at a time. Two mechanisms, deliberately layered:
 *   1. `SELECT … FOR UPDATE` on the application row serialises racing claims,
 *      so the loser re-reads a `claimed` row and gets an EXPLICIT
 *      `ClaimConflictError` — a 409 with a name, not a unique-violation 500.
 *   2. The `application_claim_live_uniq` partial unique index makes "one live
 *      claim per application" a database fact even for a write path that
 *      forgot mechanism 1. This is the enforcement the spec names.
 * The claim is VISIBLE to other keyholders — `listReviewQueue` returns the
 * claimant on every claimed row, so "who is on this" is queue state, not
 * side-channel knowledge.
 *
 * TOUR SCHEDULING IS STATE, NOT AUTOMATION (TIN-3440: the tour is arranged by
 * ordinary email). A5 records that the claiming keyholder has moved the
 * review to `tour_scheduled` and does NOTHING else: no calendar, no outbox
 * job, no notification. The integration suite asserts the outbox is untouched
 * by A5 — absence of automation is a tested property, not an omission.
 *
 * CLAIM RELEASE IS NOT HERE. A claimed, undecided application returns to
 * `email_verified` only by explicit operator action (slices §1.7 rollback
 * note — never auto-released on deploy). No release surface ships in S5;
 * `application_claim.released_at` and its one-way trigger await that
 * operator path. RECORDED HAND-OFF, not a gap.
 *
 * AUDIT ROWS ARE S6's SPINE, arriving later (the S4 precedent, re-recorded):
 * S6 wires `application.claimed` / `application.tour_scheduled` through
 * `src/lib/server/audit/` when it exists. The durable record today is the
 * claim row itself plus the application's status/version.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import {
	application,
	applicationClaim,
	applicationDecision,
	type Application,
	type ApplicationClaim,
	type ApplicationDecision,
} from '../db/schema';
import { hasRole } from '../auth/roles';
import { AuthError } from '../auth/session';
import { VersionConflictError } from './intake';

/**
 * TODO(sitting-2 item 2, ~2026-08-22): ratified role model.
 * Drafted (slices §1.4 AMENDMENT, recommended option 1, NOT ratified):
 *   member    — implied by Active membership, not a grant
 *   keyholder — grant: claim / tour / approve / decline / force-remove;
 *               never sees amount, rail, processor state, failure detail
 *   finance   — grant: amount, rail, processor ids, cash notes,
 *               reconciliation; NO approve/decline capability
 * "steward" is OMITTED — no ADR/spec basis; unreconciled taxonomy. The word
 * never ships in schema, code, or copy.
 *
 * S5 uses `keyholder` ONLY (slices §1.7 fence note). S2's roles.ts stays
 * deliberately vocabulary-free — the grant MECHANICS are its; this string is
 * the one role S5's capabilities hang on, named here at the point of use so
 * the ratification diff is one line. The full `GRANTABLE_ROLES` slot lands
 * with the ratified model.
 */
export const KEYHOLDER_ROLE = 'keyholder';

/** 404-shaped: no such application in this tenant (or RLS-invisible — same). */
export class ApplicationNotFoundError extends Error {
	constructor() {
		super('No such application.');
		this.name = 'ApplicationNotFoundError';
	}
}

/** 409-shaped: another keyholder already holds the live claim. */
export class ClaimConflictError extends Error {
	constructor() {
		super('Another keyholder has already claimed this application.');
		this.name = 'ClaimConflictError';
	}
}

/** 409-shaped: the event is not legal from the application's current state. */
export class IllegalTransitionError extends Error {
	readonly from: string;
	readonly event: string;
	constructor(from: string, event: string) {
		super(`"${event}" is not a legal transition from "${from}".`);
		this.name = 'IllegalTransitionError';
		this.from = from;
		this.event = event;
	}
}

/** 403-shaped: the actor is a keyholder, but not the one holding the claim. */
export class NotClaimantError extends Error {
	constructor() {
		super('Only the claiming keyholder may act on this review.');
		this.name = 'NotClaimantError';
	}
}

/**
 * The guard every S5 capability runs FIRST, inside the SAME transaction as
 * the action it authorizes (spec §6): a live `keyholder` grant, or a thrown
 * 403. Because the check rides the action's own unit of work, a revocation
 * committed mid-request — after the session was validated, before the action
 * transaction opened — is seen and refused.
 */
export async function requireKeyholder(tx: DbTransaction, personId: string): Promise<string> {
	const tenantId = await tenantFromGuc(tx);
	const held = await hasRole(tx, tenantId, personId, KEYHOLDER_ROLE);
	if (!held) {
		throw new AuthError(403, 'not_keyholder', 'This action requires a live keyholder grant.');
	}
	return tenantId;
}

/**
 * Lock the application row and return it. `FOR UPDATE` is the serialisation
 * point for every S5 transition — claims, decisions, and withdrawals on one
 * application queue behind it, which is what turns races into ordered
 * outcomes ("exactly one terminal transition commits", spec §4).
 */
export async function lockApplication(tx: DbTransaction, applicationId: string): Promise<Application> {
	const rows = await tx.select().from(application).where(eq(application.id, applicationId)).for('update').limit(1);
	if (rows.length !== 1) throw new ApplicationNotFoundError();
	return rows[0];
}

/** Shared `expectedVersion` gate (spec §4: stale → 409, mutating nothing). */
export function checkExpectedVersion(row: Application, expectedVersion: number | undefined): void {
	if (expectedVersion !== undefined && expectedVersion !== row.version) {
		throw new VersionConflictError(expectedVersion, row.version);
	}
}

export interface ClaimInput {
	applicationId: string;
	/** The claiming keyholder — checked against `member_role_grant` in this tx. */
	keyholderPersonId: string;
	expectedVersion?: number;
	now?: Date;
}

export interface ClaimResult {
	application: Application;
	claim: ApplicationClaim;
	/** false: this exact keyholder's claim already stood; the original is returned. */
	claimed: boolean;
}

/**
 * A4 — `email_verified → claimed` (slices §2.2 row 4). Grant check, row
 * lock, claim insert, and status transition in the caller's transaction.
 */
export async function claimApplication(tx: DbTransaction, input: ClaimInput): Promise<ClaimResult> {
	const now = input.now ?? new Date();
	const tenantId = await requireKeyholder(tx, input.keyholderPersonId);

	const row = await lockApplication(tx, input.applicationId);

	if (row.status === 'claimed' || row.status === 'tour_scheduled') {
		// Spec §6: "A duplicate request returns the original result/receipt."
		// Row 4's idempotency key is `…:claim:<keyholder_id>` — no version
		// component — so a repeat from the SAME keyholder (double-click,
		// network retry, back-button resubmit) is by construction a
		// duplicate of their own request, not another keyholder's conflict
		// (reviewer finding H1, PR #181 review round 1).
		//
		// CHECKED BEFORE `checkExpectedVersion` ON PURPOSE (review round 2
		// finding): the shipped `/review` form posts a hidden `expectedVersion`
		// carrying the PRE-claim version, which is exactly what a double-click
		// or back-button resubmit re-sends — round 1 put the version gate
		// first, so those exact scenarios 409'd on staleness before ever
		// reaching this convergence, making the fix's own rationale dead code
		// through the real UI (proved identical at the pre-fix commit).
		// Checking convergence first makes the fix reachable through the form
		// it was written for, not only through an API caller that omits
		// `expectedVersion`: a duplicate of one's own already-applied claim
		// event is not the "stale write" spec §4's `expectedVersion` guard
		// means to catch, regardless of which version the resubmitted form
		// remembers.
		const standing = await liveClaim(tx, tenantId, row.id);
		if (standing && standing.keyholderPersonId === input.keyholderPersonId) {
			return { application: row, claim: standing, claimed: false };
		}
		// A genuinely different claimant was never going to win this claim
		// regardless of which version they presented, so the conflict is
		// reported as what it is rather than as a version mismatch. Serialised
		// behind the row lock, the race loser lands here: an explicit,
		// nameable conflict (S5 acceptance row 1), not a 500 — and the copy
		// ("Another keyholder has already claimed…") is now always accurate,
		// since a same-keyholder repeat never reaches it.
		throw new ClaimConflictError();
	}
	checkExpectedVersion(row, input.expectedVersion);
	if (row.status !== 'email_verified') {
		// A4's only legal source state (spec §4): unverified applications are
		// not yet reviewable; terminal ones never again are.
		throw new IllegalTransitionError(row.status, 'claim');
	}

	const inserted = await tx
		.insert(applicationClaim)
		.values({
			tenantId,
			applicationId: row.id,
			keyholderPersonId: input.keyholderPersonId,
			claimedAt: now,
		})
		.onConflictDoNothing()
		.returning();
	if (inserted.length !== 1) {
		// Belt over the braces: the partial unique index absorbed the insert,
		// meaning a live claim exists that the status somehow did not reflect.
		throw new ClaimConflictError();
	}

	const updated = await tx
		.update(application)
		.set({ status: 'claimed', version: row.version + 1, updatedAt: now })
		.where(eq(application.id, row.id))
		.returning();

	return { application: updated[0], claim: inserted[0], claimed: true };
}

/**
 * The live claim on an application, or null. Exported for the decision path
 * (decide.ts must know the claimant) and the review queue.
 */
export async function liveClaim(
	tx: DbTransaction,
	tenantId: string,
	applicationId: string,
): Promise<ApplicationClaim | null> {
	const rows = await tx
		.select()
		.from(applicationClaim)
		.where(
			and(
				eq(applicationClaim.tenantId, tenantId),
				eq(applicationClaim.applicationId, applicationId),
				isNull(applicationClaim.releasedAt),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/**
 * The "actor is the claiming keyholder" guard A5/A6/A7 share (spec §4: one
 * keyholder claims; that keyholder schedules the tour and decides).
 */
export async function requireClaimant(
	tx: DbTransaction,
	tenantId: string,
	applicationId: string,
	keyholderPersonId: string,
): Promise<ApplicationClaim> {
	const claim = await liveClaim(tx, tenantId, applicationId);
	if (!claim || claim.keyholderPersonId !== keyholderPersonId) {
		throw new NotClaimantError();
	}
	return claim;
}

export interface ScheduleTourInput {
	applicationId: string;
	keyholderPersonId: string;
	expectedVersion?: number;
	now?: Date;
}

/**
 * A5 — `claimed → tour_scheduled` (slices §2.2 row 5). State only: the tour
 * itself is arranged by ordinary email (TIN-3440), so this function enqueues
 * nothing, notifies nothing, and integrates with no calendar — the
 * integration suite asserts the outbox gains no job here.
 */
export async function scheduleTour(tx: DbTransaction, input: ScheduleTourInput): Promise<Application> {
	const now = input.now ?? new Date();
	const tenantId = await requireKeyholder(tx, input.keyholderPersonId);

	const row = await lockApplication(tx, input.applicationId);
	if (row.status === 'tour_scheduled') {
		// Spec §6 duplicate-request convergence — same family as claim's H1
		// fix, and CHECKED BEFORE `checkExpectedVersion` for the identical
		// round-2 reason: the shipped form posts the pre-schedule_tour version
		// on exactly the double-click/back-button paths this targets, so
		// checking version first would make this convergence unreachable
		// through the real UI too. A repeat schedule_tour from the claimant is
		// a duplicate of their own already-applied transition (row 5's key is
		// `…:tour:<key>`, no version component), not an illegal one. A
		// non-claimant still gets the ordinary `NotClaimantError` regardless of
		// which version they presented.
		await requireClaimant(tx, tenantId, row.id, input.keyholderPersonId);
		return row;
	}
	checkExpectedVersion(row, input.expectedVersion);
	if (row.status !== 'claimed') {
		throw new IllegalTransitionError(row.status, 'schedule_tour');
	}
	await requireClaimant(tx, tenantId, row.id, input.keyholderPersonId);

	const updated = await tx
		.update(application)
		.set({ status: 'tour_scheduled', version: row.version + 1, updatedAt: now })
		.where(eq(application.id, row.id))
		.returning();
	return updated[0];
}

/** The three states a review queue shows; terminal rows leave the queue. */
export const REVIEW_QUEUE_STATUSES = ['email_verified', 'claimed', 'tour_scheduled'] as const;

export interface ReviewQueueEntry {
	application: Application;
	/** Live claim, visible to EVERY keyholder — claim state is queue state. */
	claim: ApplicationClaim | null;
}

/**
 * The keyholder review queue: every application awaiting review, with its
 * live claim (claimant + claimed-at) joined on. Submitted-but-unverified
 * applications are deliberately absent — A4's source state is
 * `email_verified`, and surfacing addresses that never confirmed would show
 * keyholders unverified personal data for no actionable reason.
 */
export async function listReviewQueue(tx: DbTransaction, keyholderPersonId: string): Promise<ReviewQueueEntry[]> {
	await requireKeyholder(tx, keyholderPersonId);
	const rows = await tx
		.select({ app: application, claim: applicationClaim })
		.from(application)
		.leftJoin(
			applicationClaim,
			and(
				eq(applicationClaim.tenantId, application.tenantId),
				eq(applicationClaim.applicationId, application.id),
				isNull(applicationClaim.releasedAt),
			),
		)
		.where(inArray(application.status, [...REVIEW_QUEUE_STATUSES]))
		.orderBy(application.createdAt);
	return rows.map((r) => ({ application: r.app, claim: r.claim }));
}

export interface ReviewDetail {
	application: Application;
	claim: ApplicationClaim | null;
	decision: ApplicationDecision | null;
}

/**
 * One application for the review surface: the row, its live claim, and its
 * decision when one stands (terminal rows stay inspectable — the queue drops
 * them, the record does not). Keyholder-gated like the queue; the shape a
 * keyholder reads carries NO contribution data because none exists to carry
 * (TIN-3440: applicants have no contribution state before approval).
 */
export async function reviewDetail(
	tx: DbTransaction,
	keyholderPersonId: string,
	applicationId: string,
): Promise<ReviewDetail> {
	const tenantId = await requireKeyholder(tx, keyholderPersonId);
	const rows = await tx.select().from(application).where(eq(application.id, applicationId)).limit(1);
	if (rows.length !== 1) throw new ApplicationNotFoundError();
	const claim = await liveClaim(tx, tenantId, applicationId);
	const decisions = await tx
		.select()
		.from(applicationDecision)
		.where(and(eq(applicationDecision.tenantId, tenantId), eq(applicationDecision.applicationId, applicationId)))
		.limit(1);
	return { application: rows[0], claim, decision: decisions[0] ?? null };
}

/** GUC read, failing fast — same rationale as intake.ts / tokens.ts copies. */
async function tenantFromGuc(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error(
			'application review: this transaction has no app.tenant_id — act only inside withTenant(tenantId, fn).',
		);
	}
	return tenantId;
}
