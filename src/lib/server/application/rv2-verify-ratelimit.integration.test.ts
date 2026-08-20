/**
 * REVIEW ROUND 2 — hostile re-verify of S4 edit 2 (/apply/verify rate limit).
 * Adopted from the review (PR #180, round 2) as a permanent test.
 *
 * The round-1 row proves the 429 shape through an INJECTED limiter seam
 * (`_createVerifyAction({ limiter: … })`). That does not prove the DEFAULT
 * wiring — `export const actions = { default: _createVerifyAction() }` —
 * actually consults the real process-wide `intakeRateLimiter`. This file
 * attacks the default construction with no seams at all, the way the
 * deployed route is built.
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
import { _createApplyAction } from '../../../routes/apply/+page.server';
import { _createVerifyAction } from '../../../routes/apply/verify/+page.server';
import { submitApplication, validateSubmission } from './intake';
import { INTAKE_RATE_LIMIT_MAX, intakeRateLimiter } from './ratelimit';
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
	intakeRateLimiter.reset();
});

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `rv2-${randomUUID().slice(0, 8)}`);
}

function postEvent(fields: Record<string, string>, clientAddress: string) {
	return {
		request: new Request('http://localhost/apply/verify', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields),
		}),
		getClientAddress: () => clientAddress,
	} as unknown as Parameters<ReturnType<typeof _createVerifyAction>>[0];
}

function statusOf(r: unknown): number | undefined {
	return (r as { status?: number }).status;
}

async function tokenRowCount(tenantId: string): Promise<number> {
	return asTenant(fixture.runtimeDsn, tenantId, async (client) => {
		const { rows } = await client.query(`select count(*)::int as n from application_email_token`);
		return rows[0].n as number;
	});
}

describe('RV2 — /apply/verify default wiring is really rate-limited', () => {
	it('the no-seams action (exactly how the route builds it) 429s after the real budget', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		// NO SEAMS — identical construction to `actions.default`.
		const action = _createVerifyAction();
		const caller = '198.51.100.11';

		const statuses: (number | undefined)[] = [];
		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX + 15; i += 1) {
			statuses.push(statusOf(await action(postEvent({ token: `guess-${i}` }, caller))));
		}

		// The first MAX POSTs get past the limiter (and are refused 400 as bad
		// tokens); everything after is a constant 429.
		expect(statuses.slice(0, INTAKE_RATE_LIMIT_MAX)).toEqual(Array.from({ length: INTAKE_RATE_LIMIT_MAX }, () => 400));
		expect(statuses.slice(INTAKE_RATE_LIMIT_MAX)).toEqual(Array.from({ length: 15 }, () => 429));
	});

	it('the 429 is keyed by CALLER, not global: a second address still has its full budget', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const action = _createVerifyAction();

		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX + 5; i += 1) {
			await action(postEvent({ token: `x-${i}` }, '198.51.100.22'));
		}
		expect(statusOf(await action(postEvent({ token: 'x' }, '198.51.100.22')))).toBe(429);
		expect(statusOf(await action(postEvent({ token: 'x' }, '198.51.100.33')))).toBe(400);
	});

	it('the denial precedes every DB touch: a VALID live token survives the flood unconsumed', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const { application } = await withTenant(
			tenantId,
			(tx) =>
				submitApplication(
					tx,
					validateSubmission({
						displayName: 'Alex Applicant',
						email: `rv2-${randomUUID().slice(0, 8)}@example.org`,
						interestsHelpOffer: 'woodworking',
						tourAvailability: 'weekends',
						disclosures: 'none',
						ageAttested: true,
					}),
				),
			db,
		);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: application.id, purpose: 'verify_email' }),
			db,
		);

		const action = _createVerifyAction();
		const caller = '198.51.100.44';
		// Burn the budget on garbage.
		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX; i += 1) {
			await action(postEvent({ token: `junk-${i}` }, caller));
		}

		// Now present the REAL token while over budget: refused 429, and the
		// token must still be live (nothing was parsed, nothing consumed).
		const denied = await action(postEvent({ token: minted.token }, caller));
		expect(statusOf(denied)).toBe(429);
		expect((denied as { data?: unknown }).data).toEqual({ code: 'rate_limited' });

		const consumed = await asTenant(fixture.runtimeDsn, tenantId, async (client) => {
			const { rows } = await client.query(`select consumed_at from application_email_token`);
			return rows.map((r) => r.consumed_at);
		});
		expect(consumed).toEqual([null]);

		// From a fresh caller the same token still verifies — proof the flood
		// neither consumed nor invalidated it.
		expect(await action(postEvent({ token: minted.token }, '198.51.100.55'))).toEqual({
			verified: true,
		});
	});

	it('the 429 outranks the 503: over budget with NO tenant/DSN configured still refuses 429', async () => {
		const action = _createVerifyAction();
		const caller = '198.51.100.66';
		delete process.env.GFTB_TENANT_ID; // would otherwise be a 503
		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX; i += 1) {
			expect(statusOf(await action(postEvent({ token: 'x' }, caller)))).toBe(503);
		}
		expect(statusOf(await action(postEvent({ token: 'x' }, caller)))).toBe(429);
	});

	it('over-budget refusals are byte-identical for a real token and for garbage (no oracle)', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const { application } = await withTenant(
			tenantId,
			(tx) =>
				submitApplication(
					tx,
					validateSubmission({
						displayName: 'Alex Applicant',
						email: `rv2-${randomUUID().slice(0, 8)}@example.org`,
						interestsHelpOffer: 'woodworking',
						tourAvailability: 'weekends',
						disclosures: 'none',
						ageAttested: true,
					}),
				),
			db,
		);
		const minted = await withTenant(
			tenantId,
			(tx) => mintToken(tx, { applicationId: application.id, purpose: 'verify_email' }),
			db,
		);
		const action = _createVerifyAction();
		const caller = '198.51.100.77';
		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX; i += 1) {
			await action(postEvent({ token: `junk-${i}` }, caller));
		}
		const real = await action(postEvent({ token: minted.token }, caller));
		const fake = await action(postEvent({ token: 'nope' }, caller));
		const missing = await action(postEvent({}, caller));
		expect(JSON.stringify(real)).toBe(JSON.stringify(fake));
		expect(JSON.stringify(real)).toBe(JSON.stringify(missing));
	});

	it('CONSEQUENCE: the bucket is SHARED with /apply — a verify flood locks out the caller’s own submit', async () => {
		const tenantId = await newTenant();
		process.env.GFTB_TENANT_ID = tenantId;
		const verify = _createVerifyAction();
		// `open: () => true` only lifts the sitting-2 intake gate, which /apply
		// checks BEFORE the limiter; the limiter itself stays the real
		// process-wide `intakeRateLimiter` singleton — that sharing is the point.
		const apply = _createApplyAction({ open: () => true });
		const caller = '198.51.100.88';
		for (let i = 0; i < INTAKE_RATE_LIMIT_MAX; i += 1) {
			await verify(postEvent({ token: `junk-${i}` }, caller));
		}
		const submitted = await apply(
			postEvent(
				{
					displayName: 'Alex Applicant',
					email: `rv2-${randomUUID().slice(0, 8)}@example.org`,
					interestsHelpOffer: 'woodworking',
					tourAvailability: 'weekends',
					disclosures: 'none',
					ageAttested: 'on',
				},
				caller,
			) as never,
		);
		expect(statusOf(submitted)).toBe(429);
		// No application row was created by the locked-out submit.
		expect(await tokenRowCount(tenantId)).toBe(0);
	});
});
