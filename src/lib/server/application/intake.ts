/**
 * Application intake — A2 `submit` and A3 `verify_email` (TIN-3440 slice S4;
 * spec §4 application state machine; slices §2.2 rows 2-3).
 *
 * EVERY function takes the transaction handle `withTenant(tenantId, fn)`
 * produced, first, and none opens a transaction of its own — the S2 auth
 * spine's discipline, inherited. The insert, the outbox enqueue, and (on A3)
 * the token consumption + state transition each commit or roll back as ONE
 * unit of work.
 *
 * WHAT IS STRUCTURALLY ABSENT, ON PURPOSE:
 *   - Contribution. No contribution field exists in `SubmissionInput`, the
 *     validator REJECTS unknown fields (so a smuggled `contributionAmount`
 *     fails loudly rather than being dropped silently), and the table has no
 *     such column. The read-only contribution preview on `/apply` is
 *     presentation-only: its controls never enter the application form or
 *     this payload. "Applicants have no contribution state before approval"
 *     remains true (TIN-3440; contract A2 guard: "no contribution field
 *     accepted, structurally").
 *   - Approval logic. Claim/decide are S5's (`application/{claim,decide}.ts`);
 *     nothing here reads or writes past `email_verified`.
 *   - Audit rows. The audit spine (`src/lib/server/audit/`) is S6's fence;
 *     until it lands, A2/A3 have no audit table to write. RECORDED HAND-OFF:
 *     S6 wires `application.submitted` / `application.email_verified`
 *     (token-hash only, never plaintext) through its spine and back-fills
 *     nothing — the rows begin at the spine's birth.
 *
 * THE RECEIPT IS IMMEDIATE AND CARRIES NO SECRETS. A2's side effect is one
 * outbox job, `application.receipt_email`, enqueued in the same transaction
 * via S3's `enqueue(tx, job)` (no self-opening overload — a rolled-back
 * submission leaves zero receipt jobs). Its payload is `{ applicationId }`
 * ONLY: S3's payload doctrine forbids tokens and secrets in the durable,
 * operator-visible column, so the future mail handler mints the verify +
 * withdraw tokens (tokens.ts) at render time in its own unit of work. The
 * "single-use withdrawal token in the receipt email" (slices §2.2 rows 2/8)
 * is therefore the HANDLER's mint, and this module's contract with it.
 *
 * NON-ENUMERATING RESPONSE: `PUBLIC_RECEIPT` is the one constant body every
 * successful submission maps to — an address that already has an application
 * gets byte-identical treatment to a fresh one (spec §4; S4 acceptance), and
 * a duplicate `Idempotency-Key` returns the standing application rather than
 * creating a second (spec §6; acceptance row 5), mirroring the outbox
 * enqueue's first-write-wins shape.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { application, type Application } from '../db/schema';
import { enqueue } from '../outbox/enqueue';
import { AGE_ATTESTATION_VERSION } from './attestation';
import { TokenRejectedError, consumeToken, freshIdempotencyKey } from './tokens';

/** Outbox job kind for the A2 immediate automated receipt (TIN-3440). */
export const RECEIPT_EMAIL_JOB_KIND = 'application.receipt_email';

/**
 * The one public success body. No id, no echo of the address, no
 * fresh-vs-known distinction — deliberately indistinguishable across every
 * submission outcome that reports success.
 */
export const PUBLIC_RECEIPT = Object.freeze({ received: true } as const);

/** 400-shaped refusal: which REQUIRED mechanics failed, never any PII echo. */
export class InvalidSubmissionError extends Error {
	readonly fields: readonly string[];
	constructor(fields: readonly string[]) {
		super(`submission invalid: ${fields.join(', ')}`);
		this.name = 'InvalidSubmissionError';
		this.fields = fields;
	}
}

/** 409-shaped refusal: `expectedVersion` was stale; nothing was mutated. */
export class VersionConflictError extends Error {
	readonly expected: number;
	readonly actual: number;
	constructor(expected: number, actual: number) {
		super(`stale expectedVersion ${expected}; application is at version ${actual}`);
		this.name = 'VersionConflictError';
		this.expected = expected;
		this.actual = actual;
	}
}

/**
 * Exactly TIN-3440's intake field list, nothing else: "display name, verified
 * external email, interests/help offer, tour availability, and required
 * disclosures". The DISCLOSURE PROMPT text is member-facing copy and not
 * ratified — the mechanism (a required non-empty field) builds now; the
 * prompt ships with the ratified copy round (published: false / TODO until
 * then).
 */
export interface SubmissionInput {
	displayName: string;
	email: string;
	interestsHelpOffer: string;
	tourAvailability: string;
	disclosures: string;
	/** The 18+ checkbox, unchecked by default — must be exactly `true`. */
	ageAttested: boolean;
	/** Client `Idempotency-Key`; generated server-side when absent. */
	idempotencyKey?: string;
}

/**
 * Project an HTTP form onto the exact application aggregate input.
 *
 * The contribution preview deliberately has no named controls and sits
 * outside the form, but this closed projection is the second fence: hostile
 * `pick`, `amount`, payment, or Stripe fields are never forwarded to the
 * validator, database, reviewer projection, or outbox.
 */
export function applicationSubmissionFromForm(
	form: FormData,
	idempotencyKey?: string,
): Record<string, unknown> {
	const submission: Record<string, unknown> = {
		displayName: form.get('displayName') ?? '',
		email: form.get('email') ?? '',
		interestsHelpOffer: form.get('interestsHelpOffer') ?? '',
		tourAvailability: form.get('tourAvailability') ?? '',
		disclosures: form.get('disclosures') ?? '',
		ageAttested: form.get('ageAttested') === 'on' || form.get('ageAttested') === 'true',
	};
	if (idempotencyKey) submission.idempotencyKey = idempotencyKey;
	return submission;
}

const REQUIRED_TEXT_FIELDS = ['displayName', 'email', 'interestsHelpOffer', 'tourAvailability', 'disclosures'] as const;

const KNOWN_FIELDS: ReadonlySet<string> = new Set([...REQUIRED_TEXT_FIELDS, 'ageAttested', 'idempotencyKey']);

/**
 * Normalize an address the spec's way (spec §4: "normalized, verified,
 * mutable identifier"): trim + lowercase. Deeper canonicalisation (plus
 * addressing, IDN) is deliberately NOT attempted — over-normalising merges
 * addresses their owner considers distinct.
 */
export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure validation, unit-testable without PostgreSQL. Throws
 * `InvalidSubmissionError` naming the failed MECHANICS (field names only).
 * Unknown keys are rejected — the structural "no contribution field" line.
 */
export function validateSubmission(input: Record<string, unknown>): SubmissionInput {
	const bad: string[] = [];

	for (const key of Object.keys(input)) {
		if (!KNOWN_FIELDS.has(key)) bad.push(`unknown_field:${key}`);
	}
	for (const field of REQUIRED_TEXT_FIELDS) {
		const value = input[field];
		if (typeof value !== 'string' || value.trim().length === 0) bad.push(field);
	}
	if (typeof input.email === 'string' && input.email.trim().length > 0 && !EMAIL_SHAPE.test(input.email.trim())) {
		bad.push('email');
	}
	if (input.ageAttested !== true) bad.push('ageAttested');
	if (
		input.idempotencyKey !== undefined &&
		(typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim().length === 0)
	) {
		bad.push('idempotencyKey');
	}

	if (bad.length > 0) throw new InvalidSubmissionError([...new Set(bad)]);

	return {
		displayName: (input.displayName as string).trim(),
		email: normalizeEmail(input.email as string),
		interestsHelpOffer: (input.interestsHelpOffer as string).trim(),
		tourAvailability: (input.tourAvailability as string).trim(),
		disclosures: (input.disclosures as string).trim(),
		ageAttested: true,
		idempotencyKey: (input.idempotencyKey as string | undefined)?.trim(),
	};
}

export interface SubmissionResult {
	application: Application;
	/** false: the Idempotency-Key already had a standing application. */
	created: boolean;
}

/**
 * A2 — `submitted` is born (slices §2.2 row 2). Insert + receipt enqueue in
 * the caller's transaction; duplicate `Idempotency-Key` returns the standing
 * row (`created: false`) via the same ON-CONFLICT-then-read shape as the
 * outbox enqueue, so two racing duplicates converge instead of erroring.
 */
export async function submitApplication(
	tx: DbTransaction,
	validated: SubmissionInput,
	now: Date = new Date(),
): Promise<SubmissionResult> {
	if (validated.ageAttested !== true) {
		// Defense in depth: submitApplication must hold A2's guard even for a
		// caller that skipped validateSubmission.
		throw new InvalidSubmissionError(['ageAttested']);
	}
	const idempotencyKey = validated.idempotencyKey ?? freshIdempotencyKey();
	const tenantId = await tenantFromGuc(tx);

	const inserted = await tx
		.insert(application)
		.values({
			displayName: validated.displayName,
			email: validated.email,
			interestsHelpOffer: validated.interestsHelpOffer,
			tourAvailability: validated.tourAvailability,
			disclosures: validated.disclosures,
			ageAttestedAt: now,
			ageAttestationVersion: AGE_ATTESTATION_VERSION,
			submissionIdempotencyKey: idempotencyKey,
			tenantId,
		})
		.onConflictDoNothing({ target: [application.tenantId, application.submissionIdempotencyKey] })
		.returning();

	if (inserted.length === 1) {
		const row = inserted[0];
		// The immediate automated receipt (TIN-3440), same transaction, S3 key
		// format `<tenant>:<aggregate>:<aggregate_id>:<event>:<client_key>`
		// (slices §2.2). Payload carries the aggregate id ONLY — no address, no
		// token (S3 payload doctrine); the mail handler reads the row itself.
		await enqueue(tx, {
			kind: RECEIPT_EMAIL_JOB_KIND,
			aggregateType: 'application',
			aggregateId: row.id,
			payload: { applicationId: row.id },
			idempotencyKey: `${row.tenantId}:application:${row.id}:receipt_email:${idempotencyKey}`,
		});
		return { application: row, created: true };
	}

	// Duplicate Idempotency-Key: return the original result (spec §6).
	const existing = await tx
		.select()
		.from(application)
		.where(and(eq(application.tenantId, tenantId), eq(application.submissionIdempotencyKey, idempotencyKey)))
		.limit(1);
	if (existing.length !== 1) {
		throw new Error('application submit: ON CONFLICT absorbed the insert but the standing row is gone');
	}
	return { application: existing[0], created: false };
}

export interface VerifyEmailInput {
	/** The plaintext bearer token from the receipt email. */
	token: string;
	/**
	 * Optional optimistic-concurrency check (spec §4 `expectedVersion`). The
	 * token itself is the bearer authority; a mismatch, when provided, 409s.
	 */
	expectedVersion?: number;
	now?: Date;
}

/**
 * A3 — `submitted → email_verified` (slices §2.2 row 3). Consumes the
 * verification token (single-use, expiring — refusals are uniform and
 * carry no plaintext) and, in the same unit of work, moves the application
 * and stamps `email_verified_at`: the start of the 3-business-day human
 * response clock (spec §4; TIN-3440 "human response target is three business
 * days" — the clock is this timestamp; scheduling anything off it is not
 * S4's).
 */
export async function verifyEmail(tx: DbTransaction, input: VerifyEmailInput): Promise<Application> {
	const now = input.now ?? new Date();
	const consumed = await consumeToken(tx, input.token, 'verify_email', now);

	const rows = await tx
		.select()
		.from(application)
		.where(eq(application.id, consumed.applicationId))
		.for('update')
		.limit(1);
	if (rows.length !== 1) {
		// The token row FK guarantees existence; RLS-invisible means wrong tenant.
		throw new TokenRejectedError('unknown');
	}
	const row = rows[0];
	if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
		throw new VersionConflictError(input.expectedVersion, row.version);
	}
	if (row.status !== 'submitted') {
		// A3's only legal source state. A verified/terminal application refuses
		// with the same uniform message as any dead token.
		throw new TokenRejectedError('consumed');
	}

	const updated = await tx
		.update(application)
		.set({
			status: 'email_verified',
			emailVerifiedAt: now,
			version: row.version + 1,
			updatedAt: now,
		})
		.where(eq(application.id, row.id))
		.returning();
	return updated[0];
}

/** GUC read, failing fast — same rationale as tokens.ts's copy. */
async function tenantFromGuc(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error(
			'application intake: this transaction has no app.tenant_id — submit only inside withTenant(tenantId, fn).',
		);
	}
	return tenantId;
}
