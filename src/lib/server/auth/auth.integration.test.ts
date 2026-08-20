/**
 * The S2 compatibility proof and its siblings, against real PostgreSQL
 * (TIN-3817 slice S2).
 *
 * EVERY ROW RUNS WITH S1'S MIGRATIONS *AND POLICIES* APPLIED, AS THE RUNTIME
 * ROLE. Spec §1.4 is explicit that a green suite on a policy-free database
 * "proves nothing and is the specific way this slice can pass while being
 * broken" (§1.3 B3): the failure being hunted is the GUC never reaching the
 * adapter's connection, which only a FORCE-RLS database can reveal. So the
 * fixture is S1's — real migrator run, real `gftb_migrator`/`gftb_app` role
 * split — and every application-path assertion here executes as `gftb_app`
 * through `withTenant`, exactly as production will.
 *
 * The headline row is deliberately humble: create a user, read it back,
 * assert NON-NULL. Under a broken DI path that read-back is null (the policy
 * predicate evaluates NULL on the adapter's own pool), so the trivial-looking
 * assertion is the entire §1.3 B3 regression test.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '$lib/server/db/client';
import { withTenant } from '$lib/server/db/tenant';
import {
	MIGRATIONS_DIR,
	credentialRuntimeRole,
	query,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '$lib/server/db/integration-support';
import { runMigrator } from '$lib/server/db/migrate';
import {
	AuthError,
	authenticate,
	createUserWithPassword,
	getUser,
	getUserByHandle,
	requireSession,
	revokeSession,
	setPassword,
	validateSession,
} from './index';
import { isFreshlyAuthenticated, reauthenticate, requireFreshReauth } from './reauth';
import { activeRoles, grantRole, hasRole, revokeRole } from './roles';

let db: PgFixture;
let tenantA: string;
let tenantB: string;
let previousDatabaseUrl: string | undefined;

/** bcrypt cost 4 — the legal minimum; hashing strength is not under test. */
const FAST_HASH = { rounds: 4 };
const PASSWORD = 'correct horse battery staple';

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

beforeAll(async () => {
	db = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', db.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(db);

	tenantA = await seedTenant(db.migratorDsn, 'tenant-a');
	tenantB = await seedTenant(db.migratorDsn, 'tenant-b');

	// Point the app's own pool at the DML-only runtime credential: every
	// `withTenant` below runs as `gftb_app`, the way `web` will.
	previousDatabaseUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = db.runtimeDsn;
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	await db?.stop();
});

describe('the compatibility proof (spec §1.4; §1.3 B3 Fix A)', () => {
	it('creates and reads back a tenant-scoped user through the DI path — non-null is the whole test', async () => {
		const handle = `proof-${randomUUID().slice(0, 8)}`;
		const created = await withTenant(tenantA, (tx) =>
			createUserWithPassword(
				tx,
				tenantA,
				{ handle, email: `${handle}@example.org`, displayName: 'Compat Proof', password: PASSWORD },
				FAST_HASH,
			),
		);
		expect(created.id).toBeTruthy();
		expect(created.tenantId).toBe(tenantA);

		const byId = await withTenant(tenantA, (tx) => getUser(tx, tenantA, created.id));
		expect(byId).not.toBeNull(); // null here = the GUC never reached the adapter's connection
		expect(byId?.handle).toBe(handle);

		const byHandle = await withTenant(tenantA, (tx) => getUserByHandle(tx, tenantA, handle));
		expect(byHandle?.id).toBe(created.id);
	});

	it("a second tenant's id reads zero rows through that same adapter path", async () => {
		const handle = `negative-${randomUUID().slice(0, 8)}`;
		const created = await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);

		const crossTenant = await withTenant(tenantB, (tx) => getUser(tx, tenantB, created.id));
		expect(crossTenant).toBeNull();
		const crossHandle = await withTenant(tenantB, (tx) => getUserByHandle(tx, tenantB, handle));
		expect(crossHandle).toBeNull();
	});

	it('RLS binds even when the adapter is handed the WRONG tenant id — the GUC is the belt, not the argument', async () => {
		const handle = `belt-${randomUUID().slice(0, 8)}`;
		const created = await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);

		// Transaction pinned to tenant B, adapter told tenant A: the policy on
		// the CONNECTION must win, or a single confused call site could read
		// across tenants.
		const smuggled = await withTenant(tenantB, (tx) => getUser(tx, tenantA, created.id));
		expect(smuggled).toBeNull();
	});

	it('a cross-tenant WRITE is refused by WITH CHECK, not silently accepted', async () => {
		await expect(
			withTenant(tenantB, (tx) =>
				grantRole(tx, tenantA, {
					personId: randomUUID(),
					role: 'pending-vocabulary',
					grantedBy: randomUUID(),
				}),
			),
		).rejects.toThrow(/row-level security|violates/i);
	});
});

describe('the vendored auth.* tables are protected and single-ledgered (spec §1.3 M11)', () => {
	it('all six carry relforcerowsecurity = true and at least one policy', async () => {
		const rows = await query<{
			relname: string;
			relrowsecurity: boolean;
			relforcerowsecurity: boolean;
			policy_count: string;
		}>(
			db.migratorDsn,
			`select c.relname, c.relrowsecurity, c.relforcerowsecurity,
			        (select count(*) from pg_policies p
			          where p.schemaname = 'auth' and p.tablename = c.relname) as policy_count
			   from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where n.nspname = 'auth' and c.relkind = 'r'
			  order by c.relname`,
		);
		expect(rows.map((r) => r.relname)).toEqual([
			'audit_events',
			'backup_codes',
			'invitations',
			'sessions',
			'totp_secrets',
			'users',
		]);
		for (const row of rows) {
			expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
			expect(row.relforcerowsecurity, `${row.relname} FORCE`).toBe(true);
			expect(Number(row.policy_count), `${row.relname} policies`).toBeGreaterThanOrEqual(1);
		}
	});

	it("the applied-migration ledger contains OUR filenames only — the package's journal was never invoked", async () => {
		const rows = await query<{ tag: string }>(
			db.migratorDsn,
			'select tag from migration.applied_migration order by idx',
		);
		expect(rows.map((r) => r.tag)).toEqual([
			'0000_app_tenant_foundation',
			'0001_auth_pg_vendored_0_2_4',
			'0002_rls_force_and_runtime_grants',
			'0003_member_role_grant',
		]);
		expect(rows.some((r) => r.tag.includes('lush_carmella'))).toBe(false);
	});
});

describe('sessions: revocation on password reset (spec §1.4)', () => {
	it('a password reset kills EVERY session — the second one 401s', async () => {
		const handle = `reset-${randomUUID().slice(0, 8)}`;
		const user = await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);

		const first = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));
		const second = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));
		// Both live before the reset:
		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, second.session.id))).not.toBeNull();

		const { revokedSessions } = await withTenant(tenantA, (tx) =>
			setPassword(tx, tenantA, user.id, 'an entirely new passphrase', FAST_HASH),
		);
		expect(revokedSessions).toBe(2);

		// The acceptance row's exact shape: the second session 401s.
		let refusal: unknown;
		try {
			await withTenant(tenantA, (tx) => requireSession(tx, tenantA, second.session.id));
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(AuthError);
		expect((refusal as AuthError).status).toBe(401);
		// And the first is just as dead:
		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, first.session.id))).toBeNull();

		// The NEW password authenticates; the old one refuses without an oracle.
		const fresh = await withTenant(tenantA, (tx) =>
			authenticate(tx, tenantA, { handle, password: 'an entirely new passphrase' }),
		);
		expect(fresh.session.id).toBeTruthy();
		await expect(
			withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD })),
		).rejects.toMatchObject({ status: 401, code: 'bad_credentials' });
	});

	it('unknown handle and wrong password refuse identically — no existence oracle', async () => {
		const handle = `oracle-${randomUUID().slice(0, 8)}`;
		await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);
		const wrongPassword = await withTenant(tenantA, (tx) =>
			authenticate(tx, tenantA, { handle, password: 'wrong' }).catch((e: AuthError) => e),
		);
		const unknownHandle = await withTenant(tenantA, (tx) =>
			authenticate(tx, tenantA, { handle: 'no-such-handle', password: 'wrong' }).catch((e: AuthError) => e),
		);
		expect(wrongPassword).toBeInstanceOf(AuthError);
		expect(unknownHandle).toBeInstanceOf(AuthError);
		expect((wrongPassword as AuthError).code).toBe((unknownHandle as AuthError).code);
		expect((wrongPassword as AuthError).message).toBe((unknownHandle as AuthError).message);
	});

	it('logout revokes exactly the presented session', async () => {
		const handle = `logout-${randomUUID().slice(0, 8)}`;
		await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);
		const kept = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));
		const dropped = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));
		expect(await withTenant(tenantA, (tx) => revokeSession(tx, tenantA, dropped.session.id))).toBe(true);
		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, dropped.session.id))).toBeNull();
		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, kept.session.id))).not.toBeNull();
	});
});

describe('fresh reauthentication (spec §1.4; TIN-3440)', () => {
	it('a sensitive action rejects a stale-but-VALID session, and reauth rotates it back to fresh', async () => {
		const handle = `reauth-${randomUUID().slice(0, 8)}`;
		await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);
		const { session } = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));

		// Fresh immediately after login. The window is generous relative to the
		// sleep below so a slow runner cannot flake it, and tiny relative to the
		// production 5-minute ASSUMPTION so the test stays fast.
		expect(() => requireFreshReauth(session, { windowMs: 800 })).not.toThrow();

		// Let the narrow test window lapse…
		await new Promise((resolve) => setTimeout(resolve, 1200));

		// …the session is still VALID (this is the "stale-but-valid" clause):
		const stillValid = await withTenant(tenantA, (tx) => validateSession(tx, tenantA, session.id));
		expect(stillValid).not.toBeNull();

		// …but the sensitive action refuses it:
		let refusal: unknown;
		try {
			requireFreshReauth(stillValid!, { windowMs: 800 });
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(AuthError);
		expect((refusal as AuthError).status).toBe(401);
		expect((refusal as AuthError).code).toBe('reauth_required');

		// Reauthenticate: password verified, session ROTATED.
		const rotated = await withTenant(tenantA, (tx) => reauthenticate(tx, tenantA, stillValid!, PASSWORD));
		expect(rotated.id).not.toBe(session.id);
		expect(isFreshlyAuthenticated(rotated, { windowMs: 800 })).toBe(true);
		expect(() => requireFreshReauth(rotated, { windowMs: 800 })).not.toThrow();

		// The presented session died in the rotation:
		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, session.id))).toBeNull();
	});

	it('a wrong password refuses WITHOUT rotating — failed reauth cannot log the real user out', async () => {
		const handle = `noburn-${randomUUID().slice(0, 8)}`;
		await withTenant(tenantA, (tx) =>
			createUserWithPassword(tx, tenantA, { handle, email: `${handle}@example.org`, password: PASSWORD }, FAST_HASH),
		);
		const { session } = await withTenant(tenantA, (tx) => authenticate(tx, tenantA, { handle, password: PASSWORD }));

		await expect(
			withTenant(tenantA, (tx) => reauthenticate(tx, tenantA, session, 'not the password')),
		).rejects.toMatchObject({ status: 401, code: 'bad_credentials' });

		expect(await withTenant(tenantA, (tx) => validateSession(tx, tenantA, session.id))).not.toBeNull();
	});
});

describe('member_role_grant mechanics (vocabulary PENDING sitting #2 Item 2)', () => {
	// An opaque label on purpose: these rows prove the MECHANISM without
	// asserting any role name the sitting has yet to ratify.
	const ROLE = 'sitting-2-will-name-these';

	it('grant → hold → revoke → re-grant, history append-only', async () => {
		const personId = randomUUID();
		const grantedBy = randomUUID();

		const granted = await withTenant(tenantA, (tx) => grantRole(tx, tenantA, { personId, role: ROLE, grantedBy }));
		expect(granted.revokedAt).toBeNull();
		expect(await withTenant(tenantA, (tx) => hasRole(tx, tenantA, personId, ROLE))).toBe(true);

		// Idempotent: a retried grant converges on the same live row.
		const again = await withTenant(tenantA, (tx) => grantRole(tx, tenantA, { personId, role: ROLE, grantedBy }));
		expect(again.id).toBe(granted.id);

		const revoked = await withTenant(tenantA, (tx) => revokeRole(tx, tenantA, personId, ROLE));
		expect(revoked?.id).toBe(granted.id);
		expect(revoked?.revokedAt).not.toBeNull();
		expect(await withTenant(tenantA, (tx) => hasRole(tx, tenantA, personId, ROLE))).toBe(false);

		// Revoking the already-revoked is a null, not an error:
		expect(await withTenant(tenantA, (tx) => revokeRole(tx, tenantA, personId, ROLE))).toBeNull();

		// Re-grant is a NEW row; the revoked one stays as history.
		const regranted = await withTenant(tenantA, (tx) => grantRole(tx, tenantA, { personId, role: ROLE, grantedBy }));
		expect(regranted.id).not.toBe(granted.id);
		const live = await withTenant(tenantA, (tx) => activeRoles(tx, tenantA, personId));
		expect(live.map((g) => g.id)).toEqual([regranted.id]);
	});

	it('a grant in tenant A is invisible from tenant B', async () => {
		const personId = randomUUID();
		await withTenant(tenantA, (tx) => grantRole(tx, tenantA, { personId, role: ROLE, grantedBy: randomUUID() }));
		expect(await withTenant(tenantB, (tx) => hasRole(tx, tenantB, personId, ROLE))).toBe(false);
		expect(await withTenant(tenantB, (tx) => activeRoles(tx, tenantB, personId))).toEqual([]);
	});

	it('member_role_grant sits under the same FORCE-RLS regime as every other table', async () => {
		const rows = await query<{
			relrowsecurity: boolean;
			relforcerowsecurity: boolean;
			qual: string | null;
			with_check: string | null;
		}>(
			db.migratorDsn,
			`select c.relrowsecurity, c.relforcerowsecurity, p.qual, p.with_check
			   from pg_class c
			   join pg_namespace n on n.oid = c.relnamespace
			   left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
			  where n.nspname = 'public' and c.relname = 'member_role_grant'`,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].relrowsecurity).toBe(true);
		expect(rows[0].relforcerowsecurity).toBe(true);
		expect(rows[0].qual).toContain('tenant_id');
		expect(rows[0].with_check).toContain('tenant_id');
	});

	it("the runtime role's default DML privileges reached the S2 table (0002's forward grant worked)", async () => {
		// Every row in this file already ran as gftb_app, but say it explicitly:
		// the runtime role can write and read the S2 table and CANNOT alter it.
		const rows = await query<{ privilege_type: string }>(
			db.migratorDsn,
			`select privilege_type from information_schema.role_table_grants
			  where grantee = 'gftb_app' and table_name = 'member_role_grant'
			  order by privilege_type`,
		);
		expect(rows.map((r) => r.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
	});
});
