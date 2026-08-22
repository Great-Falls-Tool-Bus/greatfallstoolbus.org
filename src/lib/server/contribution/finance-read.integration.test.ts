/**
 * Finance-role read surface against real PostgreSQL 16.15 (TIN-3818 slice
 * S10). Same harness discipline as `payment-rails.integration.test.ts`: real
 * migrator run, real `gftb_migrator`/`gftb_app` role split, FORCE RLS.
 *
 * Covers:
 *   - role-gate rejection: a session with NO grant, and a session holding
 *     only the KEYHOLDER grant, are both refused (403, `not_finance`);
 *   - a grant revoked mid-request (after the session resolved, before this
 *     transaction opened) is refused in the same unit of work — the S5
 *     `requireKeyholder` guarantee, proved here for `requireFinance`;
 *   - a live `finance` grant reads the full record: amount, rail, cadence,
 *     state, and the append-only cash/check receipt trail with a correct
 *     reversal-aware net;
 *   - tenant isolation: a finance session in tenant A never sees tenant B's
 *     contribution data, even though the query issues no explicit tenant
 *     filter (RLS does the work);
 *   - the keyholder-exclusion invariant STILL holds: the exact agreement row
 *     a finance session reads in full still serializes to exactly
 *     `{offered, helpRequested}` through `keyholderContributionView` — proof
 *     that shipping the finance read surface did not erode S8's closed
 *     literal (extends the `offer.hostile.integration.test.ts` /
 *     `visibility.test.ts` coverage with a same-row, both-views assertion);
 *   - the route load (`_createFinanceLoad`): 401 anonymous, 403 member, 403
 *     keyholder-only, 200 finance with the full shape, and no `actions`
 *     export exists on the route module at all (grep-shaped, structural).
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
	credentialRuntimeRole,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { grantRole, revokeRole } from '../auth/roles';
import { AuthError } from '../auth/session';
import { KEYHOLDER_ROLE } from '../application/claim';
import { chooseContribution } from './agreement';
import { recordCashCheckReceipt } from './receipt';
import { keyholderContributionView } from './visibility';
import { FINANCE_ROLE, requireFinance, listFinanceContributions } from './finance-read';
import * as financeRoute from '../../../routes/(finance)/contributions/+page.server';
// Test-only: the route layer imports this (outside the contribution/stripe fence by
// construction), so asserting its content here does not cross `import-boundary.test.ts`'s
// line — that scan excludes every `.test.` file, this one included.
import { LIVE_STRIPE_GATE } from '../stripe/gate';

const { _createFinanceLoad } = financeRoute;

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

async function newTenant(): Promise<string> {
	return seedTenant(fixture.migratorDsn, `s10-${randomUUID().slice(0, 8)}`);
}

/** Grant a fresh person the finance role; returns their person id. */
async function newFinanceHolder(tenantId: string): Promise<string> {
	const personId = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId, role: FINANCE_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return personId;
}

/** Grant a fresh person the keyholder role only — the "wrong grant" negative case. */
async function newKeyholder(tenantId: string): Promise<string> {
	const personId = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return personId;
}

function seams(tenantId: string) {
	return { env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } as NodeJS.ProcessEnv };
}

/** Minimal RequestEvent with a pre-validated session — the route seam (offer.integration.test.ts precedent). */
function financeEvent(authUserId: string | null) {
	const url = new URL('http://localhost/contributions');
	return {
		request: new Request(url),
		locals: { authSession: authUserId ? { userId: authUserId } : null },
		url,
	} as unknown as Parameters<ReturnType<typeof _createFinanceLoad>>[0];
}

describe('requireFinance / listFinanceContributions: role gate', () => {
	it('refuses a person with no grant at all', async () => {
		const tenantId = await newTenant();
		const nobody = randomUUID();
		await expect(withTenant(tenantId, (tx) => requireFinance(tx, nobody), db)).rejects.toBeInstanceOf(AuthError);
		await expect(withTenant(tenantId, (tx) => requireFinance(tx, nobody), db)).rejects.toMatchObject({
			status: 403,
			code: 'not_finance',
		});
	});

	it('refuses a person holding only the keyholder grant — role separation, not "any grant"', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		await expect(withTenant(tenantId, (tx) => listFinanceContributions(tx, keyholder), db)).rejects.toMatchObject({
			status: 403,
			code: 'not_finance',
		});
	});

	it('refuses a grant revoked mid-request, checked in the SAME unit of work (S5 requireKeyholder guarantee)', async () => {
		const tenantId = await newTenant();
		const finance = await newFinanceHolder(tenantId);
		// Live grant: succeeds first.
		await expect(withTenant(tenantId, (tx) => requireFinance(tx, finance), db)).resolves.toBe(tenantId);
		// Revoke, then the very next check must refuse — nothing caches the grant.
		await withTenant(tenantId, (tx) => revokeRole(tx, tenantId, finance, FINANCE_ROLE), db);
		await expect(withTenant(tenantId, (tx) => requireFinance(tx, finance), db)).rejects.toMatchObject({
			status: 403,
			code: 'not_finance',
		});
	});
});

describe('listFinanceContributions: data a finance session reads', () => {
	it('reads amount, rail, cadence, and state for a Stripe-rail offer', async () => {
		const tenantId = await newTenant();
		const finance = await newFinanceHolder(tenantId);
		const member = randomUUID();
		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: member,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 2000 },
					helpRequested: true,
				}),
			db,
		);

		const rows = await withTenant(tenantId, (tx) => listFinanceContributions(tx, finance), db);
		const row = rows.find((r) => r.personId === member);
		expect(row).toBeDefined();
		expect(row?.view.agreement).toMatchObject({
			state: 'stripe_pending',
			rail: 'stripe',
			cadence: 'monthly',
			amountCents: 2000,
			helpRequested: true,
		});
		expect(row?.view.receipts).toEqual([]);
		expect(row?.netReceiptsCents).toBe(0);
	});

	it('reads the cash/check receipt trail with a correction — reversal-aware net, not a naive SUM', async () => {
		const tenantId = await newTenant();
		const finance = await newFinanceHolder(tenantId);
		const member = randomUUID();
		await withTenant(
			tenantId,
			(tx) => chooseContribution(tx, { tenantId, personId: member, choice: { kind: 'cash' } }),
			db,
		);
		const first = await withTenant(
			tenantId,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId,
					personId: member,
					rail: 'cash',
					amountCents: 10_000,
					receivedOn: '2026-08-19',
					cadence: 'one_time',
					recordedBy: finance,
					idempotencyKey: randomUUID(),
				}),
			db,
		);
		// Correction: reverse the $100 entry, then record the true $10 figure.
		await withTenant(
			tenantId,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId,
					personId: member,
					rail: 'cash',
					amountCents: 10_000,
					receivedOn: '2026-08-19',
					cadence: 'one_time',
					recordedBy: finance,
					idempotencyKey: randomUUID(),
					reversesId: first.receipt.id,
				}),
			db,
		);
		await withTenant(
			tenantId,
			(tx) =>
				recordCashCheckReceipt(tx, {
					tenantId,
					personId: member,
					rail: 'cash',
					amountCents: 1_000,
					receivedOn: '2026-08-19',
					cadence: 'one_time',
					recordedBy: finance,
					idempotencyKey: randomUUID(),
				}),
			db,
		);

		const rows = await withTenant(tenantId, (tx) => listFinanceContributions(tx, finance), db);
		const row = rows.find((r) => r.personId === member);
		expect(row?.view.receipts).toHaveLength(3);
		// $100 original + its reversal net to zero; the corrected $10 stands alone.
		expect(row?.netReceiptsCents).toBe(1_000);
	});

	it('is finance data another tenant can never see — RLS, not an explicit filter in the query', async () => {
		const tenantA = await newTenant();
		const tenantB = await newTenant();
		const financeA = await newFinanceHolder(tenantA);
		const memberB = randomUUID();
		await withTenant(
			tenantB,
			(tx) => chooseContribution(tx, { tenantId: tenantB, personId: memberB, choice: { kind: 'zero' } }),
			db,
		);

		const rowsAsA = await withTenant(tenantA, (tx) => listFinanceContributions(tx, financeA), db);
		expect(rowsAsA.find((r) => r.personId === memberB)).toBeUndefined();
	});

	it('the keyholder-exclusion invariant still holds on the SAME row a finance session read in full', async () => {
		const tenantId = await newTenant();
		const finance = await newFinanceHolder(tenantId);
		const member = randomUUID();
		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: member,
					choice: { kind: 'stripe', cadence: 'annual', amountCents: 60_000 },
					helpRequested: true,
				}),
			db,
		);

		const rows = await withTenant(tenantId, (tx) => listFinanceContributions(tx, finance), db);
		const row = rows.find((r) => r.personId === member);
		expect(row?.view.agreement?.amountCents).toBe(60_000); // finance really does see the amount

		// The identical underlying agreement row, through the keyholder serializer:
		const keyholderShape = keyholderContributionView(row?.view.agreement);
		expect(Object.keys(keyholderShape).sort()).toEqual(['helpRequested', 'offered']);
		expect(keyholderShape).toEqual({ offered: true, helpRequested: true });
	});
});

describe('the /contributions route: HTTP-level role gate', () => {
	it('exports exactly {_createFinanceLoad, load, prerender} — no actions, no other surface (the #194 form: bites on ANY addition, not just `actions`)', () => {
		expect(Object.keys(financeRoute).sort()).toEqual(['_createFinanceLoad', 'load', 'prerender']);
	});

	it('401s an anonymous request', async () => {
		const tenantId = await newTenant();
		const load = _createFinanceLoad(seams(tenantId));
		await expect(load(financeEvent(null))).rejects.toMatchObject({ status: 401 });
	});

	it('EDIT-1 regression: an anonymous request never sees LIVE_STRIPE_GATE.reason, even with runtime env unset — authentication is checked before the env/gate-status branch', async () => {
		// Adversarial review (PR #195, comment 5377394267) proved the env-missing
		// branch used to run BEFORE the actor/401 check, so a stranger hitting
		// this route while GFTB_TENANT_ID/DATABASE_URL were unset got back
		// {available:false, liveGate: LIVE_STRIPE_GATE} — internal governance
		// prose ("form PROPOSED … unsigned") — with no session at all.
		const load = _createFinanceLoad({ env: {} as NodeJS.ProcessEnv });
		const rejection = await load(financeEvent(null)).catch((e: unknown) => e);
		expect(rejection).toMatchObject({ status: 401 });
		expect(JSON.stringify(rejection)).not.toContain(LIVE_STRIPE_GATE.reason);
		expect(JSON.stringify(rejection)).not.toContain('PROPOSED');
	});

	it('a finance session still reaches the "unavailable" shape (not a 401) when runtime env is genuinely unset', async () => {
		// Unlike the anonymous case above, an ALREADY-authenticated actor reaching
		// an unconfigured process is not a stranger being handed governance prose
		// — it is the same "auth disabled without infra config" posture every
		// other route in this repo takes (hooks.server.ts). Confirms the EDIT-1
		// fix is a reorder, not a blanket ban on the unavailable branch.
		const load = _createFinanceLoad({ env: {} as NodeJS.ProcessEnv });
		const result = await load(financeEvent(randomUUID()));
		expect(result).toEqual({ available: false, rows: [], liveGate: LIVE_STRIPE_GATE });
	});

	it('403s a signed-in session with no finance grant (a plain member)', async () => {
		const tenantId = await newTenant();
		const load = _createFinanceLoad(seams(tenantId));
		await expect(load(financeEvent(randomUUID()))).rejects.toMatchObject({ status: 403 });
	});

	it('403s a signed-in KEYHOLDER session — keyholder grant is not finance grant', async () => {
		const tenantId = await newTenant();
		const keyholder = await newKeyholder(tenantId);
		const load = _createFinanceLoad(seams(tenantId));
		await expect(load(financeEvent(keyholder))).rejects.toMatchObject({ status: 403 });
	});

	it('200s a finance session and serializes amounts, rail, cadence, and receipts', async () => {
		const tenantId = await newTenant();
		const finance = await newFinanceHolder(tenantId);
		const member = randomUUID();
		await withTenant(
			tenantId,
			(tx) =>
				chooseContribution(tx, {
					tenantId,
					personId: member,
					choice: { kind: 'stripe', cadence: 'monthly', amountCents: 5_000 },
				}),
			db,
		);

		const load = _createFinanceLoad(seams(tenantId));
		const result = (await load(financeEvent(finance))) as {
			available: true;
			rows: Array<{ personId: string; amountCents: number | null; rail: string | null }>;
			liveGate: { open: boolean };
		};
		expect(result.available).toBe(true);
		expect(result.liveGate.open).toBe(false);
		const row = result.rows.find((r) => r.personId === member);
		expect(row).toMatchObject({ amountCents: 5_000, rail: 'stripe' });
	});
});
