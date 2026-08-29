/**
 * The mail-delivery journal write seam (TIN-4062; PR #208 review E2:
 * two-phase, network send outside any open transaction).
 *
 * WHY A DEDICATED TABLE, NOT AN AUDIT EVENT. `AUDIT_EVENTS`
 * (`src/lib/server/audit/schema.ts`) is a CLOSED, ratified 14-name
 * vocabulary (spec §6; slices §2.2 rows 2-14) — `assertAuditInput` hard-
 * rejects any other name, and adding a 15th name here would be exactly the
 * ratification-by-migration the audit spine's own doctrine refuses elsewhere
 * (0003's role-vocabulary posture, applied again). "Delivery gate is closed"
 * is operational machinery, not a member-lifecycle transition, so it gets its
 * own append-only table (`mail_delivery_journal`, `db/schema.ts`) instead —
 * the exact S3 outbox precedent (`outbox/schema.ts` "this file declares no
 * table"; the table lives in `db/schema.ts`, migration-generated).
 *
 * TWO PHASES, TWO INSERTS, NEVER AN UPDATE.
 *   - `writeMailIntent` — committed BEFORE `MailDelivery.send()` is ever
 *     called. This is the durable "we are about to attempt this" fact, and
 *     its commit is what lets the caller CLOSE its transaction before
 *     touching a socket: a hung SMTP peer (see `./delivery.ts`'s
 *     `readResponse` timeout) then blocks only its own dispatch attempt,
 *     never a held PostgreSQL transaction or the connection backing it.
 *   - `writeMailOutcome` — committed AFTER `send()` returns, in a FRESH
 *     transaction. Recording the intent and recording the outcome are
 *     therefore two separate commits, which is exactly what makes "the
 *     network call happens outside any open transaction" true rather than
 *     aspirational.
 *   - `findMailJournalPhase` is the read side both phases and the caller's
 *     idempotency check use: an `outcome` row present means fully done
 *     (converge, no-op — replaying mints no second token, sends nothing
 *     twice); an `intent` row present with NO matching `outcome` is
 *     AMBIGUOUS — the prior attempt may have sent for real and crashed
 *     before recording it — and `outbox/handlers/mail-shared.ts` refuses to
 *     guess, throwing `AmbiguousDeliveryStateError` rather than sending
 *     again. This is the spec §3.1 fail-closed doctrine applied to a side
 *     effect the queue cannot undo: "a projection failure is visible and
 *     retryable" is the outbox's promise for retry-safe effects, and an
 *     already-possibly-sent email is deliberately NOT treated as one — the
 *     job dead-letters visibly (an operator resolves it) instead of risking
 *     a second copy of a real message reaching a real person.
 *
 * TENANT COMES FROM THE TRANSACTION, exactly like `enqueue(tx, job)`: each
 * row's `tenant_id` is read back from the `app.tenant_id` GUC `withTenant`
 * pinned, so a caller cannot express "journal for another tenant."
 *
 * CONTENT RULES mirror the audit spine's (spec §6: never a secret, a token,
 * or an object URL in a durable operator-visible column): `detail` is a
 * short operator-facing note, never a rendered email body, an address, or a
 * token.
 */

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { mailDeliveryJournal, type MailDeliveryJournalRow } from '../db/schema';
import { currentTenantId } from '../db/tenant';

export type MailDeliveryMode = 'disabled' | 'sent';
export type MailJournalPhase = 'intent' | 'outcome';

const TOKEN_SHAPE_RE = /[A-Za-z0-9_-]{32,}/;
const URL_SHAPE_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;
const EMAIL_SHAPE_RE = /@/;

/** `detail` is an operator note, not a log sink — bounded like `outbox_job.last_error`. */
export const MAX_DETAIL_LENGTH = 500;

export class InvalidMailJournalInputError extends Error {
	readonly fields: readonly string[];
	constructor(fields: readonly string[]) {
		super(`mail journal input invalid: ${fields.join(', ')}`);
		this.name = 'InvalidMailJournalInputError';
		this.fields = fields;
	}
}

export interface WriteMailIntentInput {
	outboxJobId: string;
	kind: string;
	idempotencyKey: string;
	templateId: string;
	templateApproved: boolean;
}

export interface WriteMailOutcomeInput {
	outboxJobId: string;
	kind: string;
	idempotencyKey: string;
	templateId: string;
	templateApproved: boolean;
	mode: MailDeliveryMode;
	/** Short operator-facing note. Never a URL, an address, or a token-shaped string. */
	detail?: string;
}

/** Exported for the unit suite, mirroring `audit/write.ts`'s `assertReasonClass`. */
export function assertDetail(value: string): string {
	const trimmed = value.trim();
	const bad =
		trimmed.length === 0 ||
		trimmed.length > MAX_DETAIL_LENGTH ||
		/[\r\n\t]/.test(trimmed) ||
		URL_SHAPE_RE.test(trimmed) ||
		EMAIL_SHAPE_RE.test(trimmed) ||
		TOKEN_SHAPE_RE.test(trimmed);
	if (bad) throw new InvalidMailJournalInputError(['detail']);
	return trimmed;
}

async function requireTenant(tx: DbTransaction): Promise<string> {
	const tenantId = await currentTenantId(tx);
	if (!tenantId) {
		throw new Error(
			'mail journal: this transaction has no app.tenant_id — read/write only inside withTenant(tenantId, fn).',
		);
	}
	return tenantId;
}

/** Look up an existing row for this exact (kind, idempotencyKey, phase) — the read side of both phases. */
export async function findMailJournalPhase(
	tx: DbTransaction,
	kind: string,
	idempotencyKey: string,
	phase: MailJournalPhase,
): Promise<MailDeliveryJournalRow | null> {
	const tenantId = await requireTenant(tx);
	const rows = await tx
		.select()
		.from(mailDeliveryJournal)
		.where(
			and(
				eq(mailDeliveryJournal.tenantId, tenantId),
				eq(mailDeliveryJournal.kind, kind),
				eq(mailDeliveryJournal.idempotencyKey, idempotencyKey),
				eq(mailDeliveryJournal.phase, phase),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Write the `intent` row — BEFORE `send()` is ever called, inside the SAME
 * transaction as the render/mint step. First write wins
 * (`ON CONFLICT DO NOTHING`, then read back), the same idempotent shape
 * `enqueue(tx, job)` uses.
 */
export async function writeMailIntent(tx: DbTransaction, input: WriteMailIntentInput): Promise<MailDeliveryJournalRow> {
	return insertPhaseRow(tx, {
		outboxJobId: input.outboxJobId,
		kind: input.kind,
		idempotencyKey: input.idempotencyKey,
		phase: 'intent',
		templateId: input.templateId,
		templateApproved: input.templateApproved,
		mode: null,
		detail: null,
	});
}

/**
 * Write the `outcome` row — AFTER `send()` returns, in a FRESH transaction
 * (never the one the intent row committed in). First write wins, same shape
 * as `writeMailIntent`.
 */
export async function writeMailOutcome(
	tx: DbTransaction,
	input: WriteMailOutcomeInput,
): Promise<MailDeliveryJournalRow> {
	const detail = input.detail === undefined ? null : assertDetail(input.detail);
	return insertPhaseRow(tx, {
		outboxJobId: input.outboxJobId,
		kind: input.kind,
		idempotencyKey: input.idempotencyKey,
		phase: 'outcome',
		templateId: input.templateId,
		templateApproved: input.templateApproved,
		mode: input.mode,
		detail,
	});
}

interface InsertPhaseRowInput {
	outboxJobId: string;
	kind: string;
	idempotencyKey: string;
	phase: MailJournalPhase;
	templateId: string;
	templateApproved: boolean;
	mode: MailDeliveryMode | null;
	detail: string | null;
}

async function insertPhaseRow(tx: DbTransaction, input: InsertPhaseRowInput): Promise<MailDeliveryJournalRow> {
	const tenantId = await requireTenant(tx);

	const inserted = await tx
		.insert(mailDeliveryJournal)
		.values({
			tenantId,
			outboxJobId: input.outboxJobId,
			kind: input.kind,
			idempotencyKey: input.idempotencyKey,
			phase: input.phase,
			templateId: input.templateId,
			templateApproved: input.templateApproved,
			mode: input.mode,
			detail: input.detail,
		})
		.onConflictDoNothing({
			target: [
				mailDeliveryJournal.tenantId,
				mailDeliveryJournal.kind,
				mailDeliveryJournal.idempotencyKey,
				mailDeliveryJournal.phase,
			],
		})
		.returning();

	if (inserted.length === 1) return inserted[0];

	const existing = await findMailJournalPhase(tx, input.kind, input.idempotencyKey, input.phase);
	if (!existing) {
		// Unreachable unless the conflicting row was deleted between the insert
		// and this read — the journal is append-only (gftb_app holds no
		// DELETE), so surface it rather than inventing a row.
		throw new Error(
			`mail journal: ON CONFLICT absorbed (${input.kind}, ${input.idempotencyKey}, ${input.phase}) but the standing row is gone`,
		);
	}
	return existing;
}
