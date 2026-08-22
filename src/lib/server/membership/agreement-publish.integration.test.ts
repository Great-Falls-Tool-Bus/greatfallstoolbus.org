/**
 * S13 integration rows for `/agreement/publish` (TIN-3440; the operator
 * agreement-publish route; register L73), on the S1/S6 fixture: real
 * migrator run (0000–0009), real `gftb_migrator`/`gftb_app` role split, real
 * append-only triggers.
 *
 *   - auth matrix: anonymous, an authenticated non-keyholder ("member"), a
 *     keyholder NOT on the operator allowlist, and an allowlisted keyholder;
 *   - fail-closed when `GFTB_OPERATOR_PERSON_IDS` is entirely unset — even a
 *     real keyholder is refused, distinct from "set but not listed";
 *   - a successful publish: the receipt shape, the session-rotation
 *     confirmation mechanic, and that a REFUSED confirmation (wrong
 *     password) rolls back without rotating the presented session (the
 *     `/remove` precedent, re-proved here);
 *   - the database itself refuses to UPDATE or DELETE `agreement_version`
 *     (trigger + REVOKE, migration 0009) — the append-only guarantee this
 *     route depends on, not merely asserted by this route's own code;
 *   - superseded-assent interplay: a version this route publishes behaves
 *     identically to one `publishAgreementVersion` calls directly —
 *     `requireCurrentAgreement` on the now-superseded id still 409s;
 *   - double-submit, two layers: the route's `expectedNextVersionId` stale
 *     check (the common sequential case) and the database's own primary key
 *     deciding a TRUE concurrent race (`AgreementVersionRaceError`).
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
import { authenticate, createUserWithPassword, validateSession, type AuthSession } from '../auth';
import { KEYHOLDER_ROLE } from '../application/claim';
import { intakeOpen } from '../application/attestation';
import {
	AgreementVersionRaceError,
	agreementBodySha256,
	previewNextAgreementVersionId,
	publishAgreementVersion,
	requireCurrentAgreement,
	SupersededAgreementError,
} from './agreement';
import { _createPublishAction, _createPublishLoad } from '../../../routes/(operator)/agreement/publish/+page.server';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;
let previousTenantId: string | undefined;

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

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s13-${randomUUID().slice(0, 8)}`);
}

/** A real auth user with a live session and NO role grant — the "member" row. */
async function newMemberSession(tenantId: string): Promise<{ userId: string; session: AuthSession }> {
	const handle = `mem-${randomUUID().slice(0, 8)}@example.org`;
	const user = await withTenant(
		tenantId,
		(tx) =>
			createUserWithPassword(
				tx,
				tenantId,
				{ handle, email: handle, displayName: 'M. Ember', password: PASSWORD },
				FAST_HASH,
			),
		db,
	);
	const authed = await withTenant(tenantId, (tx) => authenticate(tx, tenantId, { handle, password: PASSWORD }), db);
	return { userId: user.id, session: authed.session };
}

/** A real auth user, `keyholder`-granted, with a live session. */
async function newKeyholderSession(
	tenantId: string,
): Promise<{ userId: string; handle: string; session: AuthSession }> {
	const handle = `kh-${randomUUID().slice(0, 8)}@example.org`;
	const user = await withTenant(
		tenantId,
		(tx) =>
			createUserWithPassword(
				tx,
				tenantId,
				{ handle, email: handle, displayName: 'Kim Keyholder', password: PASSWORD },
				FAST_HASH,
			),
		db,
	);
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: user.id, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	const authed = await withTenant(tenantId, (tx) => authenticate(tx, tenantId, { handle, password: PASSWORD }), db);
	return { userId: user.id, handle, session: authed.session };
}

function requestEvent(fields: Record<string, string>, session: AuthSession | null) {
	const setCookies: unknown[] = [];
	return {
		event: {
			request: new Request('http://localhost/agreement/publish', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams(fields),
			}),
			locals: { authSession: session },
			getClientAddress: () => '203.0.113.9',
			cookies: { set: (...a: unknown[]) => setCookies.push(a) },
			params: {},
		} as unknown as Parameters<ReturnType<typeof _createPublishAction>>[0],
		setCookies,
	};
}

function loadEvent(session: AuthSession | null) {
	return {
		locals: { authSession: session },
		params: {},
	} as unknown as Parameters<ReturnType<typeof _createPublishLoad>>[0];
}

async function agreementVersionRows(tenantId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query('select id, body, body_sha256 from agreement_version order by id');
		return rows;
	});
}

describe('/agreement/publish — auth matrix (load)', () => {
	it('anonymous: available, not authenticated, not authorized', async () => {
		const tenantId = await newTenant();
		const load = _createPublishLoad({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });
		const result = await load(loadEvent(null));
		expect(result).toEqual({ available: true, authenticated: false, authorized: false, nextVersionId: null });
	});

	it('an authenticated non-keyholder ("member"): authenticated, but not authorized', async () => {
		const tenantId = await newTenant();
		const member = await newMemberSession(tenantId);
		const load = _createPublishLoad({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: member.userId },
		});
		const result = await load(loadEvent(member.session));
		expect(result).toEqual({ available: true, authenticated: true, authorized: false, nextVersionId: null });
	});

	it('a keyholder NOT on the operator allowlist: authenticated, but not authorized', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const load = _createPublishLoad({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: randomUUID() },
		});
		const result = await load(loadEvent(kh.session));
		expect(result).toEqual({ available: true, authenticated: true, authorized: false, nextVersionId: null });
	});

	it('an allowlisted keyholder: authorized, with the preview version number', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const load = _createPublishLoad({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const result = await load(loadEvent(kh.session));
		expect(result).toEqual({ available: true, authenticated: true, authorized: true, nextVersionId: 1 });
	});

	it('fail-closed when GFTB_OPERATOR_PERSON_IDS is entirely UNSET — even a real keyholder', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const { GFTB_OPERATOR_PERSON_IDS: _unset, ...rest } = process.env;
		const env = { ...rest, GFTB_TENANT_ID: tenantId };
		const load = _createPublishLoad({ env });
		const result = await load(loadEvent(kh.session));
		expect(result.authorized).toBe(false);
	});
});

describe('/agreement/publish — auth matrix (action)', () => {
	function form(expectedNextVersionId: number) {
		return {
			body: 'The membership agreement, v1.',
			confirm: 'on',
			password: PASSWORD,
			expectedNextVersionId: String(expectedNextVersionId),
		};
	}

	it('anonymous → 401 not_authenticated', async () => {
		const tenantId = await newTenant();
		const action = _createPublishAction({ env: { ...process.env, GFTB_TENANT_ID: tenantId } });
		const { event } = requestEvent(form(1), null);
		const result = await action(event);
		expect(result).toMatchObject({ status: 401, data: { code: 'not_authenticated' } });
	});

	it('an authenticated non-keyholder → 403 not_keyholder, nothing published', async () => {
		const tenantId = await newTenant();
		const member = await newMemberSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: member.userId },
		});
		const { event } = requestEvent(form(1), member.session);
		const result = await action(event);
		expect(result).toMatchObject({ status: 403, data: { code: 'not_keyholder' } });
		expect(await agreementVersionRows(tenantId)).toHaveLength(0);
	});

	it('a keyholder NOT on the allowlist → 403 not_operator, nothing published', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: randomUUID() },
		});
		const { event } = requestEvent(form(1), kh.session);
		const result = await action(event);
		expect(result).toMatchObject({ status: 403, data: { code: 'not_operator' } });
		expect(await agreementVersionRows(tenantId)).toHaveLength(0);
	});

	it('GFTB_OPERATOR_PERSON_IDS unset → 403 not_operator for a real keyholder too', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const { GFTB_OPERATOR_PERSON_IDS: _unset, ...rest } = process.env;
		const env = { ...rest, GFTB_TENANT_ID: tenantId };
		const action = _createPublishAction({ env });
		const { event } = requestEvent(form(1), kh.session);
		const result = await action(event);
		expect(result).toMatchObject({ status: 403, data: { code: 'not_operator' } });
	});

	it('an allowlisted keyholder publishes: the receipt is version 1 with a correct digest', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const body = 'The membership agreement, exact text.';
		const { event, setCookies } = requestEvent({ ...form(1), body }, kh.session);
		const result = await action(event);
		expect(result).toMatchObject({ published: true, version: 1, bodySha256: agreementBodySha256(body) });
		expect(result).toHaveProperty('effectiveFrom', expect.any(String));
		// Confirmation rotated the session: a fresh cookie was written…
		expect(setCookies).toHaveLength(1);
		// …and the ORIGINAL presented session is dead.
		const still = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, kh.session.id), db);
		expect(still).toBeNull();

		const rows = await agreementVersionRows(tenantId);
		expect(rows).toEqual([{ id: 1, body, body_sha256: agreementBodySha256(body) }]);
	});

	it('a WRONG password refuses the confirmation and rolls back — the presented session survives (the /remove precedent)', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const { event, setCookies } = requestEvent({ ...form(1), password: 'wrong password entirely' }, kh.session);
		const result = await action(event);
		expect(result).toMatchObject({ status: 401, data: { code: 'bad_credentials' } });
		expect(setCookies).toHaveLength(0);
		const still = await withTenant(tenantId, (tx) => validateSession(tx, tenantId, kh.session.id), db);
		expect(still?.id).toBe(kh.session.id);
		expect(await agreementVersionRows(tenantId)).toHaveLength(0);
	});

	it('missing confirmation checkbox refuses without ever opening a transaction', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const fields = form(1) as Record<string, string>;
		delete fields.confirm;
		const { event } = requestEvent(fields, kh.session);
		const result = await action(event);
		expect(result).toMatchObject({ status: 400, data: { code: 'confirmation_required' } });
		expect(await agreementVersionRows(tenantId)).toHaveLength(0);
	});
});

describe('/agreement/publish — publishing does not touch intake', () => {
	it('a successful publish leaves intakeOpen() exactly as it was before', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const before = intakeOpen();

		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const { event } = requestEvent(
			{ body: 'text', confirm: 'on', password: PASSWORD, expectedNextVersionId: '1' },
			kh.session,
		);
		const result = await action(event);
		expect(result).toMatchObject({ published: true });

		// intakeOpen() is a pure function of the AGE_ATTESTATION_TEXT module
		// constant (src/lib/server/application/attestation.ts) — a source edit,
		// never a consequence of an agreement_version row. Publishing above did
		// not and cannot move it.
		expect(intakeOpen()).toBe(before);
	});
});

describe('the database enforces agreement_version append-only (migration 0009 trigger + REVOKE)', () => {
	it('the runtime role cannot UPDATE a published version', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'v1' }), db);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				await client.query("update agreement_version set body = 'rewritten' where id = 1");
			}),
		).rejects.toThrow(/append-only|permission denied/i);
	});

	it('the runtime role cannot DELETE a published version', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'v1' }), db);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, async (client) => {
				await client.query('delete from agreement_version where id = 1');
			}),
		).rejects.toThrow(/append-only|permission denied/i);
		expect(await agreementVersionRows(tenantId)).toHaveLength(1);
	});
});

describe('superseded-assent interplay: a route-published version behaves exactly like a direct one', () => {
	it('publishing v2 through the route supersedes v1 for requireCurrentAgreement, identically to a direct publishAgreementVersion call', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const v1 = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'v1 text' }), db);

		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const { event } = requestEvent(
			{ body: 'v2 text', confirm: 'on', password: PASSWORD, expectedNextVersionId: '2' },
			kh.session,
		);
		const result = await action(event);
		expect(result).toMatchObject({ published: true, version: 2 });

		await expect(withTenant(tenantId, (tx) => requireCurrentAgreement(tx, v1.id), db)).rejects.toBeInstanceOf(
			SupersededAgreementError,
		);
		const current = await withTenant(tenantId, (tx) => requireCurrentAgreement(tx, 2), db);
		expect(current.id).toBe(2);
	});
});

describe('double-submit safety', () => {
	it('layer 1 — sequential double-submit through the ACTION: the second carries a now-stale expectedNextVersionId and 409s, no second row', async () => {
		const tenantId = await newTenant();
		const kh = await newKeyholderSession(tenantId);
		const action = _createPublishAction({
			env: { ...process.env, GFTB_TENANT_ID: tenantId, GFTB_OPERATOR_PERSON_IDS: kh.userId },
		});
		const fields = { body: 'text', confirm: 'on', password: PASSWORD, expectedNextVersionId: '1' };

		const first = await action(requestEvent(fields, kh.session).event);
		expect(first).toMatchObject({ published: true, version: 1 });

		// The SAME stale form, resubmitted (double-click / back-button replay).
		// The first request's reauth already rotated the session, so a literal
		// second POST carrying the OLD session id would 401 on `reauthenticate`
		// itself (a dead session, per the /remove precedent proved above) —
		// that is a real, separate refusal, but it would mask the row this test
		// exists to prove. Re-authenticate the SAME underlying user for the
		// second POST, matching what a real double-click actually does: the
		// browser resends the ORIGINAL form fields (same stale
		// expectedNextVersionId, same password) against whatever session
		// cookie is live at send time.
		const authed = await withTenant(
			tenantId,
			(tx) => authenticate(tx, tenantId, { handle: kh.handle, password: PASSWORD }),
			db,
		);
		const second = await action(requestEvent(fields, authed.session).event);
		expect(second).toMatchObject({ status: 409, data: { code: 'stale_preview', nextVersionId: 2 } });

		expect(await agreementVersionRows(tenantId)).toHaveLength(1);
	});

	it('layer 2 — TRUE concurrent race at the lib level: exactly one publish wins, the loser gets AgreementVersionRaceError, one row exists', async () => {
		const tenantId = await newTenant();
		// A naive `Promise.allSettled` of two independent `withTenant` calls is
		// NOT a reliable race on a fast local Postgres (trust auth, unix
		// socket): transaction A can complete its entire SELECT-max+INSERT+COMMIT
		// lifecycle before transaction B's first query is even dispatched, so
		// both simply compute DIFFERENT next ids sequentially — no race, no
		// failure, and a green test that proves nothing. (First draft of this
		// test did exactly that and both fulfilled with ids 1 and 2.)
		//
		// Force the race deterministically instead, using the REAL
		// `publishAgreementVersion` on both sides: hold transaction A open
		// (uncommitted, after its own insert) for well longer than a local
		// round trip, so transaction B's insert of the SAME computed id is
		// GUARANTEED to reach the database while A's row is still only
		// tentative — Postgres blocks B's insert on A's row lock, then B's
		// `ON CONFLICT DO NOTHING` resolves the conflict the moment A commits.
		const outcomes = await Promise.allSettled([
			withTenant(
				tenantId,
				async (tx) => {
					const result = await publishAgreementVersion(tx, { body: 'race A' });
					await new Promise((resolve) => setTimeout(resolve, 150));
					return result;
				},
				db,
			),
			(async () => {
				// A head start for A: by the time this fires, A has already
				// computed next_id=1 and inserted (tentatively) — B's own
				// SELECT max(id) below is what must land on the SAME value.
				await new Promise((resolve) => setTimeout(resolve, 20));
				return withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'race B' }), db);
			})(),
		]);
		const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
		const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0].reason).toBeInstanceOf(AgreementVersionRaceError);

		const rows = await agreementVersionRows(tenantId);
		expect(rows).toHaveLength(1);
	});

	it('publishing the SAME body twice on purpose (correct, non-stale previews) is NOT deduplicated — two distinct versions, per decisions/0018 item 3', async () => {
		const tenantId = await newTenant();
		const body = 'Identical text, published twice on purpose.';
		const v1 = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body }), db);
		const preview = await withTenant(tenantId, (tx) => previewNextAgreementVersionId(tx), db);
		expect(preview).toBe(2);
		const v2 = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body }), db);

		expect(v1.id).toBe(1);
		expect(v2.id).toBe(2);
		expect(v1.bodySha256).toBe(v2.bodySha256);
		const rows = await agreementVersionRows(tenantId);
		expect(rows).toHaveLength(2);
	});
});
