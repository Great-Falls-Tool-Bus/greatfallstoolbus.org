/**
 * The mail-delivery journal write seam (TIN-4062).
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
 * THE RECEIPT DOUBLES AS THE IDEMPOTENCY RECEIPT. A handler runs AT LEAST
 * once (spec §3.1); `mail_delivery_journal`'s unique
 * `(tenant_id, kind, idempotency_key)` is the exact `outbox_job_idem_uniq`
 * shape. `findMailJournalReceipt` lets a handler check "did I already do
 * this" BEFORE minting a token or touching a transport; `writeMailJournal`
 * inserts the receipt in the SAME transaction as the effect, so a replayed
 * job either finds the standing receipt and no-ops, or writes it exactly
 * once.
 *
 * TENANT COMES FROM THE TRANSACTION, exactly like `enqueue(tx, job)`: the
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

export interface WriteMailJournalInput {
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

/** Look up an existing receipt for this exact job replay — the idempotency check, done BEFORE any effect. */
export async function findMailJournalReceipt(
	tx: DbTransaction,
	kind: string,
	idempotencyKey: string,
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
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Write the receipt, inside the same transaction as the effect it records.
 * First write wins (`ON CONFLICT DO NOTHING`, then read back) — the same
 * idempotent shape `enqueue(tx, job)` uses, because two racing replays of the
 * same at-least-once job must converge on one row, not error.
 */
export async function writeMailJournal(
	tx: DbTransaction,
	input: WriteMailJournalInput,
): Promise<MailDeliveryJournalRow> {
	const tenantId = await requireTenant(tx);
	const detail = input.detail === undefined ? null : assertDetail(input.detail);

	const inserted = await tx
		.insert(mailDeliveryJournal)
		.values({
			tenantId,
			outboxJobId: input.outboxJobId,
			kind: input.kind,
			idempotencyKey: input.idempotencyKey,
			templateId: input.templateId,
			templateApproved: input.templateApproved,
			mode: input.mode,
			detail,
		})
		.onConflictDoNothing({
			target: [mailDeliveryJournal.tenantId, mailDeliveryJournal.kind, mailDeliveryJournal.idempotencyKey],
		})
		.returning();

	if (inserted.length === 1) return inserted[0];

	const existing = await findMailJournalReceipt(tx, input.kind, input.idempotencyKey);
	if (!existing) {
		// Unreachable unless the conflicting row was deleted between the insert
		// and this read — the journal is append-only (gftb_app holds no
		// DELETE), so surface it rather than inventing a row.
		throw new Error(
			`mail journal: ON CONFLICT absorbed (${input.kind}, ${input.idempotencyKey}) but the standing row is gone`,
		);
	}
	return existing;
}
