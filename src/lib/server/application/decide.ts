/**
 * Terminal transitions on an application — A6 `approve`, A7 `decline`, A8
 * `withdraw` (TIN-3440 slice S5; spec §4 application state machine; slices
 * §2.2 rows 6-8).
 *
 * ALL THREE LIVE IN ONE FILE because they share one invariant: EXACTLY ONE
 * TERMINAL TRANSITION COMMITS (spec §4). Every path locks the application row
 * (`lockApplication`, `SELECT … FOR UPDATE`), so an approve racing a withdraw
 * serialises: the loser re-reads a terminal row and 409s, in either ordering
 * — the S5 acceptance asserts both. The `application_decision` unique
 * constraint (one decision per application, ever) is the same fact at the
 * schema level.
 *
 * THE EDGES ARE THE RATIFIED ONES, EXACTLY:
 *   - approve:  `tour_scheduled → approved` ONLY. There is NO
 *     `claimed → approved` edge — spec §4 grants approval "after the
 *     in-person tour", so an application whose tour was never scheduled
 *     cannot be approved. A unit test pins the source-state sets.
 *   - decline:  `claimed | tour_scheduled → declined`, WITH a recorded
 *     reason class (TIN-3440 "must record a reason"; S5 acceptance: decline
 *     without a reason is rejected — validator, function guard, AND a
 *     database CHECK, so the rule holds against every caller).
 *   - withdraw: `submitted | email_verified | claimed | tour_scheduled →
 *     withdrawn`, authorized by the single-use withdrawal token from the A2
 *     receipt email (slices §2.2 row 8 — NOT by "controls the verified
 *     address", which `submitted` cannot yet prove). S4's PR recorded the
 *     hand-off: the token substrate shipped there; the transition lands here,
 *     with the race it exists to lose or win.
 *
 * DECISION RECEIPTS: A6 and A7 enqueue one `application.decision_email` job,
 * A8 one `application.withdrawn_ack`, all via S3's `enqueue(tx, job)` in the
 * same unit of work. The idempotency keys carry NO client segment
 * (`<tenant>:application:<id>:<event>`) — the offboarding-key doctrine from
 * the executable slices (§2.2 rows 13-14 note) applied to the application
 * aggregate: only one terminal transition can ever commit, so the identity
 * key alone guarantees a racing double-commit could not double-fan-out.
 * Payloads carry `{ applicationId }` ONLY (S3 payload doctrine): the mail
 * handler reads the application and decision rows itself; no address, reason,
 * or token enters the durable operator-visible column.
 *
 * WHAT APPROVE DOES **NOT** DO YET — RECORDED HAND-OFF TO S6: spec §4 has
 * approval provision a `person` (immutable UUID) and a `membership` in
 * `pending_assent`. Those tables are S6's fence (`person`, `membership`,
 * `agreement_version`, … in slices §1.8) and do not exist; S6 wires the
 * provisioning INTO THIS SAME UNIT OF WORK by composing with
 * `approveApplication` inside one `withTenant` callback. Audit-spine rows
 * (`application.approved` / `.declined` / `.withdrawn`) are the same S6
 * hand-off S4 recorded for A2/A3. The durable record today: the application
 * row, the immutable decision row, and the outbox receipt job.
 *
 * NO CONTRIBUTION FIELD, STRUCTURALLY (spec §4: decision records carry
 * "decision and operational notes only, no contribution data"; TIN-3440):
 * the input validators reject unknown keys — a smuggled `contributionAmount`
 * fails loudly — and the decision table has no such column
 * (information_schema-asserted in the integration suite, the S4 precedent).
 */

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { application, applicationDecision, type Application, type ApplicationDecision } from '../db/schema';
import { enqueue } from '../outbox/enqueue';
import {
	IllegalTransitionError,
	checkExpectedVersion,
	lockApplication,
	requireClaimant,
	requireKeyholder,
} from './claim';
import { consumeToken } from './tokens';

/** Outbox job kind for the A6/A7 decision receipt email. */
export const DECISION_EMAIL_JOB_KIND = 'application.decision_email';

/** Outbox job kind for the A8 withdrawal acknowledgement. */
export const WITHDRAWN_ACK_JOB_KIND = 'application.withdrawn_ack';

/**
 * The ratified source-state sets, exported so the unit suite pins them —
 * an accidental `claimed → approved` edge fails a test, not a review.
 */
export const APPROVE_SOURCE_STATUSES = ['tour_scheduled'] as const;
export const DECLINE_SOURCE_STATUSES = ['claimed', 'tour_scheduled'] as const;
export const WITHDRAW_SOURCE_STATUSES = ['submitted', 'email_verified', 'claimed', 'tour_scheduled'] as const;

/** 400-shaped refusal: which required decision mechanics failed. No PII echo. */
export class InvalidDecisionError extends Error {
	readonly fields: readonly string[];
	constructor(fields: readonly string[]) {
		super(`decision invalid: ${fields.join(', ')}`);
		this.name = 'InvalidDecisionError';
		this.fields = fields;
	}
}

export interface ApprovalInput {
	applicationId: string;
	keyholderPersonId: string;
	/** Optional operational note (spec §4). NEVER contribution data. */
	note?: string;
	expectedVersion?: number;
	now?: Date;
}

export interface DeclineInput extends ApprovalInput {
	/**
	 * REQUIRED (TIN-3440 "must record a reason"). Free text, not an enum:
	 * no decline-reason vocabulary is ratified anywhere, and inventing one
	 * here would be a ratification-by-code — the 0003 role posture again.
	 */
	reasonClass: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APPROVAL_FIELDS: ReadonlySet<string> = new Set(['applicationId', 'note', 'expectedVersion']);
const DECLINE_FIELDS: ReadonlySet<string> = new Set(['applicationId', 'reasonClass', 'note', 'expectedVersion']);

interface ValidatedDecisionFields {
	applicationId: string;
	reasonClass?: string;
	note?: string;
	expectedVersion?: number;
}

function validateDecisionFields(
	input: Record<string, unknown>,
	known: ReadonlySet<string>,
	reasonRequired: boolean,
): ValidatedDecisionFields {
	const bad: string[] = [];

	// Unknown keys are rejected — the structural "no contribution field" line
	// (S5 acceptance row 5): a smuggled contribution/payment key fails loudly
	// instead of being dropped silently.
	for (const key of Object.keys(input)) {
		if (!known.has(key)) bad.push(`unknown_field:${key}`);
	}
	if (typeof input.applicationId !== 'string' || !UUID_RE.test(input.applicationId)) {
		bad.push('applicationId');
	}
	if (reasonRequired && (typeof input.reasonClass !== 'string' || input.reasonClass.trim().length === 0)) {
		bad.push('reasonClass');
	}
	if (input.note !== undefined && typeof input.note !== 'string') bad.push('note');
	if (
		input.expectedVersion !== undefined &&
		(typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion))
	) {
		bad.push('expectedVersion');
	}

	if (bad.length > 0) throw new InvalidDecisionError([...new Set(bad)]);

	return {
		applicationId: (input.applicationId as string).toLowerCase(),
		reasonClass: typeof input.reasonClass === 'string' ? input.reasonClass.trim() : undefined,
		note: typeof input.note === 'string' && input.note.trim().length > 0 ? input.note.trim() : undefined,
		expectedVersion: input.expectedVersion as number | undefined,
	};
}

/** Route-facing validator for A6. Rejects unknown keys, structurally. */
export function validateApproval(input: Record<string, unknown>): Omit<ApprovalInput, 'keyholderPersonId'> {
	const v = validateDecisionFields(input, APPROVAL_FIELDS, false);
	return { applicationId: v.applicationId, note: v.note, expectedVersion: v.expectedVersion };
}

/** Route-facing validator for A7. `reasonClass` is required and non-empty. */
export function validateDecline(input: Record<string, unknown>): Omit<DeclineInput, 'keyholderPersonId'> {
	const v = validateDecisionFields(input, DECLINE_FIELDS, true);
	return {
		applicationId: v.applicationId,
		reasonClass: v.reasonClass as string,
		note: v.note,
		expectedVersion: v.expectedVersion,
	};
}

export interface DecisionResult {
	application: Application;
	decision: ApplicationDecision;
	/** false: this exact decision already stood; the original is returned. */
	decided: boolean;
}

async function standingDecision(
	tx: DbTransaction,
	tenantId: string,
	applicationId: string,
): Promise<ApplicationDecision | null> {
	const rows = await tx
		.select()
		.from(applicationDecision)
		.where(and(eq(applicationDecision.tenantId, tenantId), eq(applicationDecision.applicationId, applicationId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * The shared terminal-decision core for A6/A7. Assumes the caller validated
 * source states and claimant-ship; writes the decision row, moves the
 * application, and enqueues the receipt email — one unit of work.
 */
async function commitDecision(
	tx: DbTransaction,
	tenantId: string,
	row: Application,
	decision: 'approved' | 'declined',
	decidedBy: string,
	reasonClass: string | undefined,
	note: string | undefined,
	now: Date,
): Promise<DecisionResult> {
	const inserted = await tx
		.insert(applicationDecision)
		.values({
			tenantId,
			applicationId: row.id,
			decision,
			decidedBy,
			reasonClass: reasonClass ?? null,
			note: note ?? null,
			createdAt: now,
		})
		.returning();

	const updated = await tx
		.update(application)
		.set({ status: decision, version: row.version + 1, updatedAt: now })
		.where(eq(application.id, row.id))
		.returning();

	// The decision receipt (lifecycle diagram: "Declined with receipt"; A6
	// decision email). Identity key, no client segment — one decision can
	// ever commit, so the key cannot need disambiguation.
	await enqueue(tx, {
		kind: DECISION_EMAIL_JOB_KIND,
		aggregateType: 'application',
		aggregateId: row.id,
		payload: { applicationId: row.id },
		idempotencyKey: `${tenantId}:application:${row.id}:decision_email`,
	});

	return { application: updated[0], decision: inserted[0], decided: true };
}

/**
 * Duplicate-request convergence (spec §6: "a duplicate request returns the
 * original result"): a repeat of the SAME decision by the SAME keyholder
 * against an application already in that terminal state returns the standing
 * result instead of 409ing. Anything else — different decision, different
 * actor, withdrawn/expired terminal — is a real conflict.
 */
async function convergeOrConflict(
	tx: DbTransaction,
	tenantId: string,
	row: Application,
	decision: 'approved' | 'declined',
	decidedBy: string,
	event: string,
): Promise<DecisionResult> {
	if (row.status === decision) {
		const standing = await standingDecision(tx, tenantId, row.id);
		if (standing && standing.decision === decision && standing.decidedBy === decidedBy) {
			return { application: row, decision: standing, decided: false };
		}
	}
	throw new IllegalTransitionError(row.status, event);
}

/**
 * A6 — `tour_scheduled → approved` (slices §2.2 row 6). The claiming
 * keyholder, after the in-person tour; races A8 and exactly one commits.
 */
export async function approveApplication(tx: DbTransaction, input: ApprovalInput): Promise<DecisionResult> {
	const now = input.now ?? new Date();
	const tenantId = await requireKeyholder(tx, input.keyholderPersonId);

	const row = await lockApplication(tx, input.applicationId);
	checkExpectedVersion(row, input.expectedVersion);

	if (!(APPROVE_SOURCE_STATUSES as readonly string[]).includes(row.status)) {
		return convergeOrConflict(tx, tenantId, row, 'approved', input.keyholderPersonId, 'approve');
	}
	await requireClaimant(tx, tenantId, row.id, input.keyholderPersonId);

	return commitDecision(tx, tenantId, row, 'approved', input.keyholderPersonId, undefined, input.note, now);
}

/**
 * A7 — `claimed | tour_scheduled → declined` (slices §2.2 row 7), reason
 * class required. The guard here is defence in depth behind the validator
 * AND in front of the database CHECK.
 */
export async function declineApplication(tx: DbTransaction, input: DeclineInput): Promise<DecisionResult> {
	const now = input.now ?? new Date();
	if (typeof input.reasonClass !== 'string' || input.reasonClass.trim().length === 0) {
		throw new InvalidDecisionError(['reasonClass']);
	}
	const tenantId = await requireKeyholder(tx, input.keyholderPersonId);

	const row = await lockApplication(tx, input.applicationId);
	checkExpectedVersion(row, input.expectedVersion);

	if (!(DECLINE_SOURCE_STATUSES as readonly string[]).includes(row.status)) {
		return convergeOrConflict(tx, tenantId, row, 'declined', input.keyholderPersonId, 'decline');
	}
	await requireClaimant(tx, tenantId, row.id, input.keyholderPersonId);

	return commitDecision(
		tx,
		tenantId,
		row,
		'declined',
		input.keyholderPersonId,
		input.reasonClass.trim(),
		input.note,
		now,
	);
}

export interface WithdrawInput {
	/** The plaintext withdrawal token from the A2 receipt email. */
	token: string;
	expectedVersion?: number;
	now?: Date;
}

/**
 * A8 — `submitted | email_verified | claimed | tour_scheduled → withdrawn`
 * (slices §2.2 row 8). Bearer-authorized by the single-use withdrawal token;
 * consumes it and moves the application in one unit of work, so a LOSING race
 * against approve rolls the consumption back too — the token survives a 409
 * exactly the way S4's expectedVersion test proved for verification tokens.
 */
export async function withdrawApplication(tx: DbTransaction, input: WithdrawInput): Promise<Application> {
	const now = input.now ?? new Date();
	const consumed = await consumeToken(tx, input.token, 'withdraw', now);

	const row = await lockApplication(tx, consumed.applicationId);
	checkExpectedVersion(row, input.expectedVersion);
	if (!(WITHDRAW_SOURCE_STATUSES as readonly string[]).includes(row.status)) {
		// The race loser (spec §4: approve × withdraw, only one commits) and
		// any already-terminal state: 409, nothing mutated, token un-consumed
		// by rollback.
		throw new IllegalTransitionError(row.status, 'withdraw');
	}

	const updated = await tx
		.update(application)
		.set({ status: 'withdrawn', version: row.version + 1, updatedAt: now })
		.where(eq(application.id, row.id))
		.returning();

	await enqueue(tx, {
		kind: WITHDRAWN_ACK_JOB_KIND,
		aggregateType: 'application',
		aggregateId: row.id,
		payload: { applicationId: row.id },
		idempotencyKey: `${row.tenantId}:application:${row.id}:withdrawn_ack`,
	});

	return updated[0];
}
