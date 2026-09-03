/**
 * S6 integration rows (slices §1.8 acceptance; spec §10 "Auth/application" /
 * "Membership"), on the S1 fixture: real migrator run (0000–0009), real
 * `gftb_migrator`/`gftb_app` role split, FORCE RLS binding both.
 *
 *   - assent to a superseded agreement version rejected;
 *   - activation is ATOMIC: an injected failure after password creation
 *     leaves no Active membership, no partial audit event, no auth user, and
 *     an UNCONSUMED activation token;
 *   - `person_id` survives an email change; the prior address remains in
 *     `person_email` history;
 *   - activation succeeds with the contribution tables unreachable
 *     (contribution/mail are not activation PREDICATES — row 10; the outbox
 *     half of the old invariant is superseded by ADR 0024 §1.5: fresh
 *     activation now enqueues exactly four provisioning rows in the
 *     same transaction, and a converged replay adds none);
 *   - every transition this lane ships writes its audit row with actor,
 *     aggregate, transition, result, agreement version, timestamp — and no
 *     audit row carries a token plaintext, URL, or free text;
 *   - approval provisions person + person_email + membership(pending_assent)
 *     in the SAME unit of work as the decision (row 6), replays converge.
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
	exec,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { grantRole } from '../auth/roles';
import { AuthError, validateSession } from '../auth';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '../application/claim';
import { submitApplication, validateSubmission, verifyEmail } from '../application/intake';
import { TokenRejectedError, mintToken } from '../application/tokens';
import { activateMembership, changeEmail, emailHistory, mintActivationToken, provisionOnApproval } from './activate';
import { NoAgreementVersionError, SupersededAgreementError, publishAgreementVersion } from './agreement';
import { PROVISION_JOB_KINDS, reconcileActiveProvisioning } from './provision';
import { pauseMembership } from './transition';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
/** bcrypt cost for test speed; production uses the package default. */
const FAST_HASH = { rounds: 4 };

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
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	await pool?.end();
	await fixture?.stop();
});

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s6-${randomUUID().slice(0, 8)}`);
}

async function newKeyholder(tenantId: string): Promise<string> {
	const personId = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return personId;
}

function submission() {
	return validateSubmission({
		displayName: 'Alex Applicant',
		email: `applicant-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'woodworking; can staff intake',
		tourAvailability: 'weekday evenings',
		disclosures: 'none',
		ageAttested: true,
	});
}

/** Full pipeline to a provisioned approval: submit → verify → claim → tour → approve. */
async function provisioned(tenantId: string, keyholder: string) {
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

async function activationToken(tenantId: string, applicationId: string): Promise<string> {
	const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, applicationId), db);
	return minted.token;
}

async function auditRows(tenantId: string, aggregateId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select actor_type, actor_id, aggregate_type, aggregate_id, event, from_status, to_status,
			        result, agreement_version_id, reason_class, reauth_at, token_hash, created_at
			 from audit_event where aggregate_id = $1 order by created_at, id`,
			[aggregateId],
		);
		return rows;
	});
}

describe('A6 provisioning (slices §2.2 row 6)', () => {
	it('approval provisions person + current email + membership(pending_assent) and writes BOTH audit rows in one unit of work', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const result = await provisioned(tenantId, keyholder);

		expect(result.provisioned).toBe(true);
		expect(result.person.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(result.person.authUserId).toBeNull();
		expect(result.membership.status).toBe('pending_assent');
		expect(result.membership.applicationId).toBe(result.application.id);

		const history = await withTenant(tenantId, (tx) => emailHistory(tx, result.person.id), db);
		expect(history).toHaveLength(1);
		expect(history[0].supersededAt).toBeNull();

		const appAudit = await auditRows(tenantId, result.application.id);
		expect(appAudit.map((r) => r.event)).toContain('application.approved');
		const memAudit = await auditRows(tenantId, result.membership.id);
		expect(memAudit.map((r) => r.event)).toEqual(['membership.created']);
	});

	it('a replayed approval converges: the standing provisioning, no second person/membership', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const first = await provisioned(tenantId, keyholder);
		const replay = await withTenant(
			tenantId,
			(tx) => provisionOnApproval(tx, { applicationId: first.application.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(replay.provisioned).toBe(false);
		expect(replay.person.id).toBe(first.person.id);
		expect(replay.membership.id).toBe(first.membership.id);
		const memAudit = await auditRows(tenantId, first.membership.id);
		expect(memAudit.filter((r) => r.event === 'membership.created')).toHaveLength(1);
	});
});

describe('M1 assent + activation (slices §2.2 row 10; S6 acceptance)', () => {
	it('activates: assent to the CURRENT version, password set, session issued, audit row carries the agreement version', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(
			tenantId,
			(tx) => publishAgreementVersion(tx, { body: 'Fixture agreement text, version one.' }),
			db,
		);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);

		const result = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(result.activated).toBe(true);
		expect(result.membership.status).toBe('active');
		expect(result.membership.agreementVersionId).toBe(agreement.id);
		expect(result.person.authUserId).not.toBeNull();

		// The session is live — issued in the same unit of work.
		const session = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, result.session.id), db);
		expect(session).not.toBeNull();

		// Row 10's audit record: agreement version REQUIRED, all spec §6 fields.
		const memAudit = await auditRows(tenantId, prov.membership.id);
		const activated = memAudit.find((r) => r.event === 'membership.activated');
		expect(activated).toBeDefined();
		expect(activated.agreement_version_id).toBe(agreement.id);
		expect(activated.actor_type).toBe('person');
		expect(activated.actor_id).toBe(prov.person.id);
		expect(activated.from_status).toBe('pending_assent');
		expect(activated.to_status).toBe('active');
		expect(activated.result).toBe('committed');
		expect(activated.created_at).not.toBeNull();

		// The assent row stores the INTEGER, one per membership.
		const assents = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select agreement_version_id from assent where membership_id = $1', [
				prov.membership.id,
			]);
			return rows;
		});
		expect(assents).toEqual([{ agreement_version_id: agreement.id }]);
	});

	it('rejects assent to a SUPERSEDED agreement version (S6 acceptance row 1)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const v1 = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'Version one.' }), db);
		await withTenant(
			tenantId,
			(tx) => publishAgreementVersion(tx, { body: 'Version two.', effectiveFrom: new Date() }),
			db,
		);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);

		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token,
						password: 'a-long-fixture-password',
						agreementVersionId: v1.id,
						hashOptions: FAST_HASH,
					}),
				db,
			),
		).rejects.toBeInstanceOf(SupersededAgreementError);

		// Nothing moved, and the rolled-back consumption left the token usable.
		const status = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select status from membership where id = $1', [prov.membership.id]);
			return rows[0].status;
		});
		expect(status).toBe('pending_assent');
	});

	it('refuses activation entirely while NO agreement version exists (pre-ratification honesty)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);
		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token,
						password: 'a-long-fixture-password',
						agreementVersionId: 1,
						hashOptions: FAST_HASH,
					}),
				db,
			),
		).rejects.toBeInstanceOf(NoAgreementVersionError);
	});

	it('is ATOMIC: an injected failure after password creation leaves no Active membership, no partial audit, no auth user, an unconsumed token (S6 acceptance row 2)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);

		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token,
						password: 'a-long-fixture-password',
						agreementVersionId: agreement.id,
						hashOptions: FAST_HASH,
						afterPasswordCreate: () => {
							throw new Error('injected: crash after password creation');
						},
					}),
				db,
			),
		).rejects.toThrow('injected');

		const state = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const membership = await client.query('select status from membership where id = $1', [prov.membership.id]);
			const audit = await client.query(
				"select count(*)::int as n from audit_event where aggregate_id = $1 and event = 'membership.activated'",
				[prov.membership.id],
			);
			const assent = await client.query('select count(*)::int as n from assent where membership_id = $1', [
				prov.membership.id,
			]);
			const token = await client.query(
				"select consumed_at from application_email_token where application_id = $1 and purpose = 'activate'",
				[prov.application.id],
			);
			return {
				status: membership.rows[0].status,
				auditCount: audit.rows[0].n,
				assentCount: assent.rows[0].n,
				tokenConsumed: token.rows.map((r) => r.consumed_at),
			};
		});
		expect(state.status).toBe('pending_assent');
		expect(state.auditCount).toBe(0);
		expect(state.assentCount).toBe(0);
		expect(state.tokenConsumed).toEqual([null]);

		// No auth user survived either: the whole unit of work rolled back.
		const users = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select count(*)::int as n from "auth"."users" where tenant_id = $1', [
				tenantId,
			]);
			return rows[0].n;
		});
		expect(users).toBe(0);

		// And the surviving token still activates — the failure cost nothing.
		const result = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(result.activated).toBe(true);
	});

	it('succeeds with the contribution tables unreachable — contribution is not an activation predicate (S6 acceptance row 4, narrowed by ADR 0024 §1.5)', async () => {
		// `outbox_job` WAS on this revoke list until ADR 0024 §1.5 superseded
		// that half of the row-10 invariant: fresh activation now enqueues
		// all four provisioning intents in its own transaction, so an outbox-write
		// failure correctly rolls back activation (exactly as it already does
		// for leave/remove). The contribution half of the invariant stands.
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);

		// Make the tables genuinely unreachable for the runtime role: any
		// accidental read or write inside activation now errors loudly.
		await exec(fixture.migratorDsn, [
			'revoke all on contribution_agreement from gftb_app',
			'revoke all on finance_receipt from gftb_app',
		]);
		try {
			const result = await withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token,
						password: 'a-long-fixture-password',
						agreementVersionId: agreement.id,
						hashOptions: FAST_HASH,
					}),
				db,
			);
			expect(result.activated).toBe(true);
			expect(result.membership.status).toBe('active');
		} finally {
			await exec(fixture.migratorDsn, [
				'grant select, insert, update, delete on contribution_agreement to gftb_app',
				'grant select, insert on finance_receipt to gftb_app',
			]);
		}
	});

	it('fresh activation enqueues all four pending generation-1 projections; replay adds none (ADR 0024 §1.5)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);

		const provisionRows = () =>
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query(
					`select kind, status, idempotency_key, payload from outbox_job
					 where aggregate_id = $1 and kind like 'provision.%'
					 order by kind`,
					[prov.membership.id],
				);
				return rows;
			});

		const first = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(first.activated).toBe(true);

		const afterFresh = await provisionRows();
		expect(afterFresh).toHaveLength(4);
		expect(afterFresh.map((row) => row.kind).sort()).toEqual([...PROVISION_JOB_KINDS].sort());
		for (const row of afterFresh) {
			expect(row.status).toBe('pending');
			expect(row.idempotency_key).toBe(
				`${tenantId}:membership:${prov.membership.id}:${row.kind.slice('provision.'.length)}:g1`,
			);
			// Versioned ids only — never an address, token, or mutable email key.
			expect(row.payload).toEqual({
				schemaVersion: 1,
				tenantId,
				membershipId: prov.membership.id,
				personId: prov.person.id,
				generation: 1,
			});
		}

		// Converged replay (same consumed token, right password) enqueues NOTHING:
		// the fresh-activation path is the only enqueue site.
		const replay = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(replay.activated).toBe(false);
		expect(await provisionRows()).toHaveLength(4);

		// Pre-carrier repair: remove one fixture row to model an Active member
		// created before the four-projection fan-out, then run the exact startup
		// reconciliation. It restores only the missing generation-1 receipt.
		await asTenant(fixture.runtimeDsn, tenantId, (client) =>
			client.query(
				"delete from outbox_job where aggregate_id = $1 and kind = 'provision.ensure_archive'",
				[prov.membership.id],
			),
		);
		expect(await provisionRows()).toHaveLength(3);
		expect(await withTenant(tenantId, (tx) => reconcileActiveProvisioning(tx), db)).toBe(1);
		expect(await provisionRows()).toHaveLength(4);

		// Paused members retain the same identity/mail/list/archive entitlement.
		// One dead projection is an audited-replay obligation, not permission to
		// crash startup or block repair of another missing projection.
		await withTenant(
			tenantId,
			(tx) =>
				pauseMembership(tx, {
					membershipId: prov.membership.id,
					actor: { personId: prov.person.id, via: 'member' },
					expectedVersion: first.membership.version,
				}),
			db,
		);
		await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			await client.query(
				"update outbox_job set status = 'dead', attempts = max_attempts where aggregate_id = $1 and kind = 'provision.add_lists'",
				[prov.membership.id],
			);
			await client.query(
				"delete from outbox_job where aggregate_id = $1 and kind = 'provision.ensure_archive'",
				[prov.membership.id],
			);
		});
		expect(await provisionRows()).toHaveLength(3);
		expect(await withTenant(tenantId, (tx) => reconcileActiveProvisioning(tx), db)).toBe(1);
		const repaired = await provisionRows();
		expect(repaired).toHaveLength(4);
		expect(repaired.find((row) => row.kind === 'provision.add_lists')?.status).toBe('dead');
		expect(repaired.find((row) => row.kind === 'provision.ensure_archive')?.status).toBe('pending');
		expect(await withTenant(tenantId, (tx) => reconcileActiveProvisioning(tx), db)).toBe(0);
	});

	it('replay with the consumed token converges ONLY with the right password (spec §6 duplicate → original result)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);
		const first = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(first.activated).toBe(true);

		const replay = await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);
		expect(replay.activated).toBe(false);
		expect(replay.membership.id).toBe(first.membership.id);

		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token,
						password: 'wrong-password-entirely',
						agreementVersionId: agreement.id,
						hashOptions: FAST_HASH,
					}),
				db,
			),
		).rejects.toBeInstanceOf(AuthError);
	});

	it('an expired activation token is refused with the one public message', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, prov.application.id, { ttlMs: -1 }), db);
		await expect(
			withTenant(
				tenantId,
				(tx) =>
					activateMembership(tx, {
						token: minted.token,
						password: 'a-long-fixture-password',
						agreementVersionId: 1,
						hashOptions: FAST_HASH,
					}),
				db,
			),
		).rejects.toBeInstanceOf(TokenRejectedError);
	});
});

describe('identity invariants (spec §4; S6 acceptance row 3)', () => {
	it('an Active member email change atomically owes a fresh ids-only list reconciliation', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);
		await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);

		const changed = await withTenant(
			tenantId,
			(tx) => changeEmail(tx, { personId: prov.person.id, newEmail: `new-${randomUUID().slice(0, 8)}@example.org` }),
			db,
		);
		const rows = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const result = await client.query(
				`select aggregate_id, payload, idempotency_key from outbox_job
				 where kind = 'provision.add_lists' and idempotency_key like '%:email:%'`,
			);
			return result.rows;
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].aggregate_id).toBe(prov.membership.id);
		expect(rows[0].idempotency_key).toBe(
			`${tenantId}:membership:${prov.membership.id}:add_lists:email:${changed.id}`,
		);
		expect(rows[0].payload).toEqual({
			schemaVersion: 1,
			tenantId,
			membershipId: prov.membership.id,
			personId: prov.person.id,
			generation: 1,
		});
	});

	it('person_id survives an email change and the prior address remains in history', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const prov = await provisioned(tenantId, keyholder);
		const before = await withTenant(tenantId, (tx) => emailHistory(tx, prov.person.id), db);
		expect(before).toHaveLength(1);
		const original = before[0].email;

		const changed = await withTenant(
			tenantId,
			(tx) => changeEmail(tx, { personId: prov.person.id, newEmail: `new-${randomUUID().slice(0, 8)}@example.org` }),
			db,
		);
		expect(changed.personId).toBe(prov.person.id);

		const after = await withTenant(tenantId, (tx) => emailHistory(tx, prov.person.id), db);
		expect(after).toHaveLength(2);
		const superseded = after.find((row) => row.email === original);
		expect(superseded?.supersededAt).not.toBeNull();
		const current = after.find((row) => row.supersededAt === null);
		expect(current?.email).toBe(changed.email);

		// The person row itself is untouched — person_id is immutable.
		const personRow = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select id from person where id = $1', [prov.person.id]);
			return rows;
		});
		expect(personRow).toHaveLength(1);
	});

	it('the database refuses to rewrite email history (one-way supersession, trigger-enforced)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const prov = await provisioned(tenantId, keyholder);
		await withTenant(
			tenantId,
			(tx) => changeEmail(tx, { personId: prov.person.id, newEmail: `n-${randomUUID().slice(0, 8)}@example.org` }),
			db,
		);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				await client.query("update person_email set email = 'rewritten@example.org' where person_id = $1", [
					prov.person.id,
				]);
			}),
		).rejects.toThrow(/immutable|superseded|permission denied/i);
	});
});

describe('the audit spine at the database (S6 acceptance row 5, integration half)', () => {
	it('audit rows are append-only: the runtime cannot UPDATE or DELETE them', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const prov = await provisioned(tenantId, keyholder);
		const rows = await auditRows(tenantId, prov.membership.id);
		expect(rows.length).toBeGreaterThan(0);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				await client.query("update audit_event set result = 'rewritten' where aggregate_id = $1", [prov.membership.id]);
			}),
		).rejects.toThrow(/append-only|permission denied/i);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				await client.query('delete from audit_event where aggregate_id = $1', [prov.membership.id]);
			}),
		).rejects.toThrow(/append-only|permission denied/i);
	});

	it('no audit row carries a token plaintext, URL, or address (scanner over real rows)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const agreement = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'V1.' }), db);
		const prov = await provisioned(tenantId, keyholder);
		const token = await activationToken(tenantId, prov.application.id);
		await withTenant(
			tenantId,
			(tx) =>
				activateMembership(tx, {
					token,
					password: 'a-long-fixture-password',
					agreementVersionId: agreement.id,
					hashOptions: FAST_HASH,
				}),
			db,
		);

		const all = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select * from audit_event where tenant_id = $1', [tenantId]);
			return rows;
		});
		expect(all.length).toBeGreaterThan(0);
		for (const row of all) {
			const text = JSON.stringify(row);
			expect(text).not.toContain(token);
			expect(text).not.toMatch(/https?:\/\//);
			expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
		}
	});
});
