/**
 * Audit spine contract surface (TIN-3440 slice S6; spec §6 audit contract).
 *
 * WHY THIS FILE DECLARES NO TABLE — the S3 outbox precedent: `audit_event`
 * and its append-only hardening live in `src/lib/server/db/schema.ts` +
 * migration `0009`, which is drizzle-kit's diff surface. This file is the
 * CONTRACT every slice writing audit rows agrees on: the closed input shape,
 * the event-name vocabulary, and the content rules the write seam enforces.
 *
 * THE SHAPE IS CLOSED ON PURPOSE (spec §6: audit events "omit tokens,
 * secrets, object URLs, and unnecessary personal content"). There is no
 * free-text column: `reason_class` is a short classification validated at the
 * write seam (`./write.ts`), `token_hash` is the hash-only slot the
 * `application.email_verified` row requires ("token hash only, never
 * plaintext" — slices §2.2 row 3), and everything else is an id, an enum-like
 * string, or a timestamp. The S6 acceptance scanner test asserts the seam
 * refuses token-shaped strings, URLs, addresses, and free text — the rule is
 * enforced, not promised.
 *
 * REQUIRED FIELDS (spec §6, verbatim): actor, aggregate, transition, result,
 * policy/agreement version, timestamp. `agreement_version` is REQUIRED on
 * `membership.activated` (slices §2.2 row 10) and otherwise optional;
 * `reauth_at` is REQUIRED on `membership.removed` (row 14).
 */

export type { AuditEvent } from '../db/schema';

/** Who acted. `person` requires `actorId`; `system`/`public` forbid it. */
export type AuditActorType = 'person' | 'system' | 'public';

/**
 * The event vocabulary — exactly the ratified transition table's audit-record
 * column (slices §2.2 rows 2–14). Wiring status per event:
 *   - rows 2–5, 7–9 (application intake/review/decline/withdraw/expire):
 *     names reserved here; the S4/S5 modules predate the spine and their
 *     wiring is a RECORDED HAND-OFF in this slice's PR body — mechanical,
 *     each an `writeAudit` call inside the existing unit of work.
 *   - row 6 (approve): written by `provisionOnApproval` (S6) — BOTH rows,
 *     `application.approved` + `membership.created`.
 *   - rows 10–14: written by the S6/S7 membership modules in this slice.
 */
export const AUDIT_EVENTS = [
	'application.submitted',
	'application.email_verified',
	'application.claimed',
	'application.tour_scheduled',
	'application.approved',
	'application.declined',
	'application.withdrawn',
	'application.expired',
	'membership.created',
	'membership.activated',
	'membership.paused',
	'membership.resumed',
	'membership.left',
	'membership.removed',
] as const;

export type AuditEventName = (typeof AUDIT_EVENTS)[number];

/** The closed write shape. Unknown keys are rejected by the seam. */
export interface AuditEventInput {
	actorType: AuditActorType;
	/** UUID of the acting person; required iff `actorType === 'person'`. */
	actorId?: string;
	aggregateType: 'application' | 'membership';
	aggregateId: string;
	event: AuditEventName;
	fromStatus?: string;
	toStatus?: string;
	/** Defaults to `committed` — the row rides the same tx as the transition. */
	result?: string;
	/** REQUIRED on `membership.activated` (slices §2.2 row 10). */
	agreementVersionId?: number;
	/** Short classification, never narrative — see `assertReasonClass`. */
	reasonClass?: string;
	/** REQUIRED on `membership.removed` (slices §2.2 row 14). */
	reauthAt?: Date;
	/** SHA-256 hex of a token — never, ever the plaintext (row 3). */
	tokenHash?: string;
	now?: Date;
}

/** The spec §6 field list, exported so the unit suite pins it structurally. */
export const AUDIT_REQUIRED_COLUMNS = [
	'actorType',
	'aggregateType',
	'aggregateId',
	'event',
	'result',
	'createdAt',
] as const;
