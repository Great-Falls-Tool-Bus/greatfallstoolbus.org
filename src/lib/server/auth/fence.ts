/**
 * The fence manifest (TIN-3817 slice S2, rebuilt after adversarial review on
 * PR #175 @ 08a9d3d).
 *
 * The review proved the original fence bound PACKAGE-EXPORT names while the
 * actually reachable path to the forbidden tables was the ADAPTER'S METHOD
 * surface: one in-door file calling `adapterFor(tx).getPendingInvitations()`
 * and re-exporting through index.ts passed every gate green. This module is
 * the correction: ONE committed manifest naming (a) the adapter methods that
 * are forbidden, (b) the package exports that are forbidden, (c) the package
 * subpaths that are forbidden, and (d) the door's COMPLETE export allow-list
 * — consumed by all four enforcement layers so they cannot drift apart:
 *
 *   1. runtime  — adapter.ts wraps every adapter in a Proxy that throws on
 *                 any name in FORBIDDEN_ADAPTER_METHODS (string/dynamic
 *                 access included, which no static layer can see);
 *   2. types    — adapter.ts returns Omit<PgStorageAdapter, forbidden>, so
 *                 a call site fails `just typecheck`;
 *   3. lint     — eslint.config.ts bans the imports (static AND dynamic
 *                 `import()`) by these same names;
 *   4. tests    — fence.test.ts runs `scanFenceViolations` over the tree,
 *                 asserts the door's exports EQUAL the allow-list, and feeds
 *                 the reviewer's exact bypass (fence-bypass.fixture.txt) to
 *                 the scanner as a negative fixture that MUST be flagged.
 *
 * THE ONE SANCTIONED EXEMPTION: this file and fence.test.ts name the
 * forbidden identifiers in code (a denylist must), so the tree scan skips
 * exactly these two files (SCAN_EXEMPT). Anything smuggled in here would
 * still hit layers 1, 2 and the allow-list — an exemption from the scanner
 * is not an exemption from the fence.
 */

/**
 * Adapter methods that reach the TOTP, backup-code, and invitation tables
 * spec §4 forbids for Member v0 (names verified against
 * `@tummycrypt/tinyland-auth-pg@0.2.4` `dist/adapter.d.ts`).
 */
export const FORBIDDEN_ADAPTER_METHODS = [
	// TOTP
	'getTOTPSecret',
	'saveTOTPSecret',
	'deleteTOTPSecret',
	// backup codes
	'getBackupCodes',
	'saveBackupCodes',
	'deleteBackupCodes',
	// invitations
	'getInvitation',
	'getInvitationById',
	'getAllInvitations',
	'getPendingInvitations',
	'createInvitation',
	'updateInvitation',
	'deleteInvitation',
	'cleanupExpiredInvitations',
] as const;

export type ForbiddenAdapterMethod = (typeof FORBIDDEN_ADAPTER_METHODS)[number];

/**
 * Package exports that must never be named in application code. The first
 * block is `@tummycrypt/tinyland-auth`'s TOTP/invitation/bootstrap surface;
 * the second is `@tummycrypt/tinyland-auth-pg`'s pool-owning constructors
 * (the exact §1.3 B3 hazard — an adapter owning its own pool never sees the
 * GUC) and its bootstrap helper, both missed by the original fence.
 */
export const FORBIDDEN_PACKAGE_IDENTIFIERS = [
	'TOTPService',
	'createTOTPService',
	'InvitationService',
	'createInvitationService',
	'BootstrapService',
	'createBootstrapService',
	'generateTOTPSecret',
	'generateTOTPUri',
	'generateTOTPQRCode',
	'generateTOTPToken',
	'getTOTPTimeRemaining',
	'generateTempPassword',
	'generateBackupCodes',
	'createBackupCodeSet',
	'verifyBackupCode',
	// @tummycrypt/tinyland-auth-pg
	'createNodePgStorageAdapter',
	'NodePgStorageAdapter',
	'bootstrapUsers',
] as const;

/** Package subpaths banned outright, inside the door included. */
export const FORBIDDEN_SUBPATHS = [
	'@tummycrypt/tinyland-auth/totp',
	'@tummycrypt/tinyland-auth/cred-gen',
	'@tummycrypt/tinyland-auth-pg/bootstrap-users',
] as const;

/**
 * The door's complete RUNTIME export surface. fence.test.ts asserts
 * `Object.keys(index)` equals this EXACTLY — an allow-list, per the review:
 * a new export fails the suite until it is added here deliberately, instead
 * of a deny-list chasing names it did not think of.
 */
export const DOOR_EXPORT_ALLOWLIST = [
	'AuthError',
	'REAUTH_WINDOW_MS',
	'SESSION_COOKIE',
	'SESSION_TTL_MS',
	'TENANT_ID_ENV',
	'activeRoles',
	'authenticate',
	'createUserWithPassword',
	'getUser',
	'getUserByHandle',
	'grantRole',
	'hasRole',
	'isFreshlyAuthenticated',
	'reauthenticate',
	'requireFreshReauth',
	'requireSession',
	'revokeAllSessions',
	'revokeRole',
	'revokeSession',
	'setPassword',
	'validateSession',
] as const;

/** Files the tree scan skips — the manifest and its test, nothing else. */
export const SCAN_EXEMPT = ['src/lib/server/auth/fence.ts', 'src/lib/server/auth/fence.test.ts'] as const;

const AUTH_DOOR_PREFIX = 'src/lib/server/auth/';

/**
 * Strip comments so prose may NAME the forbidden things (that is how a fence
 * documents itself) while code may not. Import specifiers never live in
 * comments, so nothing is lost.
 */
export function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The scanner all fence tests share — pure, so the committed bypass fixture
 * runs through the SAME code path as the real tree. `rel` is the repo-root-
 * relative path (forward slashes); `text` the raw file contents.
 *
 * What it flags:
 *   - outside the door: ANY occurrence of an auth-package specifier (static
 *     or dynamic import — the string is the same), and any deep import into
 *     the door's internals;
 *   - everywhere (door included): forbidden package identifiers, forbidden
 *     subpaths, and — the review's HIGH — forbidden ADAPTER METHOD names,
 *     which is what catches a call site like `adapter.getPendingInvitations(`.
 */
export function scanFenceViolations(rel: string, text: string): string[] {
	const offenders: string[] = [];
	const code = stripComments(text);
	const inDoor = rel.startsWith(AUTH_DOOR_PREFIX);

	if (!inDoor) {
		if (/['"]@tummycrypt\/tinyland-auth(-pg)?(\/|['"])/.test(code)) {
			offenders.push(`${rel}: auth package imported outside the door`);
		}
		if (/['"][^'"]*server\/auth\/(adapter|fence|session|reauth|roles)['"]/.test(code)) {
			offenders.push(`${rel}: door-internal module imported outside the door`);
		}
	}

	for (const identifier of [...FORBIDDEN_PACKAGE_IDENTIFIERS, ...FORBIDDEN_ADAPTER_METHODS]) {
		if (new RegExp(`\\b${identifier}\\b`).test(code)) {
			offenders.push(`${rel}: ${identifier}`);
		}
	}
	for (const subpath of FORBIDDEN_SUBPATHS) {
		if (code.includes(subpath)) {
			offenders.push(`${rel}: ${subpath}`);
		}
	}
	return offenders;
}
