/**
 * S4 integration rows (slices §1.6 acceptance; spec §10 "Auth/application"),
 * on the S1 fixture: real migrator run (0000-0004), real
 * `gftb_migrator`/`gftb_app` role split, FORCE RLS binding both.
 *
 *   - same non-enumerating response for a known address as for a fresh one;
 *   - duplicate `Idempotency-Key` returns the original receipt, no second
 *     application;
 *   - exceeding the rate limit returns 429 with one constant body, address
 *     known or not;
 *   - token flow on real rows: hash at rest, single-use under replay,
 *     expiry, wrong purpose, cross-tenant invisibility;
 *   - `expectedVersion` conflict mutates nothing;
 *   - the database's own enforcement: no DELETE, no token mutation, no
 *     un-consume — trigger + column-grant, not convention;
 *   - structurally NO contribution column on the application table.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { _createApplyAction } from '../../../routes/apply/+page.server';
import { _createVerifyAction } from '../../../routes/apply/verify/+page.server';
import {
	PUBLIC_RECEIPT,
	RECEIPT_EMAIL_JOB_KIND,
	VersionConflictError,
	submitApplication,
	validateSubmission,
	verifyEmail,
} from './intake';
import { createRateLimiter } from './ratelimit';
import { TokenRejectedError, hashToken, mintToken } from './tokens';

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

	// Point the app's own pool at the DML-only runtime credential so the route
	// actions' default `withTenant` runs as `gftb_app`, the way `web` will.
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

/** A fresh RLS-isolated world per test. */
async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s4-${randomUUID().slice(0, 8)}`);
}

function submission(overrides: Record<string, unknown> = {}) {
	return validateSubmission({
		displayName: 'Alex Applicant',
		email: `applicant-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'woodworking; can staff intake',
		tourAvailability: 'weekday evenings',
		disclosures: 'none',
		ageAttested: true,
		...overrides,
	});
}

async function applicationRows(tenantId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select id, status, email, version, submission_idempotency_key,
			        age_attested_at, age_attestation_version, email_verified_at
			   from application order by created_at`,
		);
		return rows;
	});
}

async function outboxRows(tenantId: string) {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(
			`select kind, aggregate_type, aggregate_id, payload, idempotency_key from outbox_job order by created_at`,
		);
		return rows;
	});
}

/** Build a minimal SvelteKit RequestEvent for driving the real actions. */
function postEvent(fields: Record<string, string>, clientAddress = '203.0.113.7') {
	const body = new URLSearchParams(fields);
	return {
		request: new Request('http://localhost/apply', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		getClientAddress: () => clientAddress,
	} as unknown as Parameters<ReturnType<typeof _createApplyAction>>[0];
}

function formFields(overrides: Record<string, string> = {}): Record<string, string> {
	return {
		displayName: 'Alex Applicant',
		email: `route-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'woodworking',
		tourAvailability: 'weekends',
		disclosures: 'none',
		ageAttested: 'on',
		...overrides,
	};
}

describe('A2 submit — idempotent, receipt-enqueueing, non-enumerating (slices §2.2 row 2)', () => {
	it('creates the row and the immediate receipt job in one unit of work', async () => {
		const tenantId = await newTenant();
		const result = await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);

		expect(result.created).toBe(true);
		expect(result.application.status).toBe('submitted');
		expect(result.application.version).toBe(1);
		expect(result.application.ageAttestationVersion).toBe('1');
		expect(result.application.ageAttestedAt).toBeInstanceOf(Date);

		const jobs = await outboxRows(tenantId);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].kind).toBe(RECEIPT_EMAIL_JOB_KIND);
		expect(jobs[0].aggregate_type).toBe('application');
		expect(jobs[0].aggregate_id).toBe(result.application.id);
		// The payload carries the aggregate id ONLY — no address, no token
		// (S3 payload doctrine): the mail handler reads the row itself.
		expect(Object.keys(jobs[0].payload as object)).toEqual(['applicationId']);
		expect(jobs[0].idempotency_key).toBe(
			`${tenantId}:application:${result.application.id}:receipt_email:${result.application.submissionIdempotencyKey}`,
		);
	});

	it('an address that already has an application gets the same result as a fresh one (no existence oracle)', async () => {
		const tenantId = await newTenant();
		const email = `repeat-${randomUUID().slice(0, 8)}@example.org`;

		const first = await withTenant(tenantId, (tx) => submitApplication(tx, submission({ email })), db);
		const second = await withTenant(tenantId, (tx) => submitApplication(tx, submission({ email })), db);

		// Both succeed identically — created, version 1, submitted — and both
		// map to the SAME constant public receipt; two rows now stand.
		expect(second.created).toBe(first.created);
		expect(second.application.status).toBe(first.application.status);
		expect(PUBLIC_RECEIPT).toEqual({ received: true });
		expect((await applicationRows(tenantId)).filter((r) => r.email === email)).toHaveLength(2);
	});

	it('a duplicate Idempotency-Key returns the original receipt and creates no second application', async () => {
		const tenantId = await newTenant();
		const key = `client-key-${randomUUID().slice(0, 8)}`;
		const email = `idem-${randomUUID().slice(0, 8)}@example.org`;

		const first = await withTenant(
			tenantId,
			(tx) => submitApplication(tx, submission({ email, idempotencyKey: key })),
			db,
		);
		const replay = await withTenant(
			tenantId,
			(tx) => submitApplication(tx, submission({ email, idempotencyKey: key })),
			db,
		);

		expect(first.created).toBe(true);
		expect(replay.created).toBe(false);
		expect(replay.application.id).toBe(first.application.id);
		expect(await applicationRows(tenantId)).toHaveLength(1);
		expect(await outboxRows(tenantId)).toHaveLength(1);
	});

	it('structurally: the application table has no contribution/payment column (TIN-3440)', async () => {
		const columns = await asTenant(fixture.runtimeDsn, await newTenant(), async (client) => {
			const { rows } = await client.query<{ column_name: string }>(
				`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'application'`,
			);
			return rows.map((r) => r.column_name);
		});
		expect(columns.length).toBeGreaterThan(0);
		for (const column of columns) {
			expect(column).not.toMatch(/contrib|payment|stripe|amount|rail|donat/i);
		}
	});
});

describe('the /apply action — 429 and constant bodies at the HTTP shape (S4 acceptance row 6)', () => {
	it('exceeding the rate limit returns 429 with one body, whether or not the address is known', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const action = _createApplyAction({
			open: () => true,
			limiter: createRateLimiter({ max: 2, windowMs: 60_000 }),
		});

		const knownEmail = `known-${randomUUID().slice(0, 8)}@example.org`;
		const ok1 = await action(postEvent(formFields({ email: knownEmail })));
		const ok2 = await action(postEvent(formFields()));
		expect('receipt' in ok1 && ok1.receipt).toEqual({ received: true });
		expect('receipt' in ok2 && ok2.receipt).toEqual({ received: true });

		// Third from the same caller: denied — fresh address.
		const deniedFresh = await action(postEvent(formFields()));
		// Fourth: denied — an address that ALREADY has an application.
		const deniedKnown = await action(postEvent(formFields({ email: knownEmail })));

		for (const denied of [deniedFresh, deniedKnown]) {
			expect(denied).toHaveProperty('status', 429);
			expect(denied).toHaveProperty('data', { code: 'rate_limited' });
		}
		// Byte-identical refusals: no field distinguishes known from unknown.
		expect(JSON.stringify(deniedKnown)).toBe(JSON.stringify(deniedFresh));
		// Only the two allowed submissions landed.
		expect(await applicationRows(tenantId)).toHaveLength(2);
	});

	it('success maps to the constant PUBLIC_RECEIPT for fresh and known addresses alike', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const action = _createApplyAction({ open: () => true, limiter: createRateLimiter({ max: 100, windowMs: 1000 }) });

		const email = `same-${randomUUID().slice(0, 8)}@example.org`;
		const first = await action(postEvent(formFields({ email })));
		const again = await action(postEvent(formFields({ email })));
		expect(JSON.stringify(again)).toBe(JSON.stringify(first));
	});

	it('while intake is closed (operator has not opened it at launch) the action refuses 503 before any work', async () => {
		const action = _createApplyAction({ limiter: createRateLimiter({ max: 1, windowMs: 1000 }) });
		const refused = await action(postEvent(formFields()));
		expect(refused).toHaveProperty('status', 503);
		expect(refused).toHaveProperty('data', { code: 'intake_closed' });
	});
});

describe('A3 verify_email — tokens on real rows (slices §2.2 row 3; S4 acceptance rows 1-3)', () => {
	async function submitted(tenantId: string) {
		return withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
	}

	it('stores only the hash, and consuming moves submitted → email_verified with a version bump', async () => {
		const tenantId = await newTenant();
		const { application: app } = await submitted(tenantId);

		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);
		expect(minted.row.tokenHash).toBe(hashToken(minted.token));
		expect(minted.row.tokenHash).not.toBe(minted.token);
		expect(minted.row.expiresAt).toBeInstanceOf(Date);

		const verified = await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
		expect(verified.status).toBe('email_verified');
		expect(verified.emailVerifiedAt).toBeInstanceOf(Date);
		expect(verified.version).toBe(2);
	});

	it('a replayed token is rejected uniformly and mutates nothing', async () => {
		const tenantId = await newTenant();
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);
		await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);

		await expect(withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db)).rejects.toThrowError(
			TokenRejectedError,
		);

		const rows = await applicationRows(tenantId);
		expect(rows[0].status).toBe('email_verified');
		expect(rows[0].version).toBe(2);
	});

	it('an expired token is rejected and the application stays submitted', async () => {
		const tenantId = await newTenant();
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email', ttlMs: -1 }),
			db,
		);

		await expect(withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db)).rejects.toThrowError(
			TokenRejectedError,
		);
		expect((await applicationRows(tenantId))[0].status).toBe('submitted');
	});

	it('a withdraw token cannot verify an email (wrong purpose, same refusal)', async () => {
		const tenantId = await newTenant();
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'withdraw' }),
			db,
		);
		expect(minted.row.expiresAt).toBeNull();

		await expect(withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db)).rejects.toThrowError(
			TokenRejectedError,
		);
	});

	it('a token minted in tenant A is invisible — and unconsumable — under tenant B (RLS)', async () => {
		const tenantA = await newTenant();
		const tenantB = await newTenant();
		const { application: app } = await submitted(tenantA);
		const minted = await withTenant(
			tenantA,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);

		await expect(withTenant(tenantB, (tx) => verifyEmail(tx, { token: minted.token }), db)).rejects.toThrowError(
			TokenRejectedError,
		);
		expect((await applicationRows(tenantA))[0].status).toBe('submitted');
	});

	it('a stale expectedVersion 409s and mutates nothing (spec §4)', async () => {
		const tenantId = await newTenant();
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);

		await expect(
			withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token, expectedVersion: 99 }), db),
		).rejects.toThrowError(VersionConflictError);
		const rows = await applicationRows(tenantId);
		expect(rows[0].status).toBe('submitted');
		expect(rows[0].version).toBe(1);
		// The failed transaction rolled back the token consumption too: the
		// SAME token still works — nothing was mutated by the conflict.
		const verified = await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
		expect(verified.status).toBe('email_verified');
	});

	it('the verify route action maps refusals to one 400 body and success to verified', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);
		const action = _createVerifyAction({ limiter: createRateLimiter({ max: 100, windowMs: 1000 }) });

		const ok = await action(postEvent({ token: minted.token }));
		expect(ok).toEqual({ verified: true });

		const replayed = await action(postEvent({ token: minted.token }));
		const unknown = await action(postEvent({ token: 'never-minted' }));
		expect(replayed).toHaveProperty('status', 400);
		expect(JSON.stringify(unknown)).toBe(JSON.stringify(replayed));
	});

	it('exceeding the rate limit on /apply/verify returns 429 before any token is parsed (edit 2)', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const { application: app } = await submitted(tenantId);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);
		const action = _createVerifyAction({ limiter: createRateLimiter({ max: 1, windowMs: 60_000 }) });

		const ok = await action(postEvent({ token: minted.token }));
		expect(ok).toEqual({ verified: true });

		// Second call from the same caller: denied before the (garbage) token
		// is even read — a valid-shaped token and a nonsense one refuse
		// byte-identically once the caller is over budget.
		const deniedValidShape = await action(postEvent({ token: minted.token }));
		const deniedNonsense = await action(postEvent({ token: 'not-a-real-token' }));
		for (const denied of [deniedValidShape, deniedNonsense]) {
			expect(denied).toHaveProperty('status', 429);
			expect(denied).toHaveProperty('data', { code: 'rate_limited' });
		}
		expect(JSON.stringify(deniedValidShape)).toBe(JSON.stringify(deniedNonsense));
	});

	it('log capture across the full submit→mint→consume path: the plaintext appears nowhere', async () => {
		const captured: string[] = [];
		const record = (...args: unknown[]) => {
			captured.push(args.map(String).join(' '));
			return true;
		};
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(record),
		);
		try {
			const tenantId = await newTenant();
			const { application: app } = await submitted(tenantId);
			const minted = await withTenant(
				tenantId,
				(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
				db,
			);
			await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
			try {
				await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);
			} catch {
				// the replay refusal is the interesting log surface
			}
			for (const line of captured) expect(line).not.toContain(minted.token);
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});

describe('database-enforced lifecycle — grant + trigger, not convention (0007 hand-written half)', () => {
	it('the runtime role cannot DELETE an application (retention is a ratification gate)', async () => {
		const tenantId = await newTenant();
		await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) => client.query('delete from application')),
		).rejects.toThrow(/denied|never deleted/i);
	});

	it('the runtime role cannot rewrite a token row — only consumed_at, only once, only forward', async () => {
		const tenantId = await newTenant();
		const { application: app } = await withTenant(tenantId, (tx) => submitApplication(tx, submission()), db);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: app.id, purpose: 'verify_email' }),
			db,
		);

		// Any column but consumed_at: refused by the column-level grant.
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(`update application_email_token set token_hash = 'forged' where id = $1`, [minted.row.id]),
			),
		).rejects.toThrow(/denied/i);

		await withTenant(tenantId, (tx) => verifyEmail(tx, { token: minted.token }), db);

		// Un-consume: refused by the single-use trigger, table owner included.
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(`update application_email_token set consumed_at = null where id = $1`, [minted.row.id]),
			),
		).rejects.toThrow(/immutable|denied/i);
		// Delete: refused by the trigger.
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(`delete from application_email_token where id = $1`, [minted.row.id]),
			),
		).rejects.toThrow(/denied|never deleted|append-only/i);
	});

	it('the status CHECK admits only the ratified FSM states — draft cannot be persisted', async () => {
		const tenantId = await newTenant();
		await expect(
			asTenant(fixture.runtimeDsn, tenantId, (client) =>
				client.query(
					`insert into application (tenant_id, status, display_name, email, interests_help_offer,
					   tour_availability, disclosures, age_attested_at, age_attestation_version, submission_idempotency_key)
					 values ($1, 'draft', 'n', 'n@example.org', 'x', 'x', 'x', now(), '1', $2)`,
					[tenantId, randomUUID()],
				),
			),
		).rejects.toThrow(/application_status_fsm/);
	});
});
