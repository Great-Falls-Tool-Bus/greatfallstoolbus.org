/**
 * S5 integration rows (slices §1.7 acceptance; spec §10 "Auth/application"),
 * on the S1 fixture: real migrator run (0000-0008), real
 * `gftb_migrator`/`gftb_app` role split, FORCE RLS binding both.
 *
 *   - two keyholders claiming one application concurrently → one claim, one
 *     EXPLICIT conflict;
 *   - approve × withdraw race → exactly one terminal state, one conflict —
 *     asserted in BOTH orderings, plus truly concurrent;
 *   - stale `expectedVersion` → 409, mutates nothing;
 *   - non-keyholder refused; a keyholder whose grant was revoked mid-request
 *     (session already validated) refused in the same unit of work;
 *   - decline without a reason rejected — validator, function, route, CHECK;
 *   - structurally NO contribution column on claim or decision tables;
 *   - tour scheduling is state only: the outbox gains NOTHING (TIN-3440);
 *   - no claimed→approved edge on real rows;
 *   - claims and decisions immutable at the database — grant + trigger,
 *     partial-unique live claim, one decision per application.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { grantRole, revokeRole } from '../auth/roles';
import { AuthError } from '../auth/session';
import { _createClaimAction } from '../../../routes/(keyholder)/review/+page.server';
import { _createDeclineAction, _createScheduleTourAction } from '../../../routes/(keyholder)/review/[id]/+page.server';
import { _createWithdrawAction } from '../../../routes/apply/withdraw/+page.server';
import {
	ClaimConflictError,
	IllegalTransitionError,
	KEYHOLDER_ROLE,
	NotClaimantError,
	claimApplication,
	listReviewQueue,
	scheduleTour,
} from './claim';
import {
	DECISION_EMAIL_JOB_KIND,
	WITHDRAWN_ACK_JOB_KIND,
	approveApplication,
	declineApplication,
	withdrawApplication,
} from './decide';
import { VersionConflictError, submitApplication, validateSubmission, verifyEmail } from './intake';
import { mintToken } from './tokens';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;
let previousTenantId: string | undefined;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

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
	previousTenantId = process.env.GFTB_TENANT_ID;
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	if (previousTenantId === undefined) delete process.env.GFTB_TENANT_ID;
	else process.env.GFTB_TENANT_ID = previousTenantId;
	await pool?.end();
	await fixture?.stop();
});

beforeEach(() => {
	delete process.env.GFTB_TENANT_ID;
});

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s5-${randomUUID().slice(0, 8)}`);
}

/** Grant a fresh person the keyholder role; returns their person id. */
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

/** Submit one application; returns its row (status `submitted`, v1). */
async function submitted(tenantId: string) {
	const result = await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
	return result.application;
}

/** Submit + verify (status `email_verified`, v2). */
async function verified(tenantId: string) {
	const app = await submitted(tenantId);
	const minted = await withTenant(
		tenantId,
		(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
		db,
	);
	return withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
}

/** Submit + verify + claim by `keyholder` (status `claimed`, v3). */
async function claimed(tenantId: string, keyholder: string) {
	const app = await verified(tenantId);
	const result = await withTenant(
		tenantId,
		(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
		db,
	);
	return result.application;
}

/** …+ tour scheduled by the claimant (status `tour_scheduled`, v4). */
async function tourScheduled(tenantId: string, keyholder: string) {
	const app = await claimed(tenantId, keyholder);
	return withTenant(tenantId, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db);
}

async function appRow(tenantId: string, applicationId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query('select id, status, version from application where id = $1', [applicationId]);
		return rows[0];
	});
}

async function outboxKinds(tenantId: string, applicationId: string): Promise<string[]> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query('select kind from outbox_job where aggregate_id = $1 order by created_at', [
			applicationId,
		]);
		return rows.map((r) => r.kind as string);
	});
}

async function decisionRows(tenantId: string, applicationId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			'select id, decision, decided_by, reason_class, note from application_decision where application_id = $1',
			[applicationId],
		);
		return rows;
	});
}

/** Minimal RequestEvent with a pre-validated session — the route seam. */
function reviewEvent(fields: Record<string, string>, personId: string | null, params: Record<string, string> = {}) {
	const body = new URLSearchParams(fields);
	return {
		request: new Request('http://localhost/review', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		locals: { authSession: personId ? { userId: personId } : null },
		params,
	} as unknown as Parameters<ReturnType<typeof _createClaimAction>>[0] &
		Parameters<ReturnType<typeof _createDeclineAction>>[0] &
		Parameters<ReturnType<typeof _createScheduleTourAction>>[0];
}

describe('A4 claim — one keyholder at a time, visibly (slices §2.2 row 4; spec §6)', () => {
	it('a keyholder claims a verified application: claim row + status + version bump', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);

		const result = await withTenant(
			tenantId,
			(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(result.application.status).toBe('claimed');
		expect(result.application.version).toBe(3);
		expect(result.claim.keyholderPersonId).toBe(keyholder);
		expect(result.claim.releasedAt).toBeNull();
	});

	it('two keyholders claiming concurrently: one claim, one EXPLICIT conflict (S5 acceptance row 1)', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await verified(tenantId);

		const outcomes = await Promise.allSettled([
			withTenant(tenantId, (tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: alice }), db),
			withTenant(tenantId, (tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		]);

		const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
		const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toBeInstanceOf(ClaimConflictError);

		const claims = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				'select keyholder_person_id from application_claim where application_id = $1',
				[app.id],
			);
			return rows;
		});
		expect(claims).toHaveLength(1);
	});

	it('a repeat claim by the SAME keyholder converges on the original result — spec §6 duplicate-request contract (review round 1, H1)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);

		const first = await withTenant(
			tenantId,
			(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(first.claimed).toBe(true);

		// Row 4's idempotency key is `…:claim:<keyholder_id>` — the SAME
		// keyholder retrying (double-click, network retry) is a duplicate of
		// their own request, not a conflict.
		const repeat = await withTenant(
			tenantId,
			(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(repeat.claimed).toBe(false);
		expect(repeat.claim.id).toBe(first.claim.id);
		expect(repeat.application.version).toBe(first.application.version);

		const claims = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select id from application_claim where application_id = $1', [app.id]);
			return rows;
		});
		expect(claims).toHaveLength(1);
	});

	it('a repeat claim by a DIFFERENT keyholder while one stands is still an explicit conflict', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await claimed(tenantId, alice);

		await expect(
			withTenant(tenantId, (tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		).rejects.toBeInstanceOf(ClaimConflictError);
	});

	it("RV2: the H1 convergence is reachable through the ROUTE with the shipped form's hidden expectedVersion (review round 2)", async () => {
		// The real `/review` form posts a hidden `expectedVersion` carrying the
		// PRE-claim version — exactly what a double-click or back-button
		// resubmit re-sends. Round 1 checked expectedVersion before the H1
		// convergence, so this exact path 409'd instead of converging (proved
		// identical at the pre-fix commit by review round 2). The fix reorders
		// the checks; this test drives the real route action with the STALE
		// version the form would actually carry and asserts it now converges.
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);
		const action = _createClaimAction();

		const first = await action(reviewEvent({ applicationId: app.id }, keyholder));
		expect(first).toMatchObject({ claimed: true });
		const staleVersion = app.version; // the pre-claim version, as the hidden field would still show

		const repeat = await action(
			reviewEvent({ applicationId: app.id, expectedVersion: String(staleVersion) }, keyholder),
		);
		expect(repeat).toMatchObject({ claimed: false, replayed: true, applicationId: app.id });
	});

	it('the claim is VISIBLE to other keyholders in the queue (claim semantics)', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await claimed(tenantId, alice);

		const queue = await withTenant(tenantId, (tx) => listReviewQueue(tx, bert), db);
		const entry = queue.find((e) => e.application.id === app.id);
		expect(entry).toBeDefined();
		expect(entry?.claim?.keyholderPersonId).toBe(alice);
	});

	it('a non-keyholder is refused, mutating nothing (S5 acceptance row 4)', async () => {
		const tenantId = await newTenant();
		const app = await verified(tenantId);

		await expect(
			withTenant(
				tenantId,
				(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: randomUUID() }),
				db,
			),
		).rejects.toThrowError(AuthError);
		expect((await appRow(tenantId, app.id)).status).toBe('email_verified');
	});

	it('a grant revoked mid-request — session already validated — is refused in the SAME unit of work', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);
		const action = _createClaimAction();

		// The "session" was validated when the request arrived; the revocation
		// commits between that and the action's transaction. Because the grant
		// check rides the action's own unit of work (spec §6), it sees the
		// revocation and refuses.
		await withTenant(tenantId, (tx) => revokeRole(tx, tenantId, keyholder, KEYHOLDER_ROLE), db);
		const refused = await action(reviewEvent({ applicationId: app.id }, keyholder));
		expect(refused).toHaveProperty('status', 403);
		expect(refused).toHaveProperty('data', { code: 'not_keyholder' });
		expect((await appRow(tenantId, app.id)).status).toBe('email_verified');
	});

	it('claim from submitted (unverified) is an illegal transition', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await submitted(tenantId);

		await expect(
			withTenant(tenantId, (tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db),
		).rejects.toThrowError(IllegalTransitionError);
	});

	it('a stale expectedVersion 409s and mutates nothing (S5 acceptance row 3)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);

		await expect(
			withTenant(
				tenantId,
				(tx) => claimApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, expectedVersion: 99 }),
				db,
			),
		).rejects.toThrowError(VersionConflictError);

		const row = await appRow(tenantId, app.id);
		expect(row.status).toBe('email_verified');
		expect(row.version).toBe(2);
		const claims = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select id from application_claim where application_id = $1', [app.id]);
			return rows;
		});
		expect(claims).toHaveLength(0);
	});

	it('the partial unique index refuses a second LIVE claim at the SQL level (spec §6 mechanism)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);

		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(
					'insert into application_claim (tenant_id, application_id, keyholder_person_id) values ($1, $2, $3)',
					[tenantId, app.id, randomUUID()],
				),
			),
		).rejects.toThrow(/application_claim_live_uniq/);
	});
});

describe('A5 schedule_tour — state, not automation (slices §2.2 row 5; TIN-3440)', () => {
	it('the claimant schedules the tour and the OUTBOX GAINS NOTHING', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);
		const kindsBefore = await outboxKinds(tenantId, app.id);

		const updated = await withTenant(
			tenantId,
			(tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(updated.status).toBe('tour_scheduled');
		expect(updated.version).toBe(4);
		// The tour is arranged by ordinary email: no job, no notification, no
		// calendar — the absence is the asserted property.
		expect(await outboxKinds(tenantId, app.id)).toEqual(kindsBefore);
	});

	it('a keyholder who is NOT the claimant may not schedule', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await claimed(tenantId, alice);

		await expect(
			withTenant(tenantId, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		).rejects.toThrowError(NotClaimantError);
		expect((await appRow(tenantId, app.id)).status).toBe('claimed');
	});

	it('a repeat schedule_tour by the claimant converges (spec §6 duplicate-request contract, same family as H1)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);

		const first = await withTenant(
			tenantId,
			(tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(first.status).toBe('tour_scheduled');

		const repeat = await withTenant(
			tenantId,
			(tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(repeat.status).toBe('tour_scheduled');
		expect(repeat.version).toBe(first.version);
	});

	it("RV2: schedule_tour convergence is reachable through the ROUTE with the shipped form's hidden expectedVersion (review round 2)", async () => {
		// Same reachability gap as claim's H1, same fix: the real detail-page
		// form posts a hidden expectedVersion carrying the pre-schedule_tour
		// version. Drive the real route action with that stale value.
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);
		const action = _createScheduleTourAction();

		const first = await action(reviewEvent({ expectedVersion: String(app.version) }, keyholder, { id: app.id }));
		expect(first).toMatchObject({ tourScheduled: true, status: 'tour_scheduled' });

		// The repeat still carries the STALE (pre-schedule_tour) version, as
		// the hidden field would on a double-click or back-button resubmit —
		// before the fix this 409'd (version_conflict); it now converges.
		const repeat = await action(reviewEvent({ expectedVersion: String(app.version) }, keyholder, { id: app.id }));
		expect(repeat).toMatchObject({ tourScheduled: true, status: 'tour_scheduled' });
	});

	it('a repeat schedule_tour by a NON-claimant while tour_scheduled is still refused', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await claimed(tenantId, alice);
		await withTenant(tenantId, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: alice }), db);

		await expect(
			withTenant(tenantId, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		).rejects.toThrowError(NotClaimantError);
	});

	it('scheduling an unclaimed application is an illegal transition', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await verified(tenantId);

		await expect(
			withTenant(tenantId, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db),
		).rejects.toThrowError(IllegalTransitionError);
	});
});

describe('A6/A7 decisions — one keyholder, after the tour, with receipts (slices §2.2 rows 6-7)', () => {
	it('approve from tour_scheduled: decision row, status, decision_email — one unit of work', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);

		const result = await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, note: 'great tour' }),
			db,
		);
		expect(result.decided).toBe(true);
		expect(result.application.status).toBe('approved');
		expect(result.application.version).toBe(5);
		expect(result.decision.decision).toBe('approved');
		expect(result.decision.decidedBy).toBe(keyholder);

		expect(await outboxKinds(tenantId, app.id)).toEqual(['application.receipt_email', DECISION_EMAIL_JOB_KIND]);
		const jobs = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				'select payload, idempotency_key from outbox_job where aggregate_id = $1 and kind = $2',
				[app.id, DECISION_EMAIL_JOB_KIND],
			);
			return rows;
		});
		// Identity key, no client segment; payload carries the id ONLY (S3
		// payload doctrine — no reason, no address, no decision detail).
		expect(jobs[0].idempotency_key).toBe(`${tenantId}:application:${app.id}:decision_email`);
		expect(Object.keys(jobs[0].payload as object)).toEqual(['applicationId']);
	});

	it('there is NO claimed→approved edge: the tour must have happened (spec §4)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);

		await expect(
			withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db),
		).rejects.toThrowError(IllegalTransitionError);
		expect((await appRow(tenantId, app.id)).status).toBe('claimed');
		expect(await decisionRows(tenantId, app.id)).toHaveLength(0);
	});

	it.each([
		['claimed', claimed],
		['tour_scheduled', tourScheduled],
	])('decline from %s records the reason and enqueues the receipt', async (_label, arrange) => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await arrange(tenantId, keyholder);

		const result = await withTenant(
			tenantId,
			(tx) => declineApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, reasonClass: 'capacity' }),
			db,
		);
		expect(result.application.status).toBe('declined');
		expect(result.decision.reasonClass).toBe('capacity');
		expect(await outboxKinds(tenantId, app.id)).toContain(DECISION_EMAIL_JOB_KIND);
	});

	it('decline without a reason is rejected at the function AND the route (S5 acceptance row 6)', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);

		await expect(
			withTenant(
				tenantId,
				(tx) => declineApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, reasonClass: ' ' }),
				db,
			),
		).rejects.toThrow(/reasonClass/);

		const action = _createDeclineAction();
		const refused = await action(reviewEvent({ reasonClass: '' }, keyholder, { id: app.id }));
		expect(refused).toHaveProperty('status', 400);
		expect(refused).toHaveProperty('data', { code: 'invalid', fields: ['reasonClass'] });
		expect((await appRow(tenantId, app.id)).status).toBe('claimed');
		expect(await decisionRows(tenantId, app.id)).toHaveLength(0);
	});

	it('a keyholder who is NOT the claimant may not decide', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await tourScheduled(tenantId, alice);

		await expect(
			withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		).rejects.toThrowError(NotClaimantError);
		await expect(
			withTenant(
				tenantId,
				(tx) => declineApplication(tx, { applicationId: app.id, keyholderPersonId: bert, reasonClass: 'x' }),
				db,
			),
		).rejects.toThrowError(NotClaimantError);
	});

	it('a duplicate approve by the same keyholder converges on the original result (spec §6)', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);

		const first = await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		const replay = await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		expect(first.decided).toBe(true);
		expect(replay.decided).toBe(false);
		expect(replay.decision.id).toBe(first.decision.id);
		expect(await decisionRows(tenantId, app.id)).toHaveLength(1);
		expect((await outboxKinds(tenantId, app.id)).filter((k) => k === DECISION_EMAIL_JOB_KIND)).toHaveLength(1);
	});

	it('a DIFFERENT keyholder repeating the decision conflicts instead of converging', async () => {
		const tenantId = await newTenant();
		const [alice, bert] = [await newKeyholder(tenantId), await newKeyholder(tenantId)];
		const app = await tourScheduled(tenantId, alice);

		await withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: alice }), db);
		await expect(
			withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: bert }), db),
		).rejects.toThrowError(IllegalTransitionError);
	});

	it('a stale expectedVersion on approve 409s and mutates nothing', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);

		await expect(
			withTenant(
				tenantId,
				(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder, expectedVersion: 99 }),
				db,
			),
		).rejects.toThrowError(VersionConflictError);
		const row = await appRow(tenantId, app.id);
		expect(row.status).toBe('tour_scheduled');
		expect(row.version).toBe(4);
		expect(await decisionRows(tenantId, app.id)).toHaveLength(0);
		expect(await outboxKinds(tenantId, app.id)).toEqual(['application.receipt_email']);
	});
});

describe('A8 withdraw and the approve×withdraw race (slices §2.2 row 8; spec §4)', () => {
	async function withdrawToken(tenantId: string, applicationId: string): Promise<string> {
		const minted = await withTenant(tenantId, (tx) => mintToken(tx, { applicationId, purpose: 'withdraw' }), db);
		return minted.token;
	}

	it('withdraw works from submitted — BEFORE verification (row 8: token, not verified-address)', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		const token = await withdrawToken(tenantId, app.id);

		const updated = await withTenant(tenantId, (tx) => withdrawApplication(tx, { token }), db);
		expect(updated.status).toBe('withdrawn');
		expect(await outboxKinds(tenantId, app.id)).toContain(WITHDRAWN_ACK_JOB_KIND);
	});

	it('withdraw works from tour_scheduled, and the claim row survives as history', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		const token = await withdrawToken(tenantId, app.id);

		const updated = await withTenant(tenantId, (tx) => withdrawApplication(tx, { token }), db);
		expect(updated.status).toBe('withdrawn');
		const claims = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				'select keyholder_person_id from application_claim where application_id = $1',
				[app.id],
			);
			return rows;
		});
		expect(claims).toHaveLength(1);
	});

	it('ordering 1 — approve commits first: withdraw 409s, token survives the rollback', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		const token = await withdrawToken(tenantId, app.id);

		await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		await expect(withTenant(tenantId, (tx) => withdrawApplication(tx, { token }), db)).rejects.toThrowError(
			IllegalTransitionError,
		);

		expect((await appRow(tenantId, app.id)).status).toBe('approved');
		// The losing transaction rolled back its token consumption: the token
		// row is still unconsumed (the S4 expectedVersion precedent).
		const tokens = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(
				`select consumed_at from application_email_token where application_id = $1 and purpose = 'withdraw'`,
				[app.id],
			);
			return rows;
		});
		expect(tokens[0].consumed_at).toBeNull();
		expect(await outboxKinds(tenantId, app.id)).not.toContain(WITHDRAWN_ACK_JOB_KIND);
	});

	it('ordering 2 — withdraw commits first: approve 409s, no decision row, no decision email', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		const token = await withdrawToken(tenantId, app.id);

		await withTenant(tenantId, (tx) => withdrawApplication(tx, { token }), db);
		await expect(
			withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db),
		).rejects.toThrowError(IllegalTransitionError);

		expect((await appRow(tenantId, app.id)).status).toBe('withdrawn');
		expect(await decisionRows(tenantId, app.id)).toHaveLength(0);
		expect(await outboxKinds(tenantId, app.id)).not.toContain(DECISION_EMAIL_JOB_KIND);
	});

	it('truly concurrent approve × withdraw: exactly one terminal transition commits', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		const token = await withdrawToken(tenantId, app.id);

		const outcomes = await Promise.allSettled([
			withTenant(tenantId, (tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }), db),
			withTenant(tenantId, (tx) => withdrawApplication(tx, { token }), db),
		]);

		const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
		expect(fulfilled).toHaveLength(1);
		const finalStatus = (await appRow(tenantId, app.id)).status;
		expect(['approved', 'withdrawn']).toContain(finalStatus);
		// Exactly one receipt fanned out — the winner's.
		const kinds = await outboxKinds(tenantId, app.id);
		const receipts = kinds.filter((k) => k === DECISION_EMAIL_JOB_KIND || k === WITHDRAWN_ACK_JOB_KIND);
		expect(receipts).toHaveLength(1);
	});

	it('the withdraw route: confirm-POST consumes; replay and unknown tokens share one 400; decided → 409', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const action = _createWithdrawAction();

		const app = await verified(tenantId);
		const token = await withdrawToken(tenantId, app.id);
		const ok = await action(reviewEvent({ token }, null));
		expect(ok).toEqual({ withdrawn: true });

		const replayed = await action(reviewEvent({ token }, null));
		const unknown = await action(reviewEvent({ token: 'never-minted' }, null));
		expect(replayed).toHaveProperty('status', 400);
		expect(JSON.stringify(unknown)).toBe(JSON.stringify(replayed));

		// A valid token on a decided application: the 409 shape.
		const keyholder = await newKeyholder(tenantId);
		const decided = await tourScheduled(tenantId, keyholder);
		const decidedToken = await withdrawToken(tenantId, decided.id);
		await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: decided.id, keyholderPersonId: keyholder }),
			db,
		);
		const conflicted = await action(reviewEvent({ token: decidedToken }, null));
		expect(conflicted).toHaveProperty('status', 409);
		expect(conflicted).toHaveProperty('data', { code: 'not_withdrawable' });
	});
});

describe('database-enforced review lifecycle — grant + trigger, not convention (0008 hand-written half)', () => {
	it('a decision row is immutable: UPDATE and DELETE are refused, owner included', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);
		const [decision] = await decisionRows(tenantId, app.id);

		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(`update application_decision set decision = 'declined' where id = $1`, [decision.id]),
			),
		).rejects.toThrow(/denied|immutable/i);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query('delete from application_decision where id = $1', [decision.id]),
			),
		).rejects.toThrow(/denied|append-only|never deleted/i);
		// The trigger binds the table OWNER too, not only the runtime grant.
		await expect(
			asTenant(fixture.migratorDsn, tenantId, (client) =>
				client.query(`update application_decision set reason_class = 'rewritten' where id = $1`, [decision.id]),
			),
		).rejects.toThrow(/immutable/i);
	});

	it('the CHECK refuses a declined decision with no reason at the SQL level', async () => {
		const tenantId = await newTenant();
		const app = await submitted(tenantId);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(
					`insert into application_decision (tenant_id, application_id, decision, decided_by)
					 values ($1, $2, 'declined', $3)`,
					[tenantId, app.id, randomUUID()],
				),
			),
		).rejects.toThrow(/application_decision_declined_reason/);
	});

	it('one decision per application, by constraint', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await tourScheduled(tenantId, keyholder);
		await withTenant(
			tenantId,
			(tx) => approveApplication(tx, { applicationId: app.id, keyholderPersonId: keyholder }),
			db,
		);

		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(
					`insert into application_decision (tenant_id, application_id, decision, decided_by)
					 values ($1, $2, 'approved', $3)`,
					[tenantId, app.id, randomUUID()],
				),
			),
		).rejects.toThrow(/application_decision_one_per_application/);
	});

	it('a claim row admits exactly one write — released_at, once, one-way', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const app = await claimed(tenantId, keyholder);
		const claimId = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query('select id from application_claim where application_id = $1', [app.id]);
			return rows[0].id as string;
		});

		// Any column but released_at: refused (column grant + trigger).
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query('update application_claim set keyholder_person_id = $1 where id = $2', [randomUUID(), claimId]),
			),
		).rejects.toThrow(/denied|immutable/i);
		// DELETE: refused.
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query('delete from application_claim where id = $1', [claimId]),
			),
		).rejects.toThrow(/denied|append-only|never deleted/i);
		// released_at NULL → NOT NULL: the one legal write (operator path).
		await asTenant(fixture.runtimeDsn, tenantId, (client) =>
			client.query('update application_claim set released_at = now() where id = $1', [claimId]),
		);
		// A released claim is immutable — release is one-way.
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query('update application_claim set released_at = now() where id = $1', [claimId]),
			),
		).rejects.toThrow(/immutable/i);
	});

	it('structurally: neither review table has a contribution/payment column (TIN-3440)', async () => {
		const tenantId = await newTenant();
		for (const table of ['application_claim', 'application_decision']) {
			const columns = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				const { rows } = await client.query<{ column_name: string }>(
					`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
					[table],
				);
				return rows.map((r) => r.column_name);
			});
			expect(columns.length).toBeGreaterThan(0);
			for (const column of columns) {
				expect(column).not.toMatch(/contrib|payment|stripe|amount|rail|donat/i);
			}
		}
	});

	it('cross-tenant: a claim in tenant A is invisible and unclaimable from tenant B (RLS)', async () => {
		const tenantA = await newTenant();
		const tenantB = await newTenant();
		const keyholderA = await newKeyholder(tenantA);
		const keyholderB = await newKeyholder(tenantB);
		const app = await claimed(tenantA, keyholderA);

		const queueB = await withTenant(tenantB, (tx) => listReviewQueue(tx, keyholderB), db);
		expect(queueB.find((e) => e.application.id === app.id)).toBeUndefined();
		await expect(
			withTenant(tenantB, (tx) => scheduleTour(tx, { applicationId: app.id, keyholderPersonId: keyholderB }), db),
		).rejects.toThrow();
	});
});
