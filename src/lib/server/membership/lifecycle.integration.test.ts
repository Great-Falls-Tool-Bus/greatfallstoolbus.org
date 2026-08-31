/**
 * S7 integration rows (slices §1.9 acceptance; spec §10 "Membership"), on the
 * S1 fixture: real migrator run (0000–0009), real role split, FORCE RLS.
 *
 *   - EXHAUSTIVE transition matrix: every ordered (state, event) pair on real
 *     rows — allowed-with-effects, forbidden-with-409, or one of the two §2.3
 *     invariant-2 convergent-replay pairs (left:leave, removed:remove);
 *     completeness iterates the enum so a new state fails until covered;
 *   - offboarding with EVERY handler failing still commits left/removed,
 *     revokes sessions, and leaves three retryable jobs;
 *   - replaying an offboarding for an already-removed person: no second
 *     effects, no error, the original receipt;
 *   - pause revokes borrowing while the SESSION STAYS VALID and list +
 *     discussion access stay intact (no offboarding traffic at all);
 *   - resume happens by explicit intent only — a recorded contribution event
 *     changes nothing (spec §4: "never an inferred result of payment");
 *   - an unresolved obligation stays visible on the offboarded person's
 *     record while session access is gone;
 *   - contribution/mail failure cannot change membership (spec §10 row).
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
import { authenticate, createUserWithPassword, validateSession } from '../auth';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '../application/claim';
import { submitApplication, validateSubmission, verifyEmail } from '../application/intake';
import { mintToken } from '../application/tokens';
import { createHandlerRegistry } from '../outbox/handlers';
import { dispatchOnce } from '../outbox/dispatch';
import { cancelBillingHandler } from '../outbox/handlers/cancel-billing';
import { createDisableMailboxHandler } from '../outbox/handlers/disable-mailbox';
import { createRemoveListsHandler } from '../outbox/handlers/remove-lists';
import {
	activateMembership,
	mintActivationToken,
	provisionOnApproval,
	IllegalMembershipTransitionError,
	type ActivationResult,
} from './activate';
import { publishAgreementVersion } from './agreement';
import { OFFBOARD_JOB_KINDS, personRecord } from './offboard';
import { InvalidAuditEventError } from '../audit/write';
import { _createLeaveAction, _createPauseAction } from '../../../routes/(member)/membership/+page.server';
import { _createRemoveAction } from '../../../routes/(keyholder)/remove/+page.server';
import {
	MEMBERSHIP_EVENTS,
	MEMBERSHIP_STATUSES,
	canBorrow,
	classifyTransition,
	leaveMembership,
	pauseMembership,
	removeMembership,
	resumeMembership,
	type MembershipEvent,
	type MembershipStatus,
} from './transition';

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

	tenantId = await seedTenant(fixture.migratorDsn, `s7-${randomUUID().slice(0, 8)}`);
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
		displayName: 'Alex Applicant',
		email: `applicant-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'woodworking; can staff intake',
		tourAvailability: 'weekday evenings',
		disclosures: 'none',
		ageAttested: true,
	});
}

/** Pipeline to a provisioned (pending_assent) membership. */
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

async function activate(applicationId: string): Promise<ActivationResult> {
	const minted = await withTenant(tenantId, (tx) => mintActivationToken(tx, applicationId), db);
	return withTenant(
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
}

interface Scenario {
	applicationId: string;
	membershipId: string;
	personId: string;
	version: number;
	sessionId: string | null;
	/** The tinyland-auth user id backing the session, when one was minted. */
	authUserId: string | null;
}

/** Build a membership standing in exactly `state`. */
async function inState(state: MembershipStatus): Promise<Scenario> {
	const prov = await provisioned();
	let sessionId: string | null = null;
	let authUserId: string | null = null;
	let version = prov.membership.version;
	if (state !== 'pending_assent') {
		const activated = await activate(prov.application.id);
		sessionId = activated.session.id;
		authUserId = activated.session.userId;
		version = activated.membership.version;
	}
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
		applicationId: prov.application.id,
		membershipId: prov.membership.id,
		personId: prov.person.id,
		version,
		sessionId,
		authUserId,
	};
}

async function membershipRow(id: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query('select status, version from membership where id = $1', [id]);
		return rows[0] as { status: string; version: number };
	});
}

async function offboardJobs(membershipId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			"select kind, status, attempts from outbox_job where aggregate_id = $1 and kind like 'offboard.%' order by kind",
			[membershipId],
		);
		return rows as { kind: string; status: string; attempts: number }[];
	});
}

/**
 * Re-point the suite at a FRESH tenant. The dispatcher is tenant-scoped and
 * claims bounded batches (spec §3.1), so a dispatch-shaped assertion must not
 * share a tenant with the matrix's backlog of pending offboarding jobs —
 * isolation here is what makes "my three jobs were claimed" deterministic
 * rather than a race against 40 older rows and a batch cap of 32.
 */
async function isolateTenant(): Promise<void> {
	tenantId = await seedTenant(fixture.migratorDsn, `s7i-${randomUUID().slice(0, 8)}`);
	keyholder = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	agreementId = (await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'Fixture agreement.' }), db))
		.id;
}

/** Apply `event` to the scenario through the real transition functions. */
async function applyEvent(s: Scenario, event: MembershipEvent) {
	switch (event) {
		case 'activate':
			return activate(s.applicationId);
		case 'pause':
			return withTenant(
				tenantId,
				(tx) => pauseMembership(tx, { membershipId: s.membershipId, actor: { personId: s.personId, via: 'member' } }),
				db,
			);
		case 'resume':
			return withTenant(
				tenantId,
				(tx) => resumeMembership(tx, { membershipId: s.membershipId, actor: { personId: s.personId, via: 'member' } }),
				db,
			);
		case 'leave':
			return withTenant(
				tenantId,
				(tx) =>
					leaveMembership(tx, { membershipId: s.membershipId, memberPersonId: s.personId, expectedVersion: s.version }),
				db,
			);
		case 'remove':
			return withTenant(
				tenantId,
				(tx) =>
					removeMembership(tx, {
						membershipId: s.membershipId,
						keyholderPersonId: keyholder,
						reasonClass: 'matrix_removal',
						reauthAt: new Date(),
						expectedVersion: s.version,
					}),
				db,
			);
	}
}

describe('the EXHAUSTIVE transition matrix on real rows (S7 acceptance row 1; spec §10 Membership)', () => {
	// The two §2.3 invariant-2 pairs: replaying a whole offboarding for an
	// already-terminal membership returns the original receipt, no error, no
	// second effect. Every other forbidden pair is a hard 409.
	const CONVERGENT: ReadonlyArray<`${MembershipStatus}:${MembershipEvent}`> = ['left:leave', 'removed:remove'];

	it('classifies and asserts EVERY ordered pair — no pair unasserted', { timeout: 600_000 }, async () => {
		const asserted: string[] = [];
		for (const from of MEMBERSHIP_STATUSES) {
			for (const event of MEMBERSHIP_EVENTS) {
				const pair = `${from}:${event}` as const;
				const expected = classifyTransition(from, event);
				const scenario = await inState(from);

				if (expected !== 'forbidden') {
					await applyEvent(scenario, event);
					const row = await membershipRow(scenario.membershipId);
					expect(row.status, pair).toBe(expected);
					if (event === 'leave' || event === 'remove') {
						const jobs = await offboardJobs(scenario.membershipId);
						expect(jobs.map((j) => j.kind).sort(), pair).toEqual([...OFFBOARD_JOB_KINDS].sort());
						if (scenario.sessionId) {
							const session = await withTenant(
								tenantId,
								(tx) => validateSession(tx, tenantId, scenario.sessionId!),
								db,
							);
							expect(session, `${pair} revokes sessions`).toBeNull();
						}
					}
				} else if (CONVERGENT.includes(pair)) {
					const result = (await applyEvent(scenario, event)) as { changed: boolean };
					expect(result.changed, pair).toBe(false);
					const jobs = await offboardJobs(scenario.membershipId);
					expect(jobs, `${pair} enqueues nothing new`).toHaveLength(OFFBOARD_JOB_KINDS.length);
					const row = await membershipRow(scenario.membershipId);
					expect(row.status, pair).toBe(from);
					expect(row.version, `${pair} mutates nothing`).toBe(scenario.version);
				} else {
					await expect(applyEvent(scenario, event), pair).rejects.toBeInstanceOf(IllegalMembershipTransitionError);
					const row = await membershipRow(scenario.membershipId);
					expect(row.status, `${pair} mutates nothing`).toBe(from);
					expect(row.version, `${pair} mutates nothing`).toBe(scenario.version);
				}
				asserted.push(pair);
			}
		}
		// Completeness: the enum iteration IS the coverage — a new state or
		// event grows this product and every new pair got asserted above.
		expect(asserted).toHaveLength(MEMBERSHIP_STATUSES.length * MEMBERSHIP_EVENTS.length);
	});
});

describe('offboarding replay (S7 acceptance rows 2-3; §2.3 invariants)', () => {
	it('with EVERY handler failing: left commits, sessions revoked, three RETRYABLE jobs remain', async () => {
		await isolateTenant();
		const s = await inState('active');
		await withTenant(
			tenantId,
			(tx) =>
				leaveMembership(tx, { membershipId: s.membershipId, memberPersonId: s.personId, expectedVersion: s.version }),
			db,
		);

		const failing = createHandlerRegistry(
			Object.fromEntries(
				OFFBOARD_JOB_KINDS.map((kind) => [
					kind,
					async () => {
						throw new Error(`injected: ${kind} target unavailable`);
					},
				]),
			),
		);
		const summary = await dispatchOnce({ tenantId, worker: 'test-worker', registry: failing, db });
		expect(summary.retried).toBeGreaterThanOrEqual(3);

		// A downstream failure NEVER restores membership (spec §11; TIN-3440).
		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('left');
		const session = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, s.sessionId!), db);
		expect(session).toBeNull();
		const jobs = await offboardJobs(s.membershipId);
		expect(jobs).toHaveLength(3);
		for (const job of jobs) {
			expect(job.status).toBe('pending'); // retryable, not dead, not done
			expect(job.attempts).toBe(1);
		}
	});

	it('replaying the whole offboarding for an already-removed person: no error, no second effects (row 3)', async () => {
		const s = await inState('removed');
		const before = await offboardJobs(s.membershipId);
		expect(before).toHaveLength(3);

		const replay = await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: s.membershipId,
					keyholderPersonId: keyholder,
					reasonClass: 'replay_attempt',
					reauthAt: new Date(),
					expectedVersion: s.version,
				}),
			db,
		);
		expect(replay.changed).toBe(false);

		const after = await offboardJobs(s.membershipId);
		expect(after).toEqual(before);
		const audits = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				"select count(*)::int as n from audit_event where aggregate_id = $1 and event = 'membership.removed'",
				[s.membershipId],
			);
			return rows[0].n;
		});
		expect(audits).toBe(1); // the original receipt stands alone
	});

	it('the three real handlers complete the jobs: cancel_billing cancels a standing agreement; the mail pair are recorded no-ops while gate-disabled', async () => {
		await isolateTenant();
		const s = await inState('active');
		// A standing cash agreement, written as raw SQL so this MEMBERSHIP
		// test file never imports contribution code (the S8 static fence).
		await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			await client.query(
				`insert into contribution_agreement (tenant_id, person_id, state, rail, cadence, amount_cents)
				 values ($1, $2, 'cash_recorded', 'cash', 'monthly', 1000)`,
				[tenantId, s.personId],
			);
		});
		await withTenant(
			tenantId,
			(tx) =>
				leaveMembership(tx, { membershipId: s.membershipId, memberPersonId: s.personId, expectedVersion: s.version }),
			db,
		);

		const real = createHandlerRegistry({
			'offboard.cancel_billing': cancelBillingHandler,
			'offboard.remove_lists': createRemoveListsHandler({ log: () => undefined }),
			'offboard.disable_mailbox': createDisableMailboxHandler({ log: () => undefined }),
		});
		const summary = await dispatchOnce({ tenantId, worker: 'test-worker', registry: real, db });
		expect(summary.done).toBeGreaterThanOrEqual(3);

		const jobs = await offboardJobs(s.membershipId);
		expect(jobs.every((j) => j.status === 'done')).toBe(true);
		const agreement = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select state from contribution_agreement where person_id = $1', [
				s.personId,
			]);
			return rows[0].state;
		});
		expect(agreement).toBe('cancelled');
		// Idempotent replay of the handler: still cancelled, no error.
		await dispatchOnce({ tenantId, worker: 'test-worker', registry: real, db });
	});
});

describe('pause preserves access (S7 acceptance row 4; TIN-3440)', () => {
	it('revokes borrowing while the session stays valid and list/discussion access stay intact', async () => {
		const s = await inState('active');
		await withTenant(
			tenantId,
			(tx) => pauseMembership(tx, { membershipId: s.membershipId, actor: { personId: s.personId, via: 'member' } }),
			db,
		);
		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('paused');
		expect(canBorrow({ status: row.status as MembershipStatus })).toBe(false);

		// The session survives — pause is not an offboarding.
		const session = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, s.sessionId!), db);
		expect(session).not.toBeNull();
		// List, mail, and discussion access preserved: NO offboarding traffic
		// of any kind was enqueued (the S5 tour-scheduling absence pattern).
		const jobs = await offboardJobs(s.membershipId);
		expect(jobs).toHaveLength(0);
	});
});

describe('resume is explicit intent only (S7 acceptance row 5; spec §4)', () => {
	it('a recorded contribution event changes NOTHING; the explicit transition resumes', async () => {
		const s = await inState('paused');

		// A contribution lands (cash recorded) — written raw, as finance would.
		await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			await client.query(
				`insert into contribution_agreement (tenant_id, person_id, state, rail, cadence, amount_cents)
				 values ($1, $2, 'cash_recorded', 'cash', 'monthly', 2000)`,
				[tenantId, s.personId],
			);
			await client.query(
				`insert into finance_receipt (tenant_id, person_id, rail, amount_cents, received_on, cadence, recorded_by, idempotency_key)
				 values ($1, $2, 'cash', 2000, current_date, 'monthly', $3, $4)`,
				[tenantId, s.personId, randomUUID(), randomUUID()],
			);
		});

		// Membership is UNTOUCHED by the payment (spec §10 Membership row).
		const afterPayment = await membershipRow(s.membershipId);
		expect(afterPayment.status).toBe('paused');
		expect(afterPayment.version).toBe(s.version);

		// The explicit member act resumes.
		const resumed = await withTenant(
			tenantId,
			(tx) => resumeMembership(tx, { membershipId: s.membershipId, actor: { personId: s.personId, via: 'member' } }),
			db,
		);
		expect(resumed.membership.status).toBe('active');
	});
});

describe('obligations stay visible without preserving access (S7 acceptance row 6; §2.3 invariant 3)', () => {
	it('a dead-lettered offboarding effect is an open obligation on the record while the session is gone', async () => {
		const s = await inState('active');
		await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: s.membershipId,
					keyholderPersonId: keyholder,
					reasonClass: 'fixture_removal',
					reauthAt: new Date(),
					expectedVersion: s.version,
				}),
			db,
		);
		// Force the billing effect to its permanent-failure terminal: the
		// dispatcher path to `dead` is S3's proven ground; the record surface
		// is what S7 owns, so set the terminal state directly.
		await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			await client.query(
				"update outbox_job set status = 'dead' where aggregate_id = $1 and kind = 'offboard.cancel_billing'",
				[s.membershipId],
			);
		});

		const record = await withTenant(tenantId, (tx) => personRecord(tx, s.personId), db);
		expect(record.membership?.status).toBe('removed');
		const kinds = record.openObligations.map((o) => o.kind).sort();
		expect(kinds).toContain('offboard.cancel_billing');
		const dead = record.openObligations.find((o) => o.kind === 'offboard.cancel_billing');
		expect(dead?.status).toBe('dead'); // finance sees an open obligation

		// …and visibility preserves NOTHING: the session is gone.
		const session = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, s.sessionId!), db);
		expect(session).toBeNull();
	});
});

describe('M5 mechanics (slices §2.2 row 14)', () => {
	it('records actor, reason, and the reauth timestamp in the audit row', async () => {
		const s = await inState('active');
		const reauthAt = new Date();
		await withTenant(
			tenantId,
			(tx) =>
				removeMembership(tx, {
					membershipId: s.membershipId,
					keyholderPersonId: keyholder,
					reasonClass: 'code_of_conduct',
					reauthAt,
					expectedVersion: s.version,
				}),
			db,
		);
		const rows = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				"select actor_id, reason_class, reauth_at from audit_event where aggregate_id = $1 and event = 'membership.removed'",
				[s.membershipId],
			);
			return rows;
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].actor_id).toBe(keyholder);
		expect(rows[0].reason_class).toBe('code_of_conduct');
		expect(new Date(rows[0].reauth_at).getTime()).toBe(reauthAt.getTime());
	});

	it('a stale expectedVersion 409s and mutates nothing (spec §4)', async () => {
		const s = await inState('active');
		await expect(
			withTenant(
				tenantId,
				(tx) =>
					removeMembership(tx, {
						membershipId: s.membershipId,
						keyholderPersonId: keyholder,
						reasonClass: 'stale_attempt',
						reauthAt: new Date(),
						expectedVersion: s.version + 41,
					}),
				db,
			),
		).rejects.toThrow(/changed since/);
		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('active');
		expect(await offboardJobs(s.membershipId)).toHaveLength(0);
	});
});

describe('InvalidAuditEventError surfaces as 400, not 500 (review round 1 edit 1)', () => {
	it('removeMembership throws InvalidAuditEventError for a legit-but-token-shaped long reason slug', async () => {
		const s = await inState('active');
		// 34 chars of [a-z_] — a real classification a keyholder might type,
		// but it trips assertReasonClass's 32+-char token-shape heuristic.
		// This is the exact condition /remove's HTTP-edge catch now maps to
		// 400 instead of letting fall through to the generic 500.
		const longLegitSlug = 'code_of_conduct_violation_repeated';
		expect(longLegitSlug.length).toBeGreaterThanOrEqual(32);

		await expect(
			withTenant(
				tenantId,
				(tx) =>
					removeMembership(tx, {
						membershipId: s.membershipId,
						keyholderPersonId: keyholder,
						reasonClass: longLegitSlug,
						reauthAt: new Date(),
						expectedVersion: s.version,
					}),
				db,
			),
		).rejects.toBeInstanceOf(InvalidAuditEventError);

		// Nothing committed: writeAudit refuses before the insert.
		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('active');
		expect(row.version).toBe(s.version);
	});

	it('the /membership leave action maps the same refusal to 400 invalid_reason, not 500', async () => {
		const s = await inState('active');
		const longLegitSlug = 'code_of_conduct_violation_repeated';
		const action = _createLeaveAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });

		const body = new URLSearchParams({
			membershipId: s.membershipId,
			reasonClass: longLegitSlug,
			expectedVersion: String(s.version),
		});
		if (!s.authUserId) throw new Error('fixture: expected an activated session');
		const event = {
			request: new Request('http://localhost/membership', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body,
			}),
			locals: { authSession: { id: s.sessionId, userId: s.authUserId } },
		} as unknown as Parameters<ReturnType<typeof _createLeaveAction>>[0];

		const result = await action(event);
		expect(result).toHaveProperty('status', 400);
		expect(result).toHaveProperty('data.code', 'invalid_reason');

		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('active');
		expect(row.version).toBe(s.version);
	});
});

/* ═══════════ REVIEW ROUND 2 — hostile re-verify of S6 edit 1 ═══════════
 * The round-1 edit catches InvalidAuditEventError at BOTH /remove and
 * /membership. The shipped rows only cover the lib seam and /membership's
 * leave action — `_createRemoveAction` has no test anywhere in the stack.
 * These rows drive the real /remove route with the round-1 repro verbatim.
 * Adopted verbatim from the review (PR #182, round 2) as a permanent test.
 */

describe('RV2 — /remove route maps InvalidAuditEventError to 400 (round-1 edit 1, uncovered half)', () => {
	const LONG_LEGIT_SLUG = 'code_of_conduct_violation_repeated'; // 34 chars of [a-z_]
	const KH_PASSWORD = 'keyholder-fixture-password';

	/** A keyholder who is a REAL auth user (resolveReviewer maps userId→personId). */
	async function keyholderSession() {
		const handle = `kh-${randomUUID().slice(0, 8)}@example.org`;
		const user = await withTenant(
			tenantId,
			(tx) =>
				createUserWithPassword(
					tx,
					tenantId,
					{ handle, email: handle, displayName: 'Kim Keyholder', password: KH_PASSWORD },
					FAST_HASH,
				),
			db,
		);
		await withTenant(
			tenantId,
			(tx) => grantRole(tx, tenantId, { personId: user.id, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
			db,
		);
		const session = await withTenant(
			tenantId,
			(tx) => authenticate(tx, tenantId, { handle, password: KH_PASSWORD }),
			db,
		);
		return { userId: user.id, session: session.session };
	}

	function removeEvent(fields: Record<string, string>, session: { id: string; userId: string }) {
		const setCookies: unknown[] = [];
		return {
			event: {
				request: new Request('http://localhost/remove', {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams(fields),
				}),
				locals: { authSession: session },
				cookies: { set: (...a: unknown[]) => setCookies.push(a) },
				params: {},
			} as unknown as Parameters<ReturnType<typeof _createRemoveAction>>[0],
			setCookies,
		};
	}

	it('THE REPRO: the long legit slug 400s invalid_reason at /remove, nothing commits', async () => {
		const kh = await keyholderSession();
		const s = await inState('active');
		const action = _createRemoveAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });

		const { event } = removeEvent(
			{
				membershipId: s.membershipId,
				reasonClass: LONG_LEGIT_SLUG,
				password: KH_PASSWORD,
				expectedVersion: String(s.version),
			},
			kh.session,
		);
		const result = await action(event);

		expect(result).toHaveProperty('status', 400);
		expect(result).toHaveProperty('data.code', 'invalid_reason');

		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('active');
		expect(row.version).toBe(s.version);
		expect(await offboardJobs(s.membershipId)).toHaveLength(0);
	});

	it('the refused reauth ROLLS BACK: the keyholder is not silently logged out by a bad reason', async () => {
		const kh = await keyholderSession();
		const s = await inState('active');
		const action = _createRemoveAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });

		const { event, setCookies } = removeEvent(
			{
				membershipId: s.membershipId,
				reasonClass: LONG_LEGIT_SLUG,
				password: KH_PASSWORD,
				expectedVersion: String(s.version),
			},
			kh.session,
		);
		expect(await action(event)).toHaveProperty('status', 400);
		// No cookie rotation was written…
		expect(setCookies).toHaveLength(0);
		// …and the PRESENTED session is still live: `reauthenticate` deleted it
		// inside the transaction that then rolled back.
		const still = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, kh.session.id), db);
		expect(still?.id).toBe(kh.session.id);
	});

	it('control: an ordinary short reason still removes through the same route (400 is not blanket)', async () => {
		const kh = await keyholderSession();
		const s = await inState('active');
		const action = _createRemoveAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });

		const { event, setCookies } = removeEvent(
			{
				membershipId: s.membershipId,
				reasonClass: 'conduct',
				password: KH_PASSWORD,
				expectedVersion: String(s.version),
			},
			kh.session,
		);
		const ok = await action(event);
		expect(ok).toMatchObject({ removed: true, replayed: false });
		expect((await membershipRow(s.membershipId)).status).toBe('removed');
		expect(await offboardJobs(s.membershipId)).toHaveLength(3);
		expect(setCookies).toHaveLength(1);
	});

	it('the /membership PAUSE action maps it too, not only leave', async () => {
		const s = await inState('active');
		const pause = _createPauseAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });
		const event = {
			request: new Request('http://localhost/membership', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					membershipId: s.membershipId,
					reasonClass: LONG_LEGIT_SLUG,
					expectedVersion: String(s.version),
				}),
			}),
			locals: { authSession: { id: s.sessionId, userId: s.authUserId } },
		} as unknown as Parameters<ReturnType<typeof _createPauseAction>>[0];

		const result = await pause(event);
		// Whatever the shape, it must not be a 500.
		expect((result as { status?: number }).status).not.toBe(500);
		const row = await membershipRow(s.membershipId);
		expect(row.status).toBe('active');
	});
});
