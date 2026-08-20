/**
 * The audit write seam (TIN-3440 slice S6; spec §6 audit contract).
 *
 * EVERY audit row in Member v0 goes through `writeAudit`, inside the SAME
 * transaction as the transition it records — the audit commit is part of the
 * unit of work (spec §4 "an audit commit"; S6 acceptance row 2: an injected
 * failure leaves no partial audit event). The table is append-only and
 * immutable at the database (migration 0009, grant + trigger), so this seam
 * is the last point where content rules can be enforced — and it enforces
 * them by REFUSING, not by redacting: a caller holding a token or a URL in a
 * reason field is a bug to surface, not to launder.
 *
 * CONTENT RULES (spec §6 "omit tokens, secrets, object URLs, and unnecessary
 * personal content"), each with a scanner row in the S6 unit suite:
 *   - `reasonClass` is a CLASSIFICATION: one short line, no whitespace runs,
 *     no URL shapes, no @-addresses, no token-shaped entropy.
 *   - `tokenHash` must be exactly a SHA-256 hex digest — the one token
 *     representation allowed at rest (slices §2.2 row 3).
 *   - There is no other string-typed field a caller controls; ids are UUIDs,
 *     names come from the closed `AUDIT_EVENTS` vocabulary.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { auditEvent, type AuditEvent } from '../db/schema';
import { AUDIT_EVENTS, type AuditEventInput } from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

/** URL-ish content: a scheme or a www. prefix — the spec's "object URLs". */
const URL_SHAPE_RE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i;

/** Address-ish content — personal data has no place in a reason class. */
const EMAIL_SHAPE_RE = /@/;

/**
 * Token-shaped entropy: one unbroken run of 32+ base64url characters. The
 * mint in application/tokens.ts produces 43 (32 bytes, base64url); anything
 * in that family is refused whether or not it is "really" a token.
 */
const TOKEN_SHAPE_RE = /[A-Za-z0-9_-]{32,}/;

/** Reason classes are short slugs, never narrative. */
export const MAX_REASON_CLASS_LENGTH = 100;

/** 400-shaped refusal: which audit content rule the caller broke. */
export class InvalidAuditEventError extends Error {
	readonly fields: readonly string[];
	constructor(fields: readonly string[]) {
		super(`audit event invalid: ${fields.join(', ')}`);
		this.name = 'InvalidAuditEventError';
		this.fields = fields;
	}
}

/**
 * The reason-class content gate, exported for the scanner unit rows. A reason
 * class is a classification (`moved_away`, `code_of_conduct`) — one short
 * line with no URLs, no addresses, no token-shaped runs, and at most single
 * spaces between words.
 */
export function assertReasonClass(value: string): string {
	const trimmed = value.trim();
	const bad =
		trimmed.length === 0 ||
		trimmed.length > MAX_REASON_CLASS_LENGTH ||
		/[\r\n\t]/.test(trimmed) ||
		/ {2,}/.test(trimmed) ||
		URL_SHAPE_RE.test(trimmed) ||
		EMAIL_SHAPE_RE.test(trimmed) ||
		TOKEN_SHAPE_RE.test(trimmed);
	if (bad) throw new InvalidAuditEventError(['reasonClass']);
	return trimmed;
}

/** The full input gate, exported for the S6 scanner unit rows. */
export function assertAuditInput(input: AuditEventInput): void {
	const bad: string[] = [];
	if (!(AUDIT_EVENTS as readonly string[]).includes(input.event)) bad.push('event');
	if (!['person', 'system', 'public'].includes(input.actorType)) bad.push('actorType');
	if (input.actorType === 'person' && (typeof input.actorId !== 'string' || !UUID_RE.test(input.actorId))) {
		bad.push('actorId');
	}
	if (input.actorType !== 'person' && input.actorId !== undefined) bad.push('actorId');
	if (!['application', 'membership'].includes(input.aggregateType)) bad.push('aggregateType');
	if (typeof input.aggregateId !== 'string' || !UUID_RE.test(input.aggregateId)) bad.push('aggregateId');
	if (input.tokenHash !== undefined && !SHA256_HEX_RE.test(input.tokenHash)) bad.push('tokenHash');
	if (input.event === 'membership.activated' && typeof input.agreementVersionId !== 'number') {
		// Row 10: "membership.activated — agreement version required".
		bad.push('agreementVersionId');
	}
	if (input.event === 'membership.removed' && !(input.reauthAt instanceof Date)) {
		// Row 14: "actor, reason, reauth timestamp".
		bad.push('reauthAt');
	}
	if (bad.length > 0) throw new InvalidAuditEventError(bad);
}

/**
 * Append one audit row inside the caller's `withTenant` transaction. The
 * row's `tenant_id` rides the RLS `WITH CHECK` via the pinned GUC (the
 * outbox-enqueue property): a cross-tenant audit row is inexpressible.
 */
export async function writeAudit(tx: DbTransaction, input: AuditEventInput): Promise<AuditEvent> {
	assertAuditInput(input);
	const reasonClass = input.reasonClass === undefined ? null : assertReasonClass(input.reasonClass);
	const tenantId = await currentTenant(tx);
	const rows = await tx
		.insert(auditEvent)
		.values({
			tenantId,
			actorType: input.actorType,
			actorId: input.actorId ?? null,
			aggregateType: input.aggregateType,
			aggregateId: input.aggregateId,
			event: input.event,
			fromStatus: input.fromStatus ?? null,
			toStatus: input.toStatus ?? null,
			result: input.result ?? 'committed',
			agreementVersionId: input.agreementVersionId ?? null,
			reasonClass,
			reauthAt: input.reauthAt ?? null,
			tokenHash: input.tokenHash?.toLowerCase() ?? null,
			...(input.now !== undefined ? { createdAt: input.now } : {}),
		})
		.returning();
	return rows[0];
}

/** Every audit row for one aggregate, oldest first — the record's trail. */
export async function auditTrail(
	tx: DbTransaction,
	aggregateType: 'application' | 'membership',
	aggregateId: string,
): Promise<AuditEvent[]> {
	const tenantId = await currentTenant(tx);
	return tx
		.select()
		.from(auditEvent)
		.where(
			and(
				eq(auditEvent.tenantId, tenantId),
				eq(auditEvent.aggregateType, aggregateType),
				eq(auditEvent.aggregateId, aggregateId),
			),
		)
		.orderBy(auditEvent.createdAt, auditEvent.id);
}

/** GUC read, failing fast — the tokens.ts/claim.ts precedent verbatim. */
async function currentTenant(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error('audit: this transaction has no app.tenant_id — write only inside withTenant(tenantId, fn).');
	}
	return tenantId;
}
