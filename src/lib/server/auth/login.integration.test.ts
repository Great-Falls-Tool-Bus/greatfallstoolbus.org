/**
 * `/login` and `/logout` integration rows (TIN-3440 slice S12; sitting-2 QA
 * gap closure, register L70). Same S1/S2/S6/S7 fixture discipline as the
 * rest of the stack: real migrator run, real `gftb_migrator`/`gftb_app` role
 * split, FORCE RLS — every assertion below executes through `withTenant` as
 * `gftb_app`, exactly as production will.
 *
 * Rows cover the S12 security-property list verbatim:
 *   - no enumeration oracle (identical refusal for unknown identifier and
 *     wrong password, byte-compared);
 *   - the rate limiter bites, one constant body regardless of identifier;
 *   - a fresh session id on every successful login (no fixation — an
 *     attacker-supplied cookie is never adopted);
 *   - logout invalidates the session server-side;
 *   - `/login`'s load redirects an already-authed visitor to `/home`;
 *   - `paused` logs in (slices §1.9 acceptance, quoting TIN-3440: "Pause
 *     blocks new borrowing but preserves login, mail, and discussion
 *     access"; slices §2.2 row 11: "session stays valid" — NOT `decisions/
 *     0019`'s RA-2, which rules on pause's list/mailbox/archive projection
 *     effects, a different question; PR #198 review N1); `left`/`removed`
 *     do not (ADR 0014 §4 / slices §2.3 invariant 3);
 *   - B1 fix (PR #198 review): the unknown-handle path in `authenticate()`
 *     now runs a real bcrypt compare against a fixed dummy hash, closing the
 *     member-existence timing oracle S12 armed.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, schema, type Db } from '$lib/server/db/client';
import { withTenant } from '$lib/server/db/tenant';
import {
	MIGRATIONS_DIR,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '$lib/server/db/integration-support';
import { runMigrator } from '$lib/server/db/migrate';
import { grantRole } from '$lib/server/auth/roles';
import { validateSession } from '$lib/server/auth';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '$lib/server/application/claim';
import { submitApplication, validateSubmission, verifyEmail } from '$lib/server/application/intake';
import { mintToken } from '$lib/server/application/tokens';
import {
	activateMembership,
	mintActivationToken,
	provisionOnApproval,
	type ActivationResult,
} from '$lib/server/membership/activate';
import { publishAgreementVersion } from '$lib/server/membership/agreement';
import {
	leaveMembership,
	pauseMembership,
	removeMembership,
	type MembershipStatus,
} from '$lib/server/membership/transition';
import { createRateLimiter } from '$lib/server/application/ratelimit';
import { _createLoginAction, _createLoginLoad } from '../../../routes/login/+page.server';
import { _createLogoutAction } from '../../../routes/logout/+page.server';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;
let tenantId: string;
let keyholder: string;
let agreementId: number;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
const FAST_HASH = { rounds: 4 };
const PASSWORD = 'a-long-fixture-password';

beforeAll(async () => {
	fixture = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', fixture.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(fixture);
	pool = new pg.Pool({ connectionString: fixture.runtimeDsn, max: 8 });
	db = drizzle(pool, { schema });
	previousDatabaseUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = fixture.runtimeDsn;

	tenantId = await seedTenant(fixture.migratorDsn, `s12-${randomUUID().slice(0, 8)}`);
	keyholder = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	agreementId = (await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'Fixture agreement.' }), db))
		.id;
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	await pool?.end();
	await fixture?.stop();
});

function submission() {
	return validateSubmission({
		displayName: 'Sam Member',
		email: `login-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'sewing',
		tourAvailability: 'weekday mornings',
		disclosures: 'none',
		ageAttested: true,
	});
}

/** Pipeline to a provisioned (pending_assent) membership — S5/S6/S7 precedent. */
async function provisioned() {
	const submitted = await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
	const minted = await withTenant(
		tenantId,
		(tx) => mintToken(tx, { applicationId: submitted.application.id, purpose: 'verify_email' }),
		db,
	);
	await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
	await withTenant(
		tenantId,
		(tx) => claimApplication(tx, { applicationId: submitted.application.id, keyholderPersonId: keyholder }),
		db,
	);
	await withTenant(
		tenantId,
		(tx) => scheduleTour(tx, { applicationId: submitted.application.id, keyholderPersonId: keyholder }),
		db,
	);
	return withTenant(
		tenantId,
		(tx) => provisionOnApproval(tx, { applicationId: submitted.application.id, keyholderPersonId: keyholder }),
		db,
	);
}

/**
 * `hashOptions` defaults to `FAST_HASH` (every pre-existing caller's
 * behavior, unchanged) — the B1 timing test below is the one caller that
 * passes `{}` for real production rounds (12), because that test's whole
 * point is the bcrypt cost `FAST_HASH` would otherwise hide.
 */
async function activate(
	applicationId: string,
	hashOptions: { rounds?: number } = FAST_HASH,
): Promise<ActivationResult> {
	const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, applicationId), db);
	return withTenant(
		tenantId,
		(tx) =>
			activateMembership(tx, {
				token: minted.token,
				password: PASSWORD,
				agreementVersionId: agreementId,
				hashOptions,
			}),
		db,
	);
}

interface Scenario {
	email: string;
	membershipId: string;
	personId: string;
	sessionId: string;
	authUserId: string;
	version: number;
}

/** Live `auth.sessions` row count for one user — the structural half of the
 *  "refused login leaves no session behind" proof (RLS-visible via the
 *  runtime DSN with the tenant GUC explicitly set, the lifecycle.integration
 *  test's own `membershipRow`/`offboardJobs` precedent). */
async function liveSessionCount(userId: string): Promise<number> {
	const client = new pg.Client({ connectionString: fixture.runtimeDsn });
	await client.connect();
	try {
		await client.query('select set_config($1, $2, false)', ['app.tenant_id', tenantId]);
		const { rows } = await client.query<{ count: string }>(
			'select count(*)::int as count from auth.sessions where user_id = $1',
			[userId],
		);
		return Number(rows[0].count);
	} finally {
		await client.end();
	}
}

/** Build an activated member standing in exactly `state` (lifecycle.integration.test.ts's `inState` precedent, reimplemented here for tenant isolation between the two suites). */
async function memberInState(state: MembershipStatus): Promise<Scenario> {
	const prov = await provisioned();
	const activated = await activate(prov.application.id);
	let version = activated.membership.version;
	if (state === 'paused') {
		const r = await withTenant(
			tenantId,
			(tx) =>
				pauseMembership(tx, { membershipId: prov.membership.id, actor: { personId: prov.person.id, via: 'member' } }),
			db,
		);
		version = r.membership.version;
	} else if (state === 'left') {
		const r = await withTenant(
			tenantId,
			(tx) =>
				leaveMembership(tx, {
					membershipId: prov.membership.id,
					memberPersonId: prov.person.id,
					expectedVersion: version,
				}),
			db,
		);
		version = r.membership.version;
	} else if (state === 'removed') {
		const r = await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: prov.membership.id,
					keyholderPersonId: keyholder,
					reasonClass: 'fixture_removal',
					reauthAt: new Date(),
					expectedVersion: version,
				}),
			db,
		);
		version = r.membership.version;
	}
	return {
		email: prov.application.email,
		membershipId: prov.membership.id,
		personId: prov.person.id,
		sessionId: activated.session.id,
		authUserId: activated.session.userId,
		version,
	};
}

function loginEvent(fields: Record<string, string>, opts: { clientAddress?: string; presentedCookie?: string } = {}) {
	const setCookies: unknown[] = [];
	return {
		event: {
			request: new Request('http://localhost/login', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams(fields),
			}),
			getClientAddress: () => opts.clientAddress ?? '203.0.113.9',
			cookies: {
				set: (...a: unknown[]) => setCookies.push(a),
				get: () => opts.presentedCookie,
			},
			locals: { authSession: null },
		} as unknown as Parameters<ReturnType<typeof _createLoginAction>>[0],
		setCookies,
	};
}

const loginSeams = (limiter = createRateLimiter({ max: 100, windowMs: 60_000 })) => ({
	env: { ...process.env, GFTB_TENANT_ID: tenantId },
	limiter,
});

describe('/login — no enumeration oracle (S12 acceptance)', () => {
	it('an unknown identifier and a wrong password get the BYTE-IDENTICAL refusal (copy + status)', async () => {
		const s = await memberInState('active');
		const action = _createLoginAction(loginSeams());

		const unknown = await action(
			loginEvent({ identifier: `nobody-${randomUUID()}@example.org`, password: 'whatever-not-real' }).event,
		);
		const wrong = await action(loginEvent({ identifier: s.email, password: 'definitely-the-wrong-password' }).event);

		for (const refused of [unknown, wrong]) {
			expect(refused).toHaveProperty('status', 401);
			expect(refused).toHaveProperty('data', { code: 'bad_credentials' });
		}
		expect(JSON.stringify(unknown)).toBe(JSON.stringify(wrong));
	});

	it('missing fields refuse 400 before any credential check runs (never bad_credentials for empty input)', async () => {
		const action = _createLoginAction(loginSeams());
		const missingPassword = await action(loginEvent({ identifier: 'someone@example.org', password: '' }).event);
		expect(missingPassword).toHaveProperty('status', 400);
		expect(missingPassword).toHaveProperty('data', { code: 'invalid' });
	});

	/**
	 * B1 (PR #198 review): before this fix, `authenticate()` returned after
	 * two cheap queries for an unknown handle, never reaching `verifyPassword`
	 * — so an unknown identifier answered in single-digit milliseconds while a
	 * known member's wrong-password refusal paid the full bcrypt compare
	 * (measured against real PG at production rounds=12: unknown median
	 * 4.0ms/worst 26.3ms vs known-wrong median 3183ms/best 426.8ms — bodies
	 * identical, but ONE request classified one address). The fix
	 * (`session.ts`'s `DUMMY_PASSWORD_HASH`) makes `authenticate()` run a real
	 * bcrypt compare on EVERY call, known handle or not.
	 *
	 * This member is activated WITHOUT `FAST_HASH` — deliberately, at the
	 * package's real production rounds (12) — because the property under test
	 * IS the bcrypt cost; a rounds=4 fixture would hide exactly the gap this
	 * test exists to close. Generous 30s timeout for the two real compares.
	 */
	it('an unknown identifier costs comparable wall-clock time to a known member wrong-password refusal (production bcrypt rounds)', async () => {
		const prov = await provisioned();
		await activate(prov.application.id, {}); // {} = package default = rounds 12, not FAST_HASH
		const action = _createLoginAction(loginSeams());

		const timed = async (fields: Record<string, string>) => {
			const start = performance.now();
			const result = await action(loginEvent(fields).event);
			return { ms: performance.now() - start, result };
		};

		const unknown = await timed({ identifier: `nobody-${randomUUID()}@example.org`, password: 'whatever-not-real' });
		const wrong = await timed({ identifier: prov.application.email, password: 'definitely-the-wrong-password' });

		expect(unknown.result).toHaveProperty('status', 401);
		expect(wrong.result).toHaveProperty('status', 401);
		expect(JSON.stringify(unknown.result)).toBe(JSON.stringify(wrong.result));

		// Before the fix this ratio was ~0.001-0.06 (the ~140-790x gap the
		// review measured). A generous >=0.5x floor survives ordinary
		// system-load jitter on both real bcrypt-12 compares while being
		// flatly impossible for code that skips the compare on one side.
		expect(unknown.ms).toBeGreaterThan(wrong.ms * 0.5);
	}, 30_000);
});

describe('/login — rate limited, one constant body (S12 acceptance)', () => {
	it('exceeding the limit 429s identically whether or not the identifier is known', async () => {
		const s = await memberInState('active');
		const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
		const action = _createLoginAction(loginSeams(limiter));
		const clientAddress = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

		// Two attempts consume the budget (one wrong password, one correct —
		// the limiter counts attempts, not outcomes).
		await action(loginEvent({ identifier: s.email, password: 'nope' }, { clientAddress }).event);
		await action(loginEvent({ identifier: s.email, password: 'nope-again' }, { clientAddress }).event);

		const deniedKnown = await action(loginEvent({ identifier: s.email, password: PASSWORD }, { clientAddress }).event);
		const deniedFresh = await action(
			loginEvent({ identifier: `fresh-${randomUUID()}@example.org`, password: 'x' }, { clientAddress }).event,
		);

		for (const denied of [deniedKnown, deniedFresh]) {
			expect(denied).toHaveProperty('status', 429);
			expect(denied).toHaveProperty('data', { code: 'rate_limited' });
		}
		expect(JSON.stringify(deniedKnown)).toBe(JSON.stringify(deniedFresh));
	});
});

describe('/login — session establishment (reused from S2/S6, not forked)', () => {
	it('a correct login mints a FRESH session id, never adopting an attacker-supplied cookie (no fixation)', async () => {
		const s = await memberInState('active');
		const action = _createLoginAction(loginSeams());
		const attackerSuppliedCookie = randomUUID();

		const { event, setCookies } = loginEvent(
			{ identifier: s.email, password: PASSWORD },
			{ presentedCookie: attackerSuppliedCookie },
		);
		const outcome = await action(event).catch((e) => e);

		expect(isRedirect(outcome)).toBe(true);
		expect((outcome as { location: string }).location).toBe('/home');
		expect(setCookies).toHaveLength(1);
		const [cookieName, mintedSessionId, cookieOpts] = setCookies[0] as [string, string, Record<string, unknown>];
		expect(cookieName).toBe('gftb_session');
		expect(mintedSessionId).not.toBe(attackerSuppliedCookie);
		expect(mintedSessionId).not.toBe(s.sessionId); // fresh, not the activation-minted session either
		expect(cookieOpts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });

		// The minted id is a real, live session.
		const live = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, mintedSessionId), db);
		expect(live).not.toBeNull();
	});

	it('login redirects to /home on success', async () => {
		const s = await memberInState('active');
		const action = _createLoginAction(loginSeams());
		const outcome = await action(loginEvent({ identifier: s.email, password: PASSWORD }).event).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
		expect((outcome as { status: number; location: string }).status).toBe(303);
		expect((outcome as { status: number; location: string }).location).toBe('/home');
	});
});

describe('/login — the load redirects an already-authed visitor (S12 acceptance)', () => {
	it('a live session on the request redirects to /home without rendering the form', async () => {
		const load = _createLoginLoad();
		const outcome = await load({
			locals: { authSession: { id: randomUUID(), userId: randomUUID() } },
		} as unknown as Parameters<ReturnType<typeof _createLoginLoad>>[0]).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
		expect((outcome as { location: string }).location).toBe('/home');
	});

	it('an anonymous request renders the form (`available: true`, no redirect)', async () => {
		const load = _createLoginLoad({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });
		const result = await load({
			locals: { authSession: null },
		} as unknown as Parameters<ReturnType<typeof _createLoginLoad>>[0]);
		expect(result).toEqual({ available: true });
	});
});

describe('/login — membership state governs eligibility, grounded in spec §4 / ADR 0014 §4 / slices §2.3', () => {
	it('an ACTIVE member logs in', async () => {
		const s = await memberInState('active');
		const action = _createLoginAction(loginSeams());
		const outcome = await action(loginEvent({ identifier: s.email, password: PASSWORD }).event).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
	});

	it('a PAUSED member logs in — slices §1.9 acceptance: pause preserves login, mail, and discussion access', async () => {
		const s = await memberInState('paused');
		const action = _createLoginAction(loginSeams());
		const outcome = await action(loginEvent({ identifier: s.email, password: PASSWORD }).event).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
	});

	it('a LEFT member cannot log in — a correct password is refused, not silently granted a session', async () => {
		const s = await memberInState('left');
		const action = _createLoginAction(loginSeams());
		const { event, setCookies } = loginEvent({ identifier: s.email, password: PASSWORD });
		const refused = await action(event);
		expect(refused).toHaveProperty('status', 403);
		expect(refused).toHaveProperty('data', { code: 'membership_inactive' });
		expect(setCookies).toHaveLength(0);
	});

	it('a REMOVED member cannot log in, and the refused attempt leaves NO new session row behind', async () => {
		const s = await memberInState('removed');
		const beforeCount = await liveSessionCount(s.authUserId);
		expect(beforeCount).toBe(0); // offboarding already revoked the activation session

		const action = _createLoginAction(loginSeams());
		const { event, setCookies } = loginEvent({ identifier: s.email, password: PASSWORD });
		const refused = await action(event);
		expect(refused).toHaveProperty('status', 403);
		expect(refused).toHaveProperty('data', { code: 'membership_inactive' });
		expect(setCookies).toHaveLength(0);

		// The crux of the fix: `authenticate()` DID mint a session row inside
		// the transaction (the password was correct), but the whole unit of
		// work rolled back when MembershipInactiveError threw — so the count is
		// UNCHANGED, not merely revoked-after-the-fact.
		expect(await liveSessionCount(s.authUserId)).toBe(beforeCount);
	});
});

describe('/logout — session-destroying (S12 acceptance)', () => {
	function logoutEvent(sessionId: string | undefined, hasSession: boolean) {
		const deleted: unknown[] = [];
		return {
			event: {
				cookies: {
					get: () => sessionId,
					delete: (...a: unknown[]) => deleted.push(a),
				},
				locals: { authSession: hasSession ? { id: sessionId, userId: randomUUID() } : null },
			} as unknown as Parameters<ReturnType<typeof _createLogoutAction>>[0],
			deleted,
		};
	}

	it('logout invalidates the session server-side — a subsequent validateSession returns null', async () => {
		const s = await memberInState('active');
		const action = _createLogoutAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });

		const live = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, s.sessionId), db);
		expect(live).not.toBeNull();

		const { event, deleted } = logoutEvent(s.sessionId, true);
		const outcome = await action(event).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
		expect(deleted).toHaveLength(1);

		const dead = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, s.sessionId), db);
		expect(dead).toBeNull();
	});

	it('logout is idempotent — replaying it for an already-dead session still redirects, clears the cookie, no throw', async () => {
		const action = _createLogoutAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });
		const { event, deleted } = logoutEvent(randomUUID(), false);
		const outcome = await action(event).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
		expect(deleted).toHaveLength(1);
	});
});
