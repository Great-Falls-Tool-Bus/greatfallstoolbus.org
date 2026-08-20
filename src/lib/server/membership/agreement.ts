/**
 * Versioned membership agreement mechanics (TIN-3440 slice S6; slices §1.8
 * ASSUMPTION; sitting-2 packet item 3 — MECHANICS now, ratified values land
 * as data ~2026-08-22).
 *
 * THE DRAFTED SCHEME, implemented exactly (slices §1.8, recommended option,
 * NOT ratified as copy — the packet ratifies the identifier scheme's shape):
 *   - `agreement_version.id` — monotonically increasing integer per tenant;
 *   - `body_sha256` — immutable digest of the assented text;
 *   - `effective_from` — timestamptz;
 *   - rows append-only (migration 0009: revoke + trigger, owner-binding);
 *   - assent stores the integer, never the text;
 *   - exactly one version is `current`: the greatest `effective_from` at or
 *     before now, ties broken by highest id. Currency is a PURE FUNCTION of
 *     append-only rows (`pickCurrent`, unit-tested), so no mutable
 *     `is_current` flag exists to desynchronise.
 *
 * THE MEMBERSHIP AGREEMENT AND THE CONTRIBUTION COPY ARE SEPARABLE RECORDS
 * (ADR 0016 §2.3): money-wording changes never force re-assent, and this
 * module deliberately has no edge to `src/lib/server/contribution/**` —
 * the same static boundary the whole membership fence carries.
 */

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { agreementVersion, type AgreementVersion } from '../db/schema';

/**
 * TODO(sitting-2 item 3 + gate row 4, ~2026-08-22): version 1's BODY is the
 * initial membership agreement text — operator-approved with the gate-row-4
 * copy work, finalized against the formed entity, SEPARABLE from contribution
 * copy (ADR 0016 §2.3). It lands as DATA (an operator-published
 * `agreement_version` row via `publishAgreementVersion`), never as
 * agent-authored published copy; until a version row exists the assent
 * surface reports itself honestly unavailable. This constant stays
 * `undefined` in the repository — the scheme ships now so S6 need not wait
 * for the text (packet item 3).
 */
export const AGREEMENT_BODY_V1: string | undefined = undefined;

/** SHA-256 hex of an agreement body — the digest `body_sha256` pins. */
export function agreementBodySha256(body: string): string {
	return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** 409-shaped: the presented version is not the current one (row 10 guard). */
export class SupersededAgreementError extends Error {
	readonly presented: number;
	readonly current: number | null;
	constructor(presented: number, current: number | null) {
		super('Assent must be to the current agreement version.');
		this.name = 'SupersededAgreementError';
		this.presented = presented;
		this.current = current;
	}
}

/** 503-shaped: no agreement version exists yet (pre-ratification honesty). */
export class NoAgreementVersionError extends Error {
	constructor() {
		super('No membership agreement version has been published yet.');
		this.name = 'NoAgreementVersionError';
	}
}

/**
 * The pure currency rule, exported for the unit suite: greatest
 * `effective_from` at or before `now`, ties broken by highest id. Rows whose
 * `effective_from` is in the future are not yet current (a version can be
 * published ahead of its effective date without instantly superseding).
 */
export function pickCurrent(rows: readonly AgreementVersion[], now: Date): AgreementVersion | null {
	let current: AgreementVersion | null = null;
	for (const row of rows) {
		if (row.effectiveFrom.getTime() > now.getTime()) continue;
		if (
			current === null ||
			row.effectiveFrom.getTime() > current.effectiveFrom.getTime() ||
			(row.effectiveFrom.getTime() === current.effectiveFrom.getTime() && row.id > current.id)
		) {
			current = row;
		}
	}
	return current;
}

/** The current agreement version for this tenant, or null when none exists. */
export async function currentAgreementVersion(
	tx: DbTransaction,
	now: Date = new Date(),
): Promise<AgreementVersion | null> {
	const tenantId = await currentTenant(tx);
	const rows = await tx.select().from(agreementVersion).where(eq(agreementVersion.tenantId, tenantId));
	return pickCurrent(rows, now);
}

export interface PublishAgreementInput {
	/** The exact text a person will assent to. Never agent-authored copy. */
	body: string;
	/** Defaults to now — the version becomes current immediately. */
	effectiveFrom?: Date;
	now?: Date;
}

/**
 * Append the next agreement version: id = max + 1 for this tenant, digest
 * computed here so `body_sha256` can never disagree with `body`. The insert
 * serialises on the composite primary key — two concurrent publishes race to
 * the same `max + 1` and the loser gets a unique violation rather than a
 * silent double-claim; the operator surface retries.
 *
 * This is the OPERATOR-mediated publication mechanic (sitting-2 item 3): the
 * ratified text arrives as data through here — there is no route surface for
 * it in S6, deliberately.
 */
export async function publishAgreementVersion(
	tx: DbTransaction,
	input: PublishAgreementInput,
): Promise<AgreementVersion> {
	if (input.body.trim().length === 0) {
		throw new Error('agreement: a version body must be non-empty.');
	}
	const now = input.now ?? new Date();
	const tenantId = await currentTenant(tx);
	const next = await tx.execute<{ next_id: number }>(
		sql`select coalesce(max(id), 0) + 1 as next_id from ${agreementVersion} where tenant_id = ${tenantId}`,
	);
	const rows = await tx
		.insert(agreementVersion)
		.values({
			tenantId,
			id: Number(next.rows[0].next_id),
			body: input.body,
			bodySha256: agreementBodySha256(input.body),
			effectiveFrom: input.effectiveFrom ?? now,
			createdAt: now,
		})
		.returning();
	return rows[0];
}

/**
 * The M1 guard (slices §2.2 row 10): the presented version must be the
 * CURRENT one — assent to a superseded (or future, or unknown) version is
 * rejected with an explicit 409-shaped error, never silently upgraded.
 */
export async function requireCurrentAgreement(
	tx: DbTransaction,
	presentedVersionId: number,
	now: Date = new Date(),
): Promise<AgreementVersion> {
	const current = await currentAgreementVersion(tx, now);
	if (current === null) throw new NoAgreementVersionError();
	if (current.id !== presentedVersionId) {
		throw new SupersededAgreementError(presentedVersionId, current.id);
	}
	return current;
}

/** One version by id, for display of a historical assent. */
export async function agreementVersionById(tx: DbTransaction, id: number): Promise<AgreementVersion | null> {
	const tenantId = await currentTenant(tx);
	const rows = await tx
		.select()
		.from(agreementVersion)
		.where(and(eq(agreementVersion.tenantId, tenantId), eq(agreementVersion.id, id)))
		.limit(1);
	return rows[0] ?? null;
}

/** GUC read, failing fast — the tokens.ts/claim.ts precedent verbatim. */
async function currentTenant(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error('agreement: this transaction has no app.tenant_id — act only inside withTenant(tenantId, fn).');
	}
	return tenantId;
}
