/**
 * Sessions, passwords, and their revocation coupling (TIN-3817 slice S2).
 *
 * Every function here takes the TRANSACTION HANDLE `withTenant` produced,
 * first, and builds the storage adapter over it (`adapterFor`, Fix A). None
 * of them opens a transaction of its own — the caller owns the unit of work,
 * which is what lets a future slice commit a session change and a membership
 * change atomically.
 *
 * The load-bearing coupling in this file: `setPassword` ends with
 * `deleteUserSessions`. A password reset that leaves other sessions alive
 * hands an attacker who held one stolen session a way to survive the very
 * action a user takes to evict them. The integration suite proves it as spec
 * §1.4 requires: a second session 401s after the reset.
 *
 * What is deliberately NOT here:
 *   - TOTP and invitations — forbidden for Member v0 (spec §4). The pinned
 *     `@tummycrypt/tinyland-auth@0.3.3` still ships both, so the fence is
 *     app-level: eslint bans the imports, `fence.test.ts` scans the tree, and
 *     this module's export surface is asserted free of them. That fence is
 *     the safety mechanism, not the version pin (spec §0.7).
 *   - The token-carrying, email-delivered reset FLOW. Spec §4 makes the
 *     verification/reset flow app-owned; its tokens and mail ride the outbox
 *     (S3's) and the intake routes (S4's). S2 ships the spine primitive
 *     (`setPassword`) both flows will call.
 *   - A password POLICY. Copy and thresholds are not ratified; `setPassword`
 *     rejects only the mechanically indefensible (empty/whitespace). The
 *     member-facing policy lands with S6's activation flow.
 */

import {
	hashPassword,
	verifyPassword,
	type AdminUser,
	type Session,
	type SessionMetadata,
} from '@tummycrypt/tinyland-auth';
import type { TenantScoped } from '@tummycrypt/tinyland-auth-pg';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '$lib/server/db/client';
import { adapterFor, parseDbInstant, toUtcIso } from './adapter';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serialise credential operations on one user row (PR #175 review, the
 * reset-vs-login race). `authenticate`/`reauthenticate` verify a password
 * hash and then mint a session; `setPassword` rewrites the hash and then
 * revokes sessions. Without a lock those interleave under READ COMMITTED so
 * a login racing a reset can verify the OLD hash yet insert its session
 * AFTER the reset's revocation scan — a session the reset was performed to
 * kill, alive for its full TTL. `SELECT … FOR UPDATE` on the user row makes
 * the interleavings serial: the login either commits before the reset (and
 * its session is caught by the reset's DELETE) or waits and sees the new
 * hash (and refuses). RLS still applies — a cross-tenant caller locks
 * nothing and reads nothing.
 */
async function lockUserRow(
	tx: DbTransaction,
	tenantId: string,
	column: 'id' | 'handle',
	value: string,
): Promise<boolean> {
	const rows = await tx.execute(
		column === 'id'
			? sql`select id from "auth"."users" where tenant_id = ${tenantId} and id = ${value} for update`
			: sql`select id from "auth"."users" where tenant_id = ${tenantId} and handle = ${value.toLowerCase()} for update`,
	);
	return rows.rows.length > 0;
}

/** Cookie carrying the session id. HttpOnly/Secure/SameSite set at write time. */
export const SESSION_COOKIE = 'gftb_session';

/**
 * Runtime NAME of the configured tenant's id — the value is supplied by
 * `great-falls-tool-bus-infra`, like `DATABASE_URL` (ADR 0014 §0.2). TIN-3817
 * scopes Member v0 to one configured GFTB tenant; this is where that one
 * tenant is named to the running process.
 */
export const TENANT_ID_ENV = 'GFTB_TENANT_ID';

/** Tuning knob for tests; production uses the package default (bcrypt 12). */
export interface PasswordHashOptions {
	rounds?: number;
}

export interface NewUserInput {
	handle: string;
	email: string;
	displayName?: string;
	password: string;
}

export interface AuthenticateInput {
	handle: string;
	password: string;
	metadata?: SessionMetadata;
}

export type AuthUser = TenantScoped<AdminUser>;
export type AuthSession = TenantScoped<Session>;

/** 401-shaped refusal, thrown by the `require*` guards. */
export class AuthError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'AuthError';
		this.status = status;
		this.code = code;
	}
}

function assertUsablePassword(password: string): void {
	if (password.trim().length === 0) {
		throw new AuthError(400, 'password_unusable', 'Password must not be empty.');
	}
}

/**
 * Re-anchor a session's timestamps to UTC before it crosses this module's
 * boundary — see the naive-timestamp contract in ./adapter.ts. Every session
 * this module returns has been through here, so callers (the hook, the reauth
 * freshness math) may trust `createdAt`/`expiresAt` as real instants.
 */
export function normalizeSessionInstants(session: AuthSession): AuthSession {
	return {
		...session,
		createdAt: toUtcIso(session.createdAt),
		expires: toUtcIso(session.expires),
		expiresAt: toUtcIso(session.expiresAt),
	};
}

/**
 * Create a user with a bcrypt password hash.
 *
 * The package's positional `role` column is set to its own `'member'` value
 * and is INERT for the platform: no authorization decision in this repository
 * reads `AdminUser.role`. Platform roles are orthogonal grants in
 * `member_role_grant` (see `./roles.ts`), whose vocabulary is ratified
 * (decisions/0018, sitting #2 Item 2, 2026-08-21) but not yet encoded there
 * — a deliberate follow-up, not a ratification gap.
 */
export async function createUserWithPassword(
	tx: DbTransaction,
	tenantId: string,
	input: NewUserInput,
	hashOptions: PasswordHashOptions = {},
): Promise<AuthUser> {
	assertUsablePassword(input.password);
	const passwordHash = await hashPassword(input.password, hashOptions);
	return adapterFor(tx).createUser(tenantId, {
		handle: input.handle,
		email: input.email,
		displayName: input.displayName,
		passwordHash,
		role: 'member',
		totpEnabled: false,
		isActive: true,
		needsOnboarding: false,
		onboardingStep: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
}

/** Look a user up by handle; `null` (never an oracle) when absent. */
export async function getUserByHandle(tx: DbTransaction, tenantId: string, handle: string): Promise<AuthUser | null> {
	return adapterFor(tx).getUserByHandle(tenantId, handle);
}

/** Look a user up by id; `null` when absent — or when RLS filters it. */
export async function getUser(tx: DbTransaction, tenantId: string, userId: string): Promise<AuthUser | null> {
	return adapterFor(tx).getUser(tenantId, userId);
}

/**
 * A fixed bcrypt hash of an unguessable, never-issued string, generated
 * offline at the SAME cost factor `createUserWithPassword` uses when no
 * `hashOptions` override is passed (12 — `@tummycrypt/tinyland-auth`'s own
 * `DEFAULT_CONFIG.rounds`, `dist/core/security/password.js`). bcrypt's
 * compare cost is a function of that cost factor alone — not of the hash's
 * specific bytes, nor of the password being checked against it — so
 * comparing an unrecognized handle's password against THIS constant costs
 * the same wall-clock work as comparing a real member's password against
 * their real stored hash.
 *
 * THE BUG THIS CLOSES (PR #198 review, B1 — timing-based member-existence
 * oracle): before this constant existed, an unknown handle refused at `:198`
 * BEFORE `verifyPassword` ever ran, so its response was ~140-790x faster
 * than a known handle's wrong-password refusal (measured against real
 * PostgreSQL + production rounds: unknown ~4ms worst 26ms vs. known-wrong
 * ~450-3183ms). `/login` (TIN-3440 S12) is the first caller that can drive
 * this function with an attacker-chosen handle — the two pre-existing
 * callers (`activate.ts`'s `activateMembership`/`convergeReplay`) always
 * derive `handle` from an already-resolved row, never from wire input — so
 * S12 is what ARMS the oracle spec §6:311 ("Public endpoints are
 * rate-limited and return non-enumerating responses") forbids.
 *
 * Not a secret: nothing legitimate is ever checked against it, and rotating
 * it would not change what it proves, so it never rotates.
 *
 * Exported — `_`-prefixed seam convention (PR #198 review E2 precedent) —
 * so `session.test.ts` (`just check`'s DB-free unit lane) can pin its cost
 * factor to whatever `hashPassword`'s own default actually is, rather than
 * to the literal `12` this comment states. PR #198 round-2 review, ED-1: an
 * automated dependency bump that moves `@tummycrypt/tinyland-auth`'s
 * `DEFAULT_CONFIG.rounds` would silently re-arm the B1 oracle — this
 * constant would still be well-formed and still be compared against on
 * every unresolved-handle call, but at the WRONG cost, which is a perfect
 * oracle, not a closed one. Nothing before this export caught that: the
 * only guard on the fix lived in `login.integration.test.ts`, which is not
 * in the unit lane and asserts wall-clock comparability, not cost-factor
 * equality — a one-cost-step-cheaper dummy still passes that test (review
 * measured AUC 0.000, fully separable, with the shipped test green).
 */
export const _DUMMY_PASSWORD_HASH = '$2a$12$.i5wCCtre0Zn/Z.Ne8Ujle.QUg3vv/sC3xPQ0wOBGbywGc62I3lDG';

/**
 * Verify a password and open a session. The same `AuthError` for an unknown
 * handle and a wrong password, so the failure is not an existence oracle
 * (spec §6's non-enumeration rule, applied one layer down) — and, as of the
 * B1 fix above, not a TIMING oracle either: the bcrypt compare below always
 * runs, against the real hash when `user` resolves and against the fixed
 * `_DUMMY_PASSWORD_HASH` when it does not, so the expensive step that
 * dominates this function's wall-clock cost is paid on every call. This is
 * additive and behavior-preserving for both existing callers: neither can
 * ever present a handle that fails to resolve, so `targetHash` is always
 * `user.passwordHash` for them, exactly as before.
 */
export async function authenticate(
	tx: DbTransaction,
	tenantId: string,
	input: AuthenticateInput,
): Promise<{ user: AuthUser; session: AuthSession }> {
	const adapter = adapterFor(tx);
	// Lock first: a concurrent setPassword now either completes before this
	// read (we see the new hash and refuse) or waits until this transaction —
	// session insert included — commits, so its revocation sweep catches the
	// session we are about to mint. See lockUserRow.
	await lockUserRow(tx, tenantId, 'handle', input.handle);
	const user = await adapter.getUserByHandle(tenantId, input.handle);
	const refusal = new AuthError(401, 'bad_credentials', 'Unknown handle or wrong password.');
	// ALWAYS compare, known handle or not (B1): this decides WHICH hash to
	// compare against, never WHETHER to compare. Re-tested (not reused via a
	// stored boolean) in the guard below on purpose — a separate `usable`
	// variable would sever TypeScript's narrowing of `user` for the rest of
	// this function, the exact bug class B1's own fix must not introduce.
	const targetHash = user && user.isActive ? user.passwordHash : _DUMMY_PASSWORD_HASH;
	const ok = await verifyPassword(input.password, targetHash);
	if (!user || !user.isActive || !ok) throw refusal;
	const session = await adapter.createSession(tenantId, user.id, user, input.metadata);
	return { user, session: normalizeSessionInstants(session) };
}

/**
 * Resolve a session id to a live session, or `null`.
 *
 * Expiry is enforced HERE, against the UTC-normalized `expiresAt`, in
 * addition to the adapter's internal check — the adapter parses the naive
 * column in local time (./adapter.ts), so on a non-UTC process its own check
 * can run hours late. Ours cannot.
 */
export async function validateSession(
	tx: DbTransaction,
	tenantId: string,
	sessionId: string,
): Promise<AuthSession | null> {
	// A cookie is attacker-controlled text. A non-UUID id must be an ordinary
	// `null` — not a DatabaseError from the uuid cast, which would 500 the
	// route AND abort the transaction the caller is sharing with its action
	// (PR #175 review, LOW-MEDIUM). Same precedent as assertTenantId, inverted:
	// tenant ids are trusted config and fail fast; session ids are wire input
	// and fail soft.
	if (!UUID_RE.test(sessionId)) return null;
	const adapter = adapterFor(tx);
	const session = await adapter.getSession(tenantId, sessionId);
	if (!session) return null;
	const normalized = normalizeSessionInstants(session);
	const expiry = parseDbInstant(normalized.expiresAt).getTime();
	// FAIL CLOSED on an unparseable expiry (PR #175 review, MEDIUM): NaN
	// compares false against everything, so `NaN <= now` alone would mean
	// "never expires" — under a role/DSN DateStyle like 'SQL, DMY' a session
	// expired ten years ago would validate. Unparseable ⇒ treated as not
	// live. Deliberately WITHOUT the delete: destroying rows because a
	// session-level setting confused a parser would let a config slip erase
	// every session; refusing to honor them is closed enough, and the pool
	// pins DateStyle=ISO as defence in depth (db/client.ts).
	if (Number.isNaN(expiry)) return null;
	if (expiry <= Date.now()) {
		await adapter.deleteSession(tenantId, sessionId);
		return null;
	}
	return normalized;
}

/** The guard a protected route calls: a live session or a thrown 401. */
export async function requireSession(
	tx: DbTransaction,
	tenantId: string,
	sessionId: string | undefined,
): Promise<AuthSession> {
	const session = sessionId ? await validateSession(tx, tenantId, sessionId) : null;
	if (!session) {
		throw new AuthError(401, 'no_session', 'Not authenticated.');
	}
	return session;
}

/** Revoke one session (logout). Idempotent: revoking the absent is false, not an error. */
export async function revokeSession(tx: DbTransaction, tenantId: string, sessionId: string): Promise<boolean> {
	return adapterFor(tx).deleteSession(tenantId, sessionId);
}

/** Revoke every session a user holds. Returns the count. */
export async function revokeAllSessions(tx: DbTransaction, tenantId: string, userId: string): Promise<number> {
	return adapterFor(tx).deleteUserSessions(tenantId, userId);
}

/**
 * Set (or reset) a password, then revoke EVERY session the user holds —
 * including the one that asked, when it exists. One unit of work: if the
 * revocation fails, the transaction rolls the new hash back too, so there is
 * no state where the password changed and stale sessions survived.
 */
export async function setPassword(
	tx: DbTransaction,
	tenantId: string,
	userId: string,
	newPassword: string,
	hashOptions: PasswordHashOptions = {},
): Promise<{ user: AuthUser; revokedSessions: number }> {
	assertUsablePassword(newPassword);
	const adapter = adapterFor(tx);
	// Lock + existence check in one step. Absent (or RLS-filtered — a
	// cross-tenant id reads identically, on purpose) refuses with an
	// AuthError that does NOT echo the id, instead of the package's bare
	// `Error: User <uuid> not found` (PR #175 review nit).
	const exists = await lockUserRow(tx, tenantId, 'id', userId);
	if (!exists) {
		throw new AuthError(400, 'unknown_user', 'No such user in this tenant.');
	}
	const passwordHash = await hashPassword(newPassword, hashOptions);
	const user = await adapter.updateUser(tenantId, userId, {
		passwordHash,
		passwordChangedAt: new Date().toISOString(),
	});
	const revokedSessions = await adapter.deleteUserSessions(tenantId, userId);
	return { user, revokedSessions };
}
