/**
 * ADVERSARIAL REVIEW SUITE (S6/S7 slice PR #182) — NOT part of the PR.
 * Written independently by the reviewing agent to hammer the slice's critical
 * invariants beyond the shipped acceptance rows:
 *
 *   1. token single-use under TRUE CONCURRENCY (two parallel activations);
 *   2. a consumed activation token can NEVER resurrect access for an
 *      offboarded (removed) member — even with the right password;
 *   3. racing leave × remove: exactly one terminal transition commits, ONE
 *      set of offboarding effects exists (identity keys, §2.2 rows 13/14);
 *   4. a hostile projection handler that actively tries to RESTORE the
 *      membership from inside the outbox lane cannot (invariant §2.3-1);
 *   5. pause preserves LOGIN itself (a fresh authenticate succeeds while
 *      paused — TIN-3440), not merely the standing session;
 *   6. a superseded-assent refusal does not burn the activation token, and
 *      the eventual assent pins the version actually current at commit.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, schema, type Db } from '../db/client';
import { withTenant } from '../db/tenant';
import { runMigrator } from '../db/migrate';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { grantRole } from '../auth/roles';
import { authenticate, validateSession } from '../auth';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '../application/claim';
import { submitApplication, validateSubmission, verifyEmail } from '../application/intake';
import { TokenRejectedError, mintToken } from '../application/tokens';
import { createHandlerRegistry } from '../outbox/handlers';
import { dispatchOnce } from '../outbox/dispatch';
import {
	activateMembership,
	mintActivationToken,
	provisionOnApproval,
	MembershipVersionConflictError,
} from './activate';
import { SupersededAgreementError, publishAgreementVersion } from './agreement';
import { personRecord } from './offboard';
import { canBorrow, leaveMembership, removeMembership, resumeMembership, pauseMembership } from './transition';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;
let tenantId: string;
let keyholder: string;
let agreementId: number;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
const FAST_HASH = { rounds: 4 };
const PASSWORD = 'hostile-review-password';

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

	tenantId = await seedTenant(fixture.migratorDsn, `hr-${randomUUID().slice(0, 8)}`);
	keyholder = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	agreementId = (
		await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'Hostile-review agreement v1.' }), db)
	).id;
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	await pool?.end();
	await fixture?.stop();
});

async function provisioned(email?: string) {
	const submitted = await withTenant(
		tenantId,
		(tx) =>
			submitApplication(
				tx,
				validateSubmission({
					displayName: 'Hostile Reviewer',
					email: email ?? `hostile-${randomUUID().slice(0, 8)}@example.org`,
					interestsHelpOffer: 'stress testing',
					tourAvailability: 'always',
					disclosures: 'none',
					ageAttested: true,
				}),
			),
		db,
	);
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

async function membershipRow(id: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query('select status, version, agreement_version_id from membership where id = $1', [
			id,
		]);
		return rows[0] as { status: string; version: number; agreement_version_id: number | null };
	});
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(sql, params);
		return Number(rows[0].n);
	});
}

describe('hostile: activation token under true concurrency', () => {
	it('two parallel activations with ONE token: at most one fresh activation, exactly one auth user, one assent, one version bump', async () => {
		const prov = await provisioned();
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);

		const attempt = () =>
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token: minted.token,
						password: PASSWORD,
						agreementVersionId: agreementId,
						hashOptions: FAST_HASH,
					}),
				db,
			);

		const results = await Promise.allSettled([attempt(), attempt()]);
		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');

		// One of the two MUST have committed the activation.
		const fresh = fulfilled.filter((r) => (r as PromiseFulfilledResult<{ activated: boolean }>).value.activated);
		expect(fresh).toHaveLength(1);
		// The other either lost the token race (hard refusal) or arrived after
		// commit and converged with the proven password — both are legal; a
		// SECOND fresh activation is not.
		for (const r of rejected) {
			expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TokenRejectedError);
		}

		const row = await membershipRow(prov.membership.id);
		expect(row.status).toBe('active');
		expect(row.version).toBe(prov.membership.version + 1); // bumped exactly once
		expect(
			await countRows('select count(*)::int as n from assent where membership_id = $1', [prov.membership.id]),
		).toBe(1);
		expect(
			await countRows(
				"select count(*)::int as n from audit_event where aggregate_id = $1 and event = 'membership.activated'",
				[prov.membership.id],
			),
		).toBe(1);
	});
});

describe('hostile: consumed tokens never resurrect an offboarded member', () => {
	it('replaying the consumed activation token AFTER removal is refused even with the correct password — and mints no session', async () => {
		const prov = await provisioned();
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);
		const activated = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token: minted.token,
					password: PASSWORD,
					agreementVersionId: agreementId,
					hashOptions: FAST_HASH,
				}),
			db,
		);

		await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: prov.membership.id,
					keyholderPersonId: keyholder,
					reasonClass: 'hostile_review_removal',
					reauthAt: new Date(),
					expectedVersion: activated.membership.version,
				}),
			db,
		);

		const sessionsBefore = await countRows('select count(*)::int as n from auth.sessions where user_id = $1', [
			activated.person.authUserId,
		]);

		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token: minted.token,
						password: PASSWORD, // the RIGHT password — still refused
						agreementVersionId: agreementId,
						hashOptions: FAST_HASH,
					}),
				db,
			),
		).rejects.toBeInstanceOf(TokenRejectedError);

		const row = await membershipRow(prov.membership.id);
		expect(row.status).toBe('removed');
		const sessionsAfter = await countRows('select count(*)::int as n from auth.sessions where user_id = $1', [
			activated.person.authUserId,
		]);
		expect(sessionsAfter).toBe(sessionsBefore); // no session minted by the refusal
	});
});

describe('hostile: racing leave × remove (§2.2 rows 13/14)', () => {
	it('exactly one terminal transition commits; the loser 409s; ONE three-job effect set exists', async () => {
		const prov = await provisioned();
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);
		const activated = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token: minted.token,
					password: PASSWORD,
					agreementVersionId: agreementId,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		const v = activated.membership.version;

		const results = await Promise.allSettled([
			withTenant(
				tenantId,
				(tx) =>
					leaveMembership(tx, {
						membershipId: prov.membership.id,
						memberPersonId: prov.person.id,
						expectedVersion: v,
					}),
				db,
			),
			withTenant(
				tenantId,
				(tx) =>
					removeMembership(tx, {
						membershipId: prov.membership.id,
						keyholderPersonId: keyholder,
						reasonClass: 'hostile_race',
						reauthAt: new Date(),
						expectedVersion: v,
					}),
				db,
			),
		]);

		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(MembershipVersionConflictError);

		const row = await membershipRow(prov.membership.id);
		expect(['left', 'removed']).toContain(row.status);
		// ONE set of offboarding effects — the identity keys, not the caller's.
		expect(
			await countRows("select count(*)::int as n from outbox_job where aggregate_id = $1 and kind like 'offboard.%'", [
				prov.membership.id,
			]),
		).toBe(3);
		// Exactly one terminal audit record.
		expect(
			await countRows(
				"select count(*)::int as n from audit_event where aggregate_id = $1 and event in ('membership.left','membership.removed')",
				[prov.membership.id],
			),
		).toBe(1);
	});
});

describe('hostile: a projection handler cannot restore membership (§2.3 invariant 1)', () => {
	it('a handler that ACTIVELY tries to resume the removed membership fails, retries, and the membership stays removed', async () => {
		// Fresh tenant so this dispatch only sees our jobs.
		tenantId = await seedTenant(fixture.migratorDsn, `hr2-${randomUUID().slice(0, 8)}`);
		keyholder = randomUUID();
		await withTenant(
			tenantId,
			(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
			db,
		);
		agreementId = (
			await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'Hostile-review agreement v1.' }), db)
		).id;

		const prov = await provisioned();
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);
		const activated = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token: minted.token,
					password: PASSWORD,
					agreementVersionId: agreementId,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: prov.membership.id,
					keyholderPersonId: keyholder,
					reasonClass: 'hostile_restore_probe',
					reauthAt: new Date(),
					expectedVersion: activated.membership.version,
				}),
			db,
		);

		// The hostile registry: every offboarding job tries to RESUME the
		// membership through the legitimate transition surface.
		const hostile = createHandlerRegistry(
			Object.fromEntries(
				['offboard.cancel_billing', 'offboard.remove_lists', 'offboard.disable_mailbox'].map((kind) => [
					kind,
					async (job: { tenantId: string; aggregateId: string }) => {
						await withTenant(
							job.tenantId,
							(tx) =>
								resumeMembership(tx, {
									membershipId: job.aggregateId,
									actor: { personId: keyholder, via: 'keyholder' },
								}),
							db,
						);
					},
				]),
			),
		);
		const summary = await dispatchOnce({ tenantId, worker: 'hostile-worker', registry: hostile, db });
		expect(summary.done).toBe(0); // nothing "succeeded" at restoring

		const row = await membershipRow(prov.membership.id);
		expect(row.status).toBe('removed'); // the invariant holds
		// The failed effects stay VISIBLE as obligations on the record.
		const record = await withTenant(tenantId, (tx) => personRecord(tx, prov.person.id), db);
		expect(record.openObligations.length).toBe(3);
		// And the session stays gone.
		const session = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, activated.session.id), db);
		expect(session).toBeNull();
	});
});

describe('hostile: pause preserves LOGIN, not merely the standing session (TIN-3440)', () => {
	it('a FRESH authenticate succeeds while paused; borrowing stays revoked; zero offboarding traffic', async () => {
		const email = `paused-${randomUUID().slice(0, 8)}@example.org`;
		const prov = await provisioned(email);
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);
		const activated = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token: minted.token,
					password: PASSWORD,
					agreementVersionId: agreementId,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		await withTenant(
			tenantId,
			(tx) =>
				pauseMembership(tx, {
					membershipId: prov.membership.id,
					actor: { personId: prov.person.id, via: 'member' },
					expectedVersion: activated.membership.version,
				}),
			db,
		);

		// Fresh login while paused MUST succeed — pause preserves login.
		const login = await withTenant(
			tenantId,
			(tx) => authenticate(tx, tenantId, { handle: email, password: PASSWORD }),
			db,
		);
		expect(login.session.id).toBeTruthy();

		const row = await membershipRow(prov.membership.id);
		expect(row.status).toBe('paused');
		expect(canBorrow({ status: row.status as 'paused' })).toBe(false);
		// Pause enqueues NOTHING — no offboarding, no NEW list/mailbox traffic.
		// The four standing rows are ACTIVATION's generation-1 projections
		// (ADR 0024 §3), enqueued before the pause; pause itself
		// added no row of any kind (pause preserves discussion access, so no
		// re-subscribe is ever needed on resume).
		expect(
			await countRows(
				"select count(*)::int as n from outbox_job where aggregate_id = $1 and kind not like 'provision.%'",
				[prov.membership.id],
			),
		).toBe(0);
		expect(
			await countRows('select count(*)::int as n from outbox_job where aggregate_id = $1', [prov.membership.id]),
		).toBe(4);
	});
});

describe('hostile: superseded assent burns nothing and pins the real version', () => {
	it('a stale-version refusal leaves the token usable; the eventual assent pins the CURRENT version; garbage versions all refuse', async () => {
		const prov = await provisioned();
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id), db);

		// Supersede the rendered version between render and submit.
		const v2 = await withTenant(
			tenantId,
			(tx) => publishAgreementVersion(tx, { body: 'Hostile-review agreement v2 — superseding.' }),
			db,
		);

		const attempt = (versionId: number) =>
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token: minted.token,
						password: PASSWORD,
						agreementVersionId: versionId,
						hashOptions: FAST_HASH,
					}),
				db,
			);

		// The stale form's version, and hostile garbage — every one a refusal.
		await expect(attempt(agreementId)).rejects.toBeInstanceOf(SupersededAgreementError);
		await expect(attempt(0)).rejects.toBeInstanceOf(SupersededAgreementError);
		await expect(attempt(-7)).rejects.toBeInstanceOf(SupersededAgreementError);
		await expect(attempt(999_999)).rejects.toBeInstanceOf(SupersededAgreementError);

		// Nothing burned, nothing half-written.
		const before = await membershipRow(prov.membership.id);
		expect(before.status).toBe('pending_assent');
		expect(
			await countRows('select count(*)::int as n from assent where membership_id = $1', [prov.membership.id]),
		).toBe(0);

		// The SAME token now activates against the current version…
		const activated = await attempt(v2.id);
		expect(activated.activated).toBe(true);

		// …and the assent pins v2, not the version the first form rendered.
		const after = await membershipRow(prov.membership.id);
		expect(after.status).toBe('active');
		expect(after.agreement_version_id).toBe(v2.id);
		const assentVersion = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select agreement_version_id from assent where membership_id = $1', [
				prov.membership.id,
			]);
			return rows[0].agreement_version_id as number;
		});
		expect(assentVersion).toBe(v2.id);
	});
});
