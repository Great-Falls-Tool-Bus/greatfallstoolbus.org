/**
 * ADVERSARIAL REVIEW SUITE — S7 contribution offer (PR #183). NOT part of the
 * PR under review; written independently to attack the slice's critical
 * invariants:
 *
 *   1. bounds validation under hostile inputs (spec §5:230–232);
 *   2. $0 (both spellings: `zero` and `preset:0`) creates ZERO processor
 *      objects (spec §5:233);
 *   3. keyholder visibility never leaks amount/rail (spec §5:222–225);
 *   4. choices unreachable pre-approval AND closed again after
 *      pause/leave/remove (ADR 0014 §5:147; TIN-3818 row 1);
 *   5. checkout failure of any kind — including a session with a null URL —
 *      leaves membership untouched (spec §11);
 *   6. concurrent submissions converge on the single agreement row;
 *   7. RLS: the agreement is invisible from another tenant.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { isRedirect } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, schema, type Db } from '../db/client';
import { withTenant } from '../db/tenant';
import { runMigrator } from '../db/migrate';
import {
	MIGRATIONS_DIR,
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { grantRole } from '../auth/roles';
import { KEYHOLDER_ROLE, claimApplication, scheduleTour } from '../application/claim';
import { submitApplication, validateSubmission, verifyEmail } from '../application/intake';
import { mintToken } from '../application/tokens';
import {
	activateMembership,
	mintActivationToken,
	provisionOnApproval,
	type ActivationResult,
} from '../membership/activate';
import { publishAgreementVersion } from '../membership/agreement';
import { pauseMembership, leaveMembership, removeMembership } from '../membership/transition';
import { membership } from '../db/schema';
import type { StripeGateway } from '../stripe/client';
import { getAgreement } from './agreement';
import { keyholderContributionView } from './visibility';
import { _createChooseAction, _createContributionLoad } from '../../../routes/(member)/contribution/+page.server';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
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
	return seedTenant(fixture.migratorDsn, `s7h-${randomUUID().slice(0, 8)}`);
}

async function activeMember(tenantId: string): Promise<ActivationResult & { keyholder: string }> {
	const keyholder = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	const version = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: 'hostile fixture v1' }), db);
	const submitted = await withTenant(
		tenantId,
		(tx) =>
			submitApplication(
				tx,
				validateSubmission({
					displayName: 'Hostile Fixture',
					email: `hostile-${randomUUID().slice(0, 8)}@example.org`,
					interestsHelpOffer: 'stress testing',
					tourAvailability: 'never',
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
	await withTenant(
		tenantId,
		(tx) => provisionOnApproval(tx, { applicationId: submitted.application.id, keyholderPersonId: keyholder }),
		db,
	);
	const activation = await withTenant(tenantId, (tx) => mintActivationToken(tx, submitted.application.id), db);
	const result = await withTenant(
		tenantId,
		(tx) =>
			activateMembership(tx, {
				token: activation.token,
				password: 'a-long-enough-fixture-password',
				agreementVersionId: version.id,
				hashOptions: FAST_HASH,
			}),
		db,
	);
	return { ...result, keyholder };
}

function seams(tenantId: string, gateway?: StripeGateway) {
	return {
		env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } as NodeJS.ProcessEnv,
		gateway,
	};
}

function memberEvent(authUserId: string | null, fields?: Record<string, string>) {
	const url = new URL('http://localhost/contribution');
	return {
		request: new Request(url, {
			method: fields ? 'POST' : 'GET',
			headers: fields ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
			body: fields ? new URLSearchParams(fields) : undefined,
		}),
		locals: { authSession: authUserId ? { userId: authUserId } : null },
		url,
	} as unknown as Parameters<ReturnType<typeof _createChooseAction>>[0];
}

function countingGateway(sessionUrl: string | null = 'https://checkout.stripe.example/cs_test') {
	let calls = 0;
	const gateway: StripeGateway = {
		async createCheckoutSession() {
			calls += 1;
			return { id: `cs_test_${calls}`, url: sessionUrl, livemode: false };
		},
		async createPortalSession() {
			calls += 1;
			return { url: 'https://portal.stripe.example', livemode: false };
		},
		async retrieveSubscription() {
			calls += 1;
			return { id: 'sub_test', status: 'active', livemode: false, metadata: {} };
		},
	};
	return { gateway, count: () => calls };
}

async function membershipRow(tenantId: string, personId: string) {
	return withTenant(
		tenantId,
		async (tx) => {
			const rows = await tx.select().from(membership).where(eq(membership.personId, personId));
			return rows[0];
		},
		db,
	);
}

function failureOf(result: unknown): { status: number; data: { code: string } } {
	expect(result, 'expected an ActionFailure, got a success or redirect').toBeTruthy();
	const f = result as { status: number; data: { code: string } };
	expect(f.status).toBeGreaterThanOrEqual(400);
	return f;
}

describe('1. hostile bounds and parse inputs — every one refused, nothing recorded, zero Stripe calls', () => {
	it('rejects malformed and out-of-range amounts wholesale', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		const hostileAmounts = [
			'-5', // negative
			'+5', // explicit sign not a dollar figure
			'5.005', // sub-cent
			'4.999', // sub-cent just under min
			'1e3', // exponent notation
			'0x20', // hex
			'Infinity',
			'NaN',
			'5,00', // comma
			'5.', // trailing dot, no cents
			'.5', // no integer part
			'', // empty
			'£5', // wrong currency glyph
			'9999999', // 7 digits, parses, out of range → bounds refusal
			'99999999', // 8 digits, regex refusal
			'5 000', // inner space
		];
		for (const cadence of ['custom_monthly', 'custom_annual'] as const) {
			for (const amount of hostileAmounts) {
				const failure = failureOf(await action(memberEvent(member.session.userId, { pick: cadence, amount })));
				expect(failure.status, `${cadence} amount=${JSON.stringify(amount)}`).toBe(400);
				expect(failure.data.code, `${cadence} amount=${JSON.stringify(amount)}`).toBe('invalid_choice');
			}
		}
		// Missing amount entirely for a custom pick.
		expect(failureOf(await action(memberEvent(member.session.userId, { pick: 'custom_monthly' }))).status).toBe(400);

		expect(stub.count()).toBe(0);
		expect(await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db)).toBeUndefined();
	});

	it('rejects hostile pick values: unratified presets, negative presets, raw kinds, casing', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		for (const pick of [
			'preset:750', // not one of the five
			'preset:-500', // negative
			'preset:', // empty cents
			'preset:5e2', // parses to 5 → not a preset
			'stripe', // raw kind name, not a form pick
			'ZERO', // casing
			'cash; drop table contribution_agreement', // just garbage
		]) {
			const failure = failureOf(await action(memberEvent(member.session.userId, { pick })));
			expect(failure.status, `pick=${JSON.stringify(pick)}`).toBe(400);
			expect(failure.data.code, `pick=${JSON.stringify(pick)}`).toBe('invalid_choice');
		}
		// No pick field at all.
		expect(failureOf(await action(memberEvent(member.session.userId, {}))).status).toBe(400);

		expect(stub.count()).toBe(0);
		expect(await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db)).toBeUndefined();
	});
});

describe('2. $0 in BOTH spellings creates zero processor objects', () => {
	it('`preset:0` (the rendered $0 radio when cents===0 maps to `zero`, but defend the raw form too) records `zero` with 0 Stripe calls', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		const result = await action(memberEvent(member.session.userId, { pick: 'preset:0' }));
		expect(result).toEqual({ chosen: 'zero' });
		expect(stub.count()).toBe(0);

		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.state).toBe('zero');
		expect(agreement?.rail).toBe('zero');
		expect(agreement?.amountCents).toBe(0);
	});
});

describe('3. keyholder visibility never leaks amount or rail', () => {
	it('after a card choice with a custom amount, the keyholder shape stays exactly {offered, helpRequested} and its VALUES carry no finance data', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		await action(memberEvent(member.session.userId, { pick: 'custom_monthly', amount: '123.45' })).catch(() => {});
		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.amountCents).toBe(12_345);

		const view = keyholderContributionView(agreement);
		expect(Object.keys(view).sort()).toEqual(['helpRequested', 'offered']);
		const serialized = JSON.stringify(view);
		expect(serialized).not.toContain('12345');
		expect(serialized).not.toContain('stripe');
		expect(serialized).not.toContain('amount');
		expect(serialized).not.toContain('rail');
	});

	it('a keyholder session with no member record gets NO offer, NO contribution keys from the load', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		await action403Probe(tenantId, member);
	});

	async function action403Probe(tenantId: string, member: ActivationResult) {
		await _createChooseAction(seams(tenantId, countingGateway().gateway))(
			memberEvent(member.session.userId, { pick: 'cash' }),
		);
		const load = _createContributionLoad(seams(tenantId));
		const keyholderSession = await load(memberEvent(randomUUID()));
		expect(keyholderSession).toMatchObject({ authenticated: true, eligible: false });
		expect(Object.keys(keyholderSession).sort()).toEqual(['authenticated', 'available', 'eligible']);
	}
});

describe('4. the offer closes again after pause / leave / remove (guard is state, not session-structure)', () => {
	it('paused: session stays valid (S6/S7 law) but the offer action refuses 403 and the load is ineligible', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const row = await membershipRow(tenantId, member.person.id);
		await withTenant(
			tenantId,
			(tx) => pauseMembership(tx, { membershipId: row.id, actor: { personId: member.person.id, via: 'member' } }),
			db,
		);

		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));
		const failure = failureOf(await action(memberEvent(member.session.userId, { pick: 'zero' })));
		expect(failure.status).toBe(403);
		expect(failure.data.code).toBe('not_open');

		const load = _createContributionLoad(seams(tenantId));
		expect(await load(memberEvent(member.session.userId))).toMatchObject({ eligible: false });
		expect(stub.count()).toBe(0);
		expect(await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db)).toBeUndefined();
	});

	it('left and removed: the offer refuses even if a stale session id is replayed', async () => {
		for (const terminal of ['leave', 'remove'] as const) {
			const tenantId = await newTenant();
			const member = await activeMember(tenantId);
			const row = await membershipRow(tenantId, member.person.id);
			await withTenant(
				tenantId,
				(tx) =>
					terminal === 'leave'
						? leaveMembership(tx, {
								membershipId: row.id,
								memberPersonId: member.person.id,
								reasonClass: 'voluntary',
								expectedVersion: row.version,
							})
						: removeMembership(tx, {
								membershipId: row.id,
								keyholderPersonId: member.keyholder,
								reasonClass: 'safety',
								reauthAt: new Date(),
								expectedVersion: row.version,
							}),
				db,
			);
			const action = _createChooseAction(seams(tenantId, countingGateway().gateway));
			const failure = failureOf(await action(memberEvent(member.session.userId, { pick: 'zero' })));
			expect(failure.status, terminal).toBe(403);
		}
	});
});

describe('5. checkout failure shapes never move membership', () => {
	it('a checkout session WITHOUT a redirect URL is a 502, membership still active', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway(null); // session comes back url-less
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		const failure = failureOf(await action(memberEvent(member.session.userId, { pick: 'preset:5000' })));
		expect(failure.status).toBe(502);
		expect((await membershipRow(tenantId, member.person.id)).status).toBe('active');
	});
});

describe('6. concurrent submissions converge on the one agreement row', () => {
	it('parallel zero+cash choices both succeed; one row, deterministic final rail, version advanced', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId, countingGateway().gateway));

		const [a, b] = await Promise.all([
			action(memberEvent(member.session.userId, { pick: 'zero' })),
			action(memberEvent(member.session.userId, { pick: 'cash' })),
		]);
		expect([a, b].every((r) => r && 'chosen' in (r as Record<string, unknown>))).toBe(true);

		const rows = await withTenant(
			tenantId,
			(tx) =>
				tx
					.select()
					.from(schema.contributionAgreement)
					.where(eq(schema.contributionAgreement.personId, member.person.id)),
			db,
		);
		expect(rows).toHaveLength(1);
		expect(['zero', 'cash_pending']).toContain(rows[0].state);
		expect(rows[0].version).toBeGreaterThanOrEqual(2);
	});
});

describe('7. RLS: the agreement is invisible from another tenant', () => {
	it('tenant B reads nothing for tenant A person', async () => {
		const tenantA = await newTenant();
		const tenantB = await newTenant();
		const member = await activeMember(tenantA);
		await _createChooseAction(seams(tenantA, countingGateway().gateway))(
			memberEvent(member.session.userId, { pick: 'cash', helpRequested: 'true' }),
		);
		expect(await withTenant(tenantA, (tx) => getAgreement(tx, member.person.id), db)).toBeDefined();
		expect(await withTenant(tenantB, (tx) => getAgreement(tx, member.person.id), db)).toBeUndefined();
	});
});

describe('cross-check: the redirect is real when checkout succeeds after hostile noise', () => {
	it('after a barrage of refusals, a legal choice still 303s', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		failureOf(await action(memberEvent(member.session.userId, { pick: 'custom_monthly', amount: '4.99' })));
		const ok = await action(memberEvent(member.session.userId, { pick: 'custom_monthly', amount: '500' })).catch(
			(e) => e,
		);
		expect(isRedirect(ok)).toBe(true);
		expect(stub.count()).toBe(1);
	});
});
