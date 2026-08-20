/**
 * Application email tokens (TIN-3440 slice S4; spec §4: "verification tokens
 * are random, opaque, hashed at rest, single-use, and expiring").
 *
 * WHERE THE PLAINTEXT MAY EXIST, EXHAUSTIVELY: the return value of
 * `mintToken`, and the email body the future `application.receipt_email`
 * outbox handler renders. Nowhere else — not in a log line, not in an audit
 * row (S6's spine, when it lands, receives `token_hash` only), and NOT in the
 * outbox `payload` (S3's doctrine in `src/lib/server/outbox/schema.ts`:
 * "payload … must never carry a secret or token"; the column is durable and
 * operator-visible). That last rule forces the delivery design: the A2
 * receipt job carries `{ applicationId }` only, and the MAIL HANDLER mints
 * the verify/withdraw tokens at render time, inside its own `withTenant`
 * unit of work, via `mintToken` here. A log-capture unit test asserts the
 * no-plaintext property.
 *
 * NON-ENUMERATING REFUSAL. `TokenRejectedError` carries an internal `reason`
 * (for tests and server-side logs-without-the-token) but ONE public message:
 * unknown, expired, consumed, and wrong-purpose tokens are indistinguishable
 * to the bearer, exactly like the submission endpoint's same-response rule
 * (spec §4 "minimal and non-enumerating"; §6 request contract).
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/client';
import { applicationEmailToken, type ApplicationEmailToken } from '../db/schema';

/** 32 bytes of CSPRNG entropy per token, base64url — random and opaque. */
export const TOKEN_BYTES = 32;

/**
 * Verification-token lifetime. The spec ratifies THAT verification tokens
 * expire (spec §4), not the figure — 48 h is an ASSUMPTION under the same
 * umbrella as the outbox lease/batch/backoff numbers (slices §3.1 pattern:
 * recorded, per-call overridable, cheap to change; resolver Jess, sitting #2).
 * This is a token TTL, not the application-expiry TTL — that one is
 * `APPLICATION_EXPIRY_TTL`, config with NO default (slices §2.2 row 9), and
 * outside S4's scope.
 */
export const VERIFY_EMAIL_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export type TokenPurpose = 'verify_email' | 'withdraw';

/** Internal shape `assessTokenRow` decides over; a subset of the table row. */
export interface AssessableTokenRow {
	purpose: string;
	expiresAt: Date | null;
	consumedAt: Date | null;
}

export type TokenVerdict = 'valid' | 'unknown' | 'consumed' | 'expired' | 'wrong_purpose';

/**
 * One public message for every refusal — the bearer learns nothing about
 * WHY (or whether the token ever existed); the `reason` field is for the
 * server side and the test suite. The message must never interpolate the
 * token or its hash.
 */
export class TokenRejectedError extends Error {
	readonly reason: Exclude<TokenVerdict, 'valid'>;
	constructor(reason: Exclude<TokenVerdict, 'valid'>) {
		super('This link is no longer valid.');
		this.name = 'TokenRejectedError';
		this.reason = reason;
	}
}

/** Mint the plaintext: 32 CSPRNG bytes, base64url. Never log the result. */
export function generateToken(): string {
	return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex — the only representation that touches a durable row. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The pure single-use/expiry decision, separated from the database so the
 * S4 unit rows (expired rejected; replayed rejected) run without PostgreSQL.
 * Order matters and is deliberate: an expired-AND-consumed row reads as
 * consumed — replay of a dead credential is the more serious signal.
 */
export function assessTokenRow(
	row: AssessableTokenRow | undefined,
	expectedPurpose: TokenPurpose,
	now: Date,
): TokenVerdict {
	if (row === undefined) return 'unknown';
	if (row.purpose !== expectedPurpose) return 'wrong_purpose';
	if (row.consumedAt !== null) return 'consumed';
	if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return 'expired';
	return 'valid';
}

export interface MintTokenInput {
	applicationId: string;
	purpose: TokenPurpose;
	/** Override for tests; `verify_email` defaults to the TTL constant. */
	ttlMs?: number;
	now?: Date;
}

export interface MintedToken {
	/** The plaintext, returned exactly once. Put it in the email and drop it. */
	token: string;
	row: ApplicationEmailToken;
}

/**
 * Mint one token inside the caller's `withTenant` transaction. The row's
 * `tenant_id` rides the RLS `WITH CHECK` via the pinned GUC, so a
 * cross-tenant mint is inexpressible — same property as the outbox enqueue.
 */
export async function mintToken(tx: DbTransaction, input: MintTokenInput): Promise<MintedToken> {
	const now = input.now ?? new Date();
	const ttlMs = input.ttlMs ?? (input.purpose === 'verify_email' ? VERIFY_EMAIL_TOKEN_TTL_MS : undefined);
	const token = generateToken();

	const tenantId = await currentTenant(tx);
	const rows = await tx
		.insert(applicationEmailToken)
		.values({
			tenantId,
			applicationId: input.applicationId,
			purpose: input.purpose,
			tokenHash: hashToken(token),
			expiresAt: ttlMs === undefined ? null : new Date(now.getTime() + ttlMs),
		})
		.returning();
	return { token, row: rows[0] };
}

/**
 * Consume a token: look it up BY HASH, decide with `assessTokenRow`, and mark
 * it consumed — one-way, enforced twice more below this function (the
 * column-level grant and the single-use trigger in migration 0007).
 *
 * `SELECT … FOR UPDATE` serialises concurrent replays of the same token: the
 * loser waits, re-reads a consumed row, and is refused — "single-use" holds
 * under the race, not just in sequence.
 */
export async function consumeToken(
	tx: DbTransaction,
	presented: string,
	expectedPurpose: TokenPurpose,
	now: Date = new Date(),
): Promise<ApplicationEmailToken> {
	const tenantId = await currentTenant(tx);
	const found = await tx
		.select()
		.from(applicationEmailToken)
		.where(and(eq(applicationEmailToken.tenantId, tenantId), eq(applicationEmailToken.tokenHash, hashToken(presented))))
		.for('update')
		.limit(1);

	const verdict = assessTokenRow(found[0], expectedPurpose, now);
	if (verdict !== 'valid') {
		throw new TokenRejectedError(verdict);
	}

	const updated = await tx
		.update(applicationEmailToken)
		.set({ consumedAt: now })
		.where(eq(applicationEmailToken.id, found[0].id))
		.returning();
	return updated[0];
}

/**
 * The GUC read, local to this module so tokens.ts never imports the pool.
 * Mirrors `currentTenantId` in db/tenant.ts; failing fast here keeps the
 * error at the mint/consume call site instead of a NULL-predicate RLS miss.
 */
async function currentTenant(tx: DbTransaction): Promise<string> {
	const result = await tx.execute<{ tenant_id: string | null }>(
		sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
	);
	const tenantId = result.rows[0]?.tenant_id;
	if (!tenantId) {
		throw new Error(
			'application tokens: this transaction has no app.tenant_id — mint/consume only inside withTenant(tenantId, fn).',
		);
	}
	return tenantId;
}

/** Deterministic random client key for callers that sent no Idempotency-Key. */
export function freshIdempotencyKey(): string {
	return randomUUID();
}
