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
import type { DbTransaction } from '$lib/server/db/client';
import { adapterFor, parseDbInstant, toUtcIso } from './adapter';

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
 * `member_role_grant` (see `./roles.ts`), whose vocabulary is pending
 * ratification at sitting #2 Item 2.
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
 * Verify a password and open a session. The same `AuthError` for an unknown
 * handle and a wrong password, so the failure is not an existence oracle
 * (spec §6's non-enumeration rule, applied one layer down).
 */
export async function authenticate(
	tx: DbTransaction,
	tenantId: string,
	input: AuthenticateInput,
): Promise<{ user: AuthUser; session: AuthSession }> {
	const adapter = adapterFor(tx);
	const user = await adapter.getUserByHandle(tenantId, input.handle);
	const refusal = new AuthError(401, 'bad_credentials', 'Unknown handle or wrong password.');
	if (!user || !user.isActive) throw refusal;
	const ok = await verifyPassword(input.password, user.passwordHash);
	if (!ok) throw refusal;
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
	const adapter = adapterFor(tx);
	const session = await adapter.getSession(tenantId, sessionId);
	if (!session) return null;
	const normalized = normalizeSessionInstants(session);
	if (parseDbInstant(normalized.expiresAt).getTime() <= Date.now()) {
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
	const passwordHash = await hashPassword(newPassword, hashOptions);
	const user = await adapter.updateUser(tenantId, userId, {
		passwordHash,
		passwordChangedAt: new Date().toISOString(),
	});
	const revokedSessions = await adapter.deleteUserSessions(tenantId, userId);
	return { user, revokedSessions };
}
