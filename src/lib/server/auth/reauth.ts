/**
 * Fresh reauthentication for sensitive actions (TIN-3817 slice S2; TIN-3440
 * "Sensitive keyholder actions require fresh password reauthentication").
 *
 * MECHANISM: SESSION ROTATION, NOT A STORED TIMESTAMP. The pinned adapter's
 * `auth.sessions` row has no reauthenticated-at column, and S2's fence does
 * not include inventing one (schema.ts may gain "auth-adapter tables +
 * `member_role_grant` only"). So reauthentication verifies the password and
 * ROTATES the session — deletes the presented one, issues a fresh one — and
 * freshness is simply the session row's own `createdAt` being inside the
 * window. Two properties fall out for free:
 *
 *   1. The freshness fact lives in the same durable row the session does; it
 *      cannot desynchronise from it, and revoking the session revokes the
 *      freshness with it.
 *   2. Rotation on password re-entry is itself good hygiene: a session id
 *      that leaked before the sensitive action is dead after it.
 *
 * ASSUMPTION — the window. Neither ADR 0014, the system spec, nor TIN-3440
 * names a duration. 5 minutes here, as a named constant with an injectable
 * override, on the same footing as the outbox's max_attempts=8: a
 * schedule-shaped assumption recorded for sitting #2, cheap to change,
 * resolver Jess. It is NOT ratified by this file.
 */

import { verifyPassword, type SessionMetadata } from '@tummycrypt/tinyland-auth';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '$lib/server/db/client';
import { adapterFor, tryParseDbInstant } from './adapter';
import { AuthError, normalizeSessionInstants, type AuthSession } from './session';

/** ASSUMPTION (sitting #2): how recently created a session must be to count as fresh. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export interface ReauthOptions {
	/** Override the freshness window (tests; a future ratified value). */
	windowMs?: number;
	/** Override "now" (tests). Production never passes it. */
	now?: Date;
}

/**
 * Pure check: was this session created inside the freshness window? Stale is
 * an ordinary state, not an error — the caller decides whether to demand
 * rotation.
 */
export function isFreshlyAuthenticated(session: AuthSession, options: ReauthOptions = {}): boolean {
	const windowMs = options.windowMs ?? REAUTH_WINDOW_MS;
	const now = options.now ?? new Date();
	// A zoneless createdAt is a UTC instant (./adapter.ts). Discriminated
	// result (TIN-4217, same discipline as validateSession's fix): "could not
	// trust this value" is a distinct state from "parsed to some instant",
	// so an untrusted createdAt cannot silently participate in the age
	// arithmetic below — it fails closed toward requiring reauth, never
	// toward granting it.
	const parsed = tryParseDbInstant(session.createdAt);
	if (!parsed.ok) return false;
	const age = now.getTime() - parsed.instant.getTime();
	return age >= 0 && age <= windowMs;
}

/**
 * The guard a sensitive action calls AFTER `requireSession`: the session must
 * be not merely valid but fresh. A stale-but-valid session is refused with
 * 401 `reauth_required` — the signal to the caller to send the user through
 * `reauthenticate` and retry with the rotated session.
 */
export function requireFreshReauth(session: AuthSession, options: ReauthOptions = {}): AuthSession {
	if (!isFreshlyAuthenticated(session, options)) {
		throw new AuthError(401, 'reauth_required', 'This action requires fresh password reauthentication.');
	}
	return session;
}

/**
 * Verify the password of the user behind `session` and rotate it. Returns the
 * fresh session; the presented one is dead once this commits. A wrong
 * password refuses WITHOUT rotating, so an attacker holding a stolen session
 * id cannot use failed reauth attempts to log the real user out.
 *
 * ROTATION REQUIRES A LIVE SESSION (PR #175 review: a revoked session object
 * must not be tradeable for a live one). Reauth is inherently a two-request
 * flow — 401 `reauth_required`, then a POST carrying the password — so "the
 * caller validated it earlier" is a cross-request assumption this function
 * cannot inherit. `deleteSession`'s boolean is the liveness check: deleting
 * the already-dead reports false, and false means 401, not a fresh session.
 */
export async function reauthenticate(
	tx: DbTransaction,
	tenantId: string,
	session: AuthSession,
	password: string,
	metadata?: SessionMetadata,
): Promise<AuthSession> {
	const adapter = adapterFor(tx);
	// Serialise against setPassword the same way authenticate does — a reauth
	// racing a reset must either see the new hash (refuse) or commit before
	// the reset's revocation sweep (be revoked by it). See lockUserRow in
	// ./session.
	await tx.execute(
		sql`select id from "auth"."users" where tenant_id = ${tenantId} and id = ${session.userId} for update`,
	);
	const user = await adapter.getUser(tenantId, session.userId);
	if (!user || !user.isActive) {
		throw new AuthError(401, 'no_session', 'Not authenticated.');
	}
	const ok = await verifyPassword(password, user.passwordHash);
	if (!ok) {
		throw new AuthError(401, 'bad_credentials', 'Wrong password.');
	}
	const wasLive = await adapter.deleteSession(tenantId, session.id);
	if (!wasLive) {
		throw new AuthError(401, 'no_session', 'Not authenticated.');
	}
	return normalizeSessionInstants(await adapter.createSession(tenantId, user.id, user, metadata));
}
