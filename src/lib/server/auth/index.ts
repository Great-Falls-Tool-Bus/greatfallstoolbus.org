/**
 * The auth spine's single door (TIN-3817 slice S2).
 *
 * Application code imports auth from HERE and nowhere else — importing
 * `@tummycrypt/tinyland-auth`, `@tummycrypt/tinyland-auth-pg`, or the
 * internal `./adapter` seam outside `src/lib/server/auth/**` is an ESLint
 * error, and `fence.test.ts` re-asserts it by scanning the tree.
 *
 * WHAT THIS SURFACE DELIBERATELY WITHHOLDS (spec §4, §0.7): the pinned
 * `@tummycrypt/tinyland-auth@0.3.3` still ships TOTP and the ungated,
 * fail-open `InvitationService` that later package versions removed, and the
 * adapter carries their tables and methods either way. None of that is
 * re-exported — no TOTP, no invitations, no backup codes, no raw adapter, no
 * bootstrap service. The version pin is not the safety mechanism; this fence
 * is, which is why `fence.test.ts` asserts the export surface itself.
 *
 * Everything here takes the transaction handle from `withTenant(tenantId, fn)`
 * — see `src/lib/server/db/tenant.ts` for why the GUC and the adapter must
 * share a connection (spec §1.3 B3, Fix A).
 */

export {
	AuthError,
	SESSION_COOKIE,
	TENANT_ID_ENV,
	authenticate,
	createUserWithPassword,
	getUser,
	getUserByHandle,
	reapExpiredSessions,
	requireSession,
	revokeAllSessions,
	revokeSession,
	setPassword,
	validateSession,
	type AuthSession,
	type AuthUser,
	type AuthenticateInput,
	type NewUserInput,
	type PasswordHashOptions,
	type ReapExpiredSessionsOptions,
	type ReapExpiredSessionsResult,
} from './session';

// The one package TYPE the door re-exports (S6): session metadata for the
// activation flow's session mint. A type-only alias — no runtime surface.
export type { SessionMetadata } from '@tummycrypt/tinyland-auth';

export {
	REAUTH_WINDOW_MS,
	isFreshlyAuthenticated,
	reauthenticate,
	requireFreshReauth,
	type ReauthOptions,
} from './reauth';

export { activeRoles, grantRole, hasRole, revokeRole, type GrantInput } from './roles';

export { SESSION_TTL_MS } from './adapter';
