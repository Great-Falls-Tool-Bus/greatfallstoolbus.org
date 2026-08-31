/**
 * Membership transitions — M2 `pause`, M3 `resume`, M4 `leave`, M5 `remove`
 * (TIN-3440 slice S7; spec §4 membership state machine; slices §2.2 rows
 * 11–14; ratified `member-lifecycle.mmd`).
 *
 * THE MATRIX IS EXPORTED DATA, NOT PROSE: `MEMBERSHIP_TRANSITIONS` names
 * every event's legal source states and target, and `classifyTransition`
 * answers allowed/forbidden for EVERY ordered pair — the S7 acceptance's
 * exhaustive-matrix test iterates `MEMBERSHIP_STATUSES` so a new state fails
 * the suite until it is classified (completeness by construction).
 *
 * THE EDGES ARE THE RATIFIED ONES, EXACTLY (slices §1.9 note): both
 * `active → removed` AND `paused → removed` — the ratified lifecycle diagram
 * and TIN-3440's "forcibly remove" over the spec ASCII's literal shape.
 * `left` and `removed` are terminal; reinstatement after `removed` is a NEW
 * APPLICATION, never a transition (§1.9 ASSUMPTION, resolver Jess). Pause
 * has no duration and never auto-transitions (§1.9 ASSUMPTION) — an
 * automatic `paused → left` would be exactly the "inferred result" spec §4
 * forbids for resume.
 *
 * WHAT A TRANSITION MAY NEVER READ: contribution state. "Membership
 * transitions never query contribution state" (spec §5) is structural here —
 * nothing under `src/lib/server/membership/**` imports
 * `src/lib/server/contribution/**` (the S8 static fence; S7 must not create
 * the violation first) — and behavioral in the S7 acceptance: resume happens
 * by explicit intent only, never triggered by any contribution event
 * (spec §4: "never an inferred result of payment").
 *
 * OFFBOARDING (rows 13/14) COMMITS FIRST: the transition, immediate session
 * revocation, and tool-access revocation ride THIS unit of work; the three
 * downstream projections ride the outbox as independently retryable jobs
 * (`./offboard.ts`). A downstream failure never restores membership
 * (ADR 0014 §4; spec §11).
 */

import { eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { membership, type Membership } from '../db/schema';
import { hasRole } from '../auth/roles';
import { AuthError } from '../auth/session';
import { KEYHOLDER_ROLE } from '../application/claim';
import { writeAudit } from '../audit/write';
import {
	IllegalMembershipTransitionError,
	MembershipVersionConflictError,
	checkMembershipVersion,
	lockMembership,
	personById,
} from './activate';
import { enqueueOffboarding, revokeMemberAccess } from './offboard';

/**
 * The five persisted states. `pending_assent` is the migration-0009 legacy
 * database label for pending activation; decision 0024 removed any separate
 * assent gate. Renaming stored rows and the CHECK belongs to a schema migration.
 */
export const MEMBERSHIP_STATUSES = ['pending_assent', 'active', 'paused', 'left', 'removed'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** The five ratified events (slices §2.2 rows 10–14). */
export const MEMBERSHIP_EVENTS = ['activate', 'pause', 'resume', 'leave', 'remove'] as const;
export type MembershipEvent = (typeof MEMBERSHIP_EVENTS)[number];

/**
 * Every legal edge, as data — source-state sets pinned by the unit suite the
 * way S5 pins APPROVE_SOURCE_STATUSES, so an accidental new edge fails a
 * test, not a review.
 */
export const MEMBERSHIP_TRANSITIONS: Readonly<
	Record<MembershipEvent, { readonly from: readonly MembershipStatus[]; readonly to: MembershipStatus }>
> = {
	activate: { from: ['pending_assent'], to: 'active' },
	pause: { from: ['active'], to: 'paused' },
	resume: { from: ['paused'], to: 'active' },
	leave: { from: ['active', 'paused'], to: 'left' },
	remove: { from: ['active', 'paused'], to: 'removed' },
};

/**
 * Classify one ordered (from, event) pair: the target state when legal,
 * `'forbidden'` otherwise. Total over the enum by construction — the
 * S7 completeness test iterates every pair through here.
 */
export function classifyTransition(from: MembershipStatus, event: MembershipEvent): MembershipStatus | 'forbidden' {
	const edge = MEMBERSHIP_TRANSITIONS[event];
	return edge.from.includes(from) ? edge.to : 'forbidden';
}

/** Borrowing permission is DERIVED from status: Active borrows, nobody else
 * does (spec §4: pause "revokes borrowing permission"; TIN-3440: "Pause
 * blocks new borrowing but preserves login, mail, and discussion access").
 * A derived predicate cannot desynchronise from the state that grants it. */
export function canBorrow(row: Pick<Membership, 'status'>): boolean {
	return row.status === 'active';
}

export interface MemberActor {
	personId: string;
	/** How the actor is authorized: as the member themself, or by grant. */
	via: 'member' | 'keyholder';
}

export interface PauseInput {
	membershipId: string;
	actor: MemberActor;
	reasonClass?: string;
	expectedVersion?: number;
	now?: Date;
}

export interface TransitionResult {
	membership: Membership;
	/** false: the row already stood in the target state — converged replay. */
	changed: boolean;
}

/** Guard: the actor is the member themself, or holds a live keyholder grant
 * checked in THIS unit of work (spec §6). */
async function requireMemberOrKeyholder(tx: DbTransaction, row: Membership, actor: MemberActor): Promise<void> {
	if (actor.via === 'member') {
		if (row.personId !== actor.personId) {
			throw new AuthError(403, 'not_member', 'Only the member may take this action on their membership.');
		}
		return;
	}
	const held = await hasRole(tx, row.tenantId, actor.personId, KEYHOLDER_ROLE);
	if (!held) {
		throw new AuthError(403, 'not_keyholder', 'This action requires a live keyholder grant.');
	}
}

/**
 * M2 — `active → paused` (slices §2.2 row 11). Actor: the member or a
 * keyholder. Revokes borrowing (derived — see `canBorrow`) while the SESSION
 * STAYS VALID and list, mail, and discussion access are untouched: this
 * function revokes nothing and enqueues NOTHING — the absence of outbox
 * traffic is a tested property (the S5 tour-scheduling precedent).
 * Contribution continuation/cancellation is a SEPARATE explicit choice
 * (row 11) — nothing here reads or writes contribution state.
 */
export async function pauseMembership(tx: DbTransaction, input: PauseInput): Promise<TransitionResult> {
	return simpleTransition(tx, input, 'pause', 'membership.paused');
}

/**
 * M3 — `paused → active` (slices §2.2 row 12): EXPLICIT actor intent, never
 * an inferred result of payment (spec §4) — there is no code path from any
 * contribution event to this function, and the S7 acceptance asserts a
 * recorded contribution changes nothing here.
 */
export async function resumeMembership(tx: DbTransaction, input: PauseInput): Promise<TransitionResult> {
	return simpleTransition(tx, input, 'resume', 'membership.resumed');
}

async function simpleTransition(
	tx: DbTransaction,
	input: PauseInput,
	event: 'pause' | 'resume',
	auditName: 'membership.paused' | 'membership.resumed',
): Promise<TransitionResult> {
	const now = input.now ?? new Date();
	const row = await lockMembership(tx, input.membershipId);
	await requireMemberOrKeyholder(tx, row, input.actor);
	checkMembershipVersion(row, input.expectedVersion);

	const target = classifyTransition(row.status as MembershipStatus, event);
	if (target === 'forbidden') {
		// Strictly 409 — including pause-on-paused/resume-on-active. HTTP-level
		// duplicate replay is the caller's Idempotency-Key + the form's
		// expectedVersion; the ONLY state-convergent replays are the §2.3
		// invariant-2 offboarding pairs (leave-on-left, remove-on-removed).
		throw new IllegalMembershipTransitionError(row.status, event);
	}

	const updated = await tx
		.update(membership)
		.set({ status: target, version: row.version + 1, updatedAt: now })
		.where(eq(membership.id, row.id))
		.returning();

	await writeAudit(tx, {
		actorType: 'person',
		actorId: input.actor.personId,
		aggregateType: 'membership',
		aggregateId: row.id,
		event: auditName,
		fromStatus: row.status,
		toStatus: target,
		reasonClass: input.reasonClass,
		now,
	});

	return { membership: updated[0], changed: true };
}

export interface LeaveInput {
	membershipId: string;
	/** The member themself — leaving is the member's act (row 13). */
	memberPersonId: string;
	reasonClass?: string;
	/** REQUIRED (row 13): leave without a version check is refused. */
	expectedVersion: number;
	now?: Date;
}

/**
 * M4 — `active | paused → left` (slices §2.2 row 13). Commit FIRST — the
 * transition, immediate session revocation, and tool-access revocation in
 * this one unit of work — then the §2.3 fan-out rides the outbox in the SAME
 * transaction (jobs are durable exactly when the transition is).
 * `expectedVersion` is REQUIRED: it is the mechanism that 409s the second of
 * a racing leave/remove pair rather than letting both commit.
 */
export async function leaveMembership(tx: DbTransaction, input: LeaveInput): Promise<TransitionResult> {
	const now = input.now ?? new Date();
	if (!Number.isInteger(input.expectedVersion)) {
		throw new MembershipVersionConflictError(Number.NaN, -1);
	}
	const row = await lockMembership(tx, input.membershipId);
	if (row.personId !== input.memberPersonId) {
		throw new AuthError(403, 'not_member', 'Only the member may leave their own membership.');
	}
	if (row.status === 'left') {
		// Idempotent replay (§2.3 invariant 2): the original receipt, no
		// second fan-out — the offboarding keys stand and enqueue converges.
		return { membership: row, changed: false };
	}
	checkMembershipVersion(row, input.expectedVersion);
	if (classifyTransition(row.status as MembershipStatus, 'leave') === 'forbidden') {
		throw new IllegalMembershipTransitionError(row.status, 'leave');
	}

	const updated = await offboardCommit(tx, row, 'left', now);

	await writeAudit(tx, {
		actorType: 'person',
		actorId: input.memberPersonId,
		aggregateType: 'membership',
		aggregateId: row.id,
		event: 'membership.left',
		fromStatus: row.status,
		toStatus: 'left',
		reasonClass: input.reasonClass,
		now,
	});

	return { membership: updated, changed: true };
}

export interface RemoveInput {
	membershipId: string;
	/** The acting keyholder — grant checked in this unit of work. */
	keyholderPersonId: string;
	/** REQUIRED (TIN-3440 "must record a reason" applied to removal, row 14). */
	reasonClass: string;
	/**
	 * REQUIRED (row 14): the instant the keyholder's FRESH password
	 * reauthentication succeeded — produced by `requireFreshReauth`/
	 * `reauthenticate` (S2) in the route, recorded in the audit row.
	 */
	reauthAt: Date;
	/** REQUIRED (row 14). */
	expectedVersion: number;
	now?: Date;
}

/**
 * M5 — `active | paused → removed` (slices §2.2 row 14): keyholder grant
 * checked in THIS unit of work, recorded reason REQUIRED, fresh
 * reauthentication timestamp REQUIRED (TIN-3440: "Sensitive keyholder
 * actions require fresh password reauthentication"), `expectedVersion`
 * REQUIRED. Commit-first offboarding, exactly like leave.
 */
export async function removeMembership(tx: DbTransaction, input: RemoveInput): Promise<TransitionResult> {
	const now = input.now ?? new Date();
	if (typeof input.reasonClass !== 'string' || input.reasonClass.trim().length === 0) {
		throw new AuthError(400, 'reason_required', 'Removal requires a recorded reason.');
	}
	if (!(input.reauthAt instanceof Date) || Number.isNaN(input.reauthAt.getTime())) {
		throw new AuthError(401, 'reauth_required', 'Removal requires fresh password reauthentication.');
	}
	if (!Number.isInteger(input.expectedVersion)) {
		throw new MembershipVersionConflictError(Number.NaN, -1);
	}

	const row = await lockMembership(tx, input.membershipId);
	const held = await hasRole(tx, row.tenantId, input.keyholderPersonId, KEYHOLDER_ROLE);
	if (!held) {
		throw new AuthError(403, 'not_keyholder', 'Removal requires a live keyholder grant.');
	}
	if (row.status === 'removed') {
		return { membership: row, changed: false };
	}
	checkMembershipVersion(row, input.expectedVersion);
	if (classifyTransition(row.status as MembershipStatus, 'remove') === 'forbidden') {
		throw new IllegalMembershipTransitionError(row.status, 'remove');
	}

	const updated = await offboardCommit(tx, row, 'removed', now);

	await writeAudit(tx, {
		actorType: 'person',
		actorId: input.keyholderPersonId,
		aggregateType: 'membership',
		aggregateId: row.id,
		event: 'membership.removed',
		fromStatus: row.status,
		toStatus: 'removed',
		reasonClass: input.reasonClass,
		reauthAt: input.reauthAt,
		now,
	});

	return { membership: updated, changed: true };
}

/**
 * The shared commit-first offboarding core (§2.3): status + endedAt, then
 * immediate session revocation (tool access is derived from status — see
 * `canBorrow`), then the three-job fan-out into the outbox — ALL in the
 * caller's transaction. The fan-out uses identity keys derived from the
 * membership id alone, so even a double-commit could not enqueue two effect
 * sets (§2.2 rows 13/14 note).
 */
async function offboardCommit(
	tx: DbTransaction,
	row: Membership,
	target: 'left' | 'removed',
	now: Date,
): Promise<Membership> {
	const updated = await tx
		.update(membership)
		.set({ status: target, version: row.version + 1, endedAt: now, updatedAt: now })
		.where(eq(membership.id, row.id))
		.returning();

	const member = await personById(tx, row.personId);
	await revokeMemberAccess(tx, row.tenantId, member?.authUserId ?? null);
	await enqueueOffboarding(tx, updated[0]);

	return updated[0];
}
