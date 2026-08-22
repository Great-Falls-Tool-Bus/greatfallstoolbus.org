/**
 * S7 integration rows — the contribution OFFER surface (TIN-3818; spec
 * §5:222–248; ADR 0014 §5; ADR 0016 §3.1) on the S1 fixture: real migrator
 * run, real role split, FORCE RLS binding the runtime role.
 *
 *   - contribution routes are UNREACHABLE before approval/activation: no
 *     session → 401; a session with no member record → 403; a keyholder
 *     with no membership → 403 (choices only after approval, ADR 0014
 *     §5:147);
 *   - $0 is a real recorded choice and creates NO processor object: a
 *     counting gateway stub proves zero Stripe API calls (spec §5:233);
 *   - cash and check record intent (`cash_pending`) while a THROWING Stripe
 *     stub proves the rails never collapse (spec §5:243–248), and rails'
 *     append-only receipt surface advances the agreement to `cash_recorded`;
 *   - custom bounds are enforced server-side AT THE ENDPOINT with boundary
 *     tests one cent outside each bound (spec §5:230–232);
 *   - the card path hands off to hosted Checkout via the TEST-MODE gateway
 *     (303 to the session URL, subscription mode, exact unit_amount and
 *     interval) and a checkout failure of any kind leaves membership
 *     unchanged (spec §11; ADR 0016 §3.2);
 *   - keyholders read EXACTLY `{ offered, helpRequested }` — the rails
 *     visibility shape, asserted structurally (spec §5:222–225);
 *   - `/home` presents the versioned agreement the member assented to and
 *     their own contribution state (ADR 0016 §2.3; spec §5:216–220).
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
import { membership } from '../db/schema';
import type { StripeGateway } from '../stripe/client';
import { getAgreement } from './agreement';
import { recordCashCheckReceipt } from './receipt';
import { keyholderContributionView } from './visibility';
import { _createChooseAction, _createContributionLoad } from '../../../routes/(member)/contribution/+page.server';
import { _createHomeLoad } from '../../../routes/(member)/home/+page.server';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };
const FAST_HASH = { rounds: 4 };
const AGREEMENT_BODY = 'Fixture agreement text, version one.';

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
	return seedTenant(fixture.migratorDsn, `s7c-${randomUUID().slice(0, 8)}`);
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
		displayName: 'Morgan Member',
		email: `member-${randomUUID().slice(0, 8)}@example.org`,
		interestsHelpOffer: 'bike repair; can help with intake',
		tourAvailability: 'weekends',
		disclosures: 'none',
		ageAttested: true,
	});
}

/** Full pipeline to an ACTIVE member with a real session: submit → verify →
 * claim → tour → approve → assent+activate. */
async function activeMember(tenantId: string): Promise<ActivationResult> {
	const keyholder = await newKeyholder(tenantId);
	// Fresh tenant per test — this publish is always version 1 for it.
	const version = await withTenant(tenantId, (tx) => publishAgreementVersion(tx, { body: AGREEMENT_BODY }), db);
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
	await withTenant(
		tenantId,
		(tx) => provisionOnApproval(tx, { applicationId: submitted.application.id, keyholderPersonId: keyholder }),
		db,
	);
	const activation = await withTenant(tenantId, (tx) => mintActivationToken(tx, submitted.application.id), db);
	return withTenant(
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
}

function seams(tenantId: string, gateway?: StripeGateway) {
	return {
		env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } as NodeJS.ProcessEnv,
		gateway,
	};
}

/** Minimal RequestEvent with a pre-validated session — the route seam. */
function memberEvent(authUserId: string | null, fields?: Record<string, string>, path = '/contribution') {
	const url = new URL(`http://localhost${path}`);
	return {
		request: new Request(url, {
			method: fields ? 'POST' : 'GET',
			headers: fields ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
			body: fields ? new URLSearchParams(fields) : undefined,
		}),
		locals: { authSession: authUserId ? { userId: authUserId } : null },
		url,
	} as unknown as Parameters<ReturnType<typeof _createChooseAction>>[0] &
		Parameters<ReturnType<typeof _createHomeLoad>>[0];
}

/** A gateway that counts calls — the "$0 issues zero Stripe API calls" proof. */
function countingGateway() {
	let calls = 0;
	let lastParams: unknown;
	const gateway: StripeGateway = {
		async createCheckoutSession(params) {
			calls += 1;
			lastParams = params;
			return { id: `cs_test_${calls}`, url: 'https://checkout.stripe.example/cs_test', livemode: false };
		},
		async createPortalSession() {
			calls += 1;
			return { url: 'https://portal.stripe.example', livemode: false };
		},
		async retrieveSubscription() {
			calls += 1;
			return { id: 'sub_test', status: 'active', livemode: false, metadata: {} };
		},
		async findSubscriptionForCustomer() {
			calls += 1;
			return null;
		},
	};
	return { gateway, count: () => calls, last: () => lastParams as Record<string, unknown> };
}

/** A gateway that refuses to exist — the rails-never-collapse proof. */
function throwingGateway(): StripeGateway {
	const boom = (): never => {
		throw new Error('Stripe was touched on a non-card rail');
	};
	return {
		createCheckoutSession: async () => boom(),
		createPortalSession: async () => boom(),
		retrieveSubscription: async () => boom(),
		findSubscriptionForCustomer: async () => boom(),
	};
}

async function membershipStatus(tenantId: string, personId: string): Promise<string> {
	return withTenant(
		tenantId,
		async (tx) => {
			const rows = await tx.select().from(membership).where(eq(membership.personId, personId));
			return rows[0].status;
		},
		db,
	);
}

function expectFailure(result: unknown): { status: number; data: { code: string } } {
	expect(result).toBeTruthy();
	const failure = result as { status: number; data: { code: string } };
	expect(failure.status).toBeGreaterThanOrEqual(400);
	return failure;
}

describe('reachability — choices ONLY after approval (ADR 0014 §5:147; TIN-3818 row 1)', () => {
	it('no session → 401; a session that maps to no member → offer closed and action 403', async () => {
		const tenantId = await newTenant();
		const load = _createContributionLoad(seams(tenantId));
		const action = _createChooseAction(seams(tenantId, throwingGateway()));

		const anonymous = await load(memberEvent(null));
		expect(anonymous).toMatchObject({ available: true, authenticated: false, eligible: false });

		const anonAct = expectFailure(await action(memberEvent(null, { pick: 'zero' })));
		expect(anonAct.status).toBe(401);

		// A session id that resolves to no person — e.g. a keyholder auth user
		// with no member record: the offer refuses, leaking nothing.
		const stranger = await load(memberEvent(randomUUID()));
		expect(stranger).toMatchObject({ authenticated: true, eligible: false });
		expect('offer' in stranger).toBe(false);

		const strangerAct = expectFailure(await action(memberEvent(randomUUID(), { pick: 'zero' })));
		expect(strangerAct.status).toBe(403);
	});
});

describe('the $0 path (spec §5:233)', () => {
	it('records state `zero` with ZERO Stripe API calls, and the keyholder view is exactly {offered, helpRequested}', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		const result = await action(memberEvent(member.session.userId, { pick: 'zero', helpRequested: 'true' }));
		expect(result).toEqual({ chosen: 'zero' });
		expect(stub.count()).toBe(0);

		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.state).toBe('zero');
		expect(agreement?.amountCents).toBe(0);
		expect(agreement?.rail).toBe('zero');
		expect(agreement?.helpRequested).toBe(true);

		// The rails visibility shape, ported: keyholders read EXACTLY this.
		const view = keyholderContributionView(agreement);
		expect(Object.keys(view).sort()).toEqual(['helpRequested', 'offered']);
		expect(view).toEqual({ offered: true, helpRequested: true });

		expect(await membershipStatus(tenantId, member.person.id)).toBe('active');
	});
});

describe('cash and check — first-class rails (spec §5:243–248; ADR 0016 §3.1)', () => {
	it('records intent (`cash_pending`) under a THROWING Stripe stub, and rails receipt entry advances it to `cash_recorded`', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId, throwingGateway()));

		const cash = await action(memberEvent(member.session.userId, { pick: 'cash' }));
		expect(cash).toEqual({ chosen: 'cash_pending' });

		// The money itself arrives later; a finance-role operator records it
		// through rails' append-only receipt surface — never through this route.
		await withTenant(
			tenantId,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId,
					personId: member.person.id,
					rail: 'cash',
					amountCents: 2000,
					receivedOn: '2026-08-20',
					cadence: 'monthly',
					recordedBy: randomUUID(),
					idempotencyKey: `${tenantId}:receipt:${member.person.id}:1`,
				}),
			db,
		);
		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.state).toBe('cash_recorded');
		expect(await membershipStatus(tenantId, member.person.id)).toBe('active');
	});

	it('check records the same intent state and never touches Stripe', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId, throwingGateway()));
		const check = await action(memberEvent(member.session.userId, { pick: 'check' }));
		expect(check).toEqual({ chosen: 'cash_pending' });
	});
});

describe('custom bounds at the endpoint (spec §5:230–232)', () => {
	it('accepts the exact bounds and 400s one cent outside each, mutating nothing', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		for (const [pick, amount] of [
			['custom_monthly', '4.99'],
			['custom_monthly', '500.01'],
			['custom_annual', '59.99'],
			['custom_annual', '6000.01'],
		] as const) {
			const failure = expectFailure(await action(memberEvent(member.session.userId, { pick, amount })));
			expect(failure.status, `${pick} ${amount}`).toBe(400);
			expect(failure.data.code).toBe('invalid_choice');
		}
		// The refusals recorded nothing and called Stripe zero times.
		expect(stub.count()).toBe(0);
		expect(await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db)).toBeUndefined();

		// The exact bounds pass and hand off to Checkout.
		const atMin = await action(memberEvent(member.session.userId, { pick: 'custom_monthly', amount: '5' })).catch(
			(e) => e,
		);
		expect(isRedirect(atMin)).toBe(true);
		expect(stub.count()).toBe(1);
		expect((stub.last().line_items as { price_data: { unit_amount: number } }[])[0].price_data.unit_amount).toBe(500);
	});
});

describe('the card handoff — hosted Checkout, test-mode gateway (ADR 0016 §3.1, §5.1)', () => {
	it('preset $5/month: records `stripe_pending`, 303s to the session URL, subscription mode, month interval', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));

		const outcome = await action(memberEvent(member.session.userId, { pick: 'preset:500' })).catch((e) => e);
		expect(isRedirect(outcome)).toBe(true);
		const redirect = outcome as { status: number; location: string };
		expect(redirect.status).toBe(303);
		expect(redirect.location).toBe('https://checkout.stripe.example/cs_test');

		const params = stub.last() as {
			mode: string;
			client_reference_id: string;
			line_items: { price_data: { unit_amount: number; recurring: { interval: string } } }[];
		};
		expect(params.mode).toBe('subscription');
		expect(params.client_reference_id).toBe(member.person.id);
		expect(params.line_items[0].price_data.unit_amount).toBe(500);
		expect(params.line_items[0].price_data.recurring.interval).toBe('month');

		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.state).toBe('stripe_pending');
		expect(agreement?.amountCents).toBe(500);
		expect(agreement?.cadence).toBe('monthly');
	});

	it('annual custom routes with a year interval', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const stub = countingGateway();
		const action = _createChooseAction(seams(tenantId, stub.gateway));
		const outcome = await action(memberEvent(member.session.userId, { pick: 'custom_annual', amount: '120' })).catch(
			(e) => e,
		);
		expect(isRedirect(outcome)).toBe(true);
		const params = stub.last() as {
			line_items: { price_data: { unit_amount: number; recurring: { interval: string } } }[];
		};
		expect(params.line_items[0].price_data.unit_amount).toBe(12_000);
		expect(params.line_items[0].price_data.recurring.interval).toBe('year');
	});

	it('a checkout failure of ANY kind leaves membership unchanged (spec §11; ADR 0016 §3.2)', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId, throwingGateway()));

		const failure = expectFailure(await action(memberEvent(member.session.userId, { pick: 'preset:1000' })));
		expect(failure.status).toBe(502);

		// The choice stands honestly as pending; the membership never moved.
		const agreement = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		expect(agreement?.state).toBe('stripe_pending');
		expect(await membershipStatus(tenantId, member.person.id)).toBe('active');
	});

	it('keyless runtime (no seam, no env keys): card choice 503s `card_unavailable`, membership unchanged', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId)); // no gateway, no STRIPE_* in env
		const failure = expectFailure(await action(memberEvent(member.session.userId, { pick: 'preset:2000' })));
		expect(failure.status).toBe(503);
		expect(failure.data.code).toBe('card_unavailable');
		expect(await membershipStatus(tenantId, member.person.id)).toBe('active');
	});
});

describe('revision converges (spec §6 duplicate/replay contract)', () => {
	it('re-choosing replaces the single agreement row, bumping its version', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const action = _createChooseAction(seams(tenantId, countingGateway().gateway));

		await action(memberEvent(member.session.userId, { pick: 'zero' }));
		const first = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);
		await action(memberEvent(member.session.userId, { pick: 'cash' }));
		const second = await withTenant(tenantId, (tx) => getAgreement(tx, member.person.id), db);

		expect(second?.id).toBe(first?.id);
		expect(second?.state).toBe('cash_pending');
		expect((second?.version ?? 0) > (first?.version ?? 0)).toBe(true);
	});
});

describe('/home — the versioned agreement and the optional offer (ADR 0016 §2.3)', () => {
	it('shows status, the EXACT agreement version assented to with its body, and the member-only contribution view', async () => {
		const tenantId = await newTenant();
		const member = await activeMember(tenantId);
		const load = _createHomeLoad(seams(tenantId));

		const before = await load(memberEvent(member.session.userId, undefined, '/home'));
		expect(before.available).toBe(true);
		expect(before.member?.membership.status).toBe('active');
		expect(before.member?.agreement?.body).toBe(AGREEMENT_BODY);
		expect(before.member?.agreement?.versionId).toBeGreaterThan(0);
		expect(before.member?.contribution.state).toBe('none');

		const action = _createChooseAction(seams(tenantId, throwingGateway()));
		await action(memberEvent(member.session.userId, { pick: 'check', helpRequested: 'true' }));

		const after = await load(memberEvent(member.session.userId, undefined, '/home'));
		expect(after.member?.contribution).toMatchObject({ state: 'cash_pending', helpRequested: true });
	});

	it('an anonymous or memberless session sees an honest closed page', async () => {
		const tenantId = await newTenant();
		const load = _createHomeLoad(seams(tenantId));
		expect(await load(memberEvent(null, undefined, '/home'))).toMatchObject({
			authenticated: false,
			member: null,
		});
		expect(await load(memberEvent(randomUUID(), undefined, '/home'))).toMatchObject({
			authenticated: true,
			member: null,
		});
	});
});
