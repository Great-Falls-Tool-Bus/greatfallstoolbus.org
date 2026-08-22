/**
 * Finance audience for offboarding's cancel_billing obligation (TIN-3440
 * slice S11, round 2 — adversarial review BLOCK on PR #194 @ 83947ea, B1/B2).
 * Same harness discipline as `finance-read.integration.test.ts`: real
 * migrator run, real `gftb_migrator`/`gftb_app` role split, FORCE RLS.
 *
 * `member-v0-executable-slices-2026-08-18.md:731` (§2.3 row 1): "finance sees
 * an open obligation" for a dead-lettered `offboard.cancel_billing` job. This
 * suite proves the read path that serves it, and — the load-bearing negative
 * — that the exact `lastError` a keyholder is withheld
 * (`offboarding-observability.integration.test.ts`, same fixture shape) is
 * exactly what a live finance grant DOES receive here.
 *
 * Covers:
 *   - role-gate rejection: no session (401), a session with no grant (403),
 *     and a session holding ONLY the keyholder grant (403) — holding
 *     `keyholder` never implies `finance`;
 *   - a finance grant revoked mid-request is refused in the same unit of
 *     work (the `requireKeyholder` guarantee, proved for `requireFinance`
 *     here as it already is in `finance-read.integration.test.ts`);
 *   - a live finance grant reads the open `cancel_billing` obligation with
 *     its `lastError` UNREDACTED — the exact string a keyholder never sees;
 *   - `done` cancel_billing jobs are excluded (not an "open obligation");
 *   - tenant isolation (RLS).
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
import { KEYHOLDER_ROLE } from '../application/claim';
import { FINANCE_ROLE } from './finance-read';
import { application, membership, outboxJob, person } from '../db/schema';
import { _createOffboardingObligationsLoad } from '../../../routes/(finance)/offboarding-obligations/+page.server';

let fixture: PgFixture;
let pool: pg.Pool;
let db: Db;
let previousDatabaseUrl: string | undefined;

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
}, 240_000);

afterAll(async () => {
	await closeDb();
	if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousDatabaseUrl;
	await pool?.end();
	await fixture?.stop();
});

function loadEvent(personId: string | null) {
	return { locals: { authSession: personId ? { userId: personId } : null } } as unknown as Parameters<
		ReturnType<typeof _createOffboardingObligationsLoad>
	>[0];
}

async function seedTenantWith(roles: { keyholder?: boolean; finance?: boolean } = {}): Promise<{
	tenantId: string;
	personId: string;
}> {
	const tenantId = await seedTenant(fixture.migratorDsn, `s11-fin-obl-${randomUUID().slice(0, 8)}`);
	const personId = randomUUID();
	await withTenant(
		tenantId,
		async (tx) => {
			if (roles.keyholder) await grantRole(tx, tenantId, { personId, role: KEYHOLDER_ROLE, grantedBy: randomUUID() });
			if (roles.finance) await grantRole(tx, tenantId, { personId, role: FINANCE_ROLE, grantedBy: randomUUID() });
		},
		db,
	);
	return { tenantId, personId };
}

async function seedOffboardedMembershipWithCancelBilling(
	tenantId: string,
	displayName: string,
	status: 'pending' | 'leased' | 'done' | 'dead',
	lastError: string | null,
): Promise<{ membershipId: string; personId: string }> {
	return withTenant(
		tenantId,
		async (tx) => {
			const [app] = await tx
				.insert(application)
				.values({
					tenantId,
					status: 'approved',
					displayName,
					email: `${randomUUID().slice(0, 8)}@example.org`,
					interestsHelpOffer: 'fixture',
					tourAvailability: 'fixture',
					disclosures: 'none',
					ageAttestedAt: new Date(),
					ageAttestationVersion: 'v1',
					submissionIdempotencyKey: randomUUID(),
				})
				.returning();
			const [p] = await tx.insert(person).values({ tenantId, applicationId: app.id, displayName }).returning();
			const [m] = await tx
				.insert(membership)
				.values({ tenantId, personId: p.id, applicationId: app.id, status: 'removed', endedAt: new Date() })
				.returning();
			await tx.insert(outboxJob).values({
				tenantId,
				kind: 'offboard.cancel_billing',
				aggregateType: 'membership',
				aggregateId: m.id,
				payload: { membershipId: m.id, personId: p.id },
				idempotencyKey: `${tenantId}:membership:${m.id}:cancel_billing`,
				status,
				attempts: status === 'dead' ? 8 : status === 'done' ? 1 : 0,
				lastError,
			});
			return { membershipId: m.id, personId: p.id };
		},
		db,
	);
}

describe('role gate: finance-only, keyholder never admitted (spec §6, §2.3 row 1)', () => {
	it('no session -> throws 401', async () => {
		const { tenantId } = await seedTenantWith();
		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(null));
		} catch (error) {
			caught = error as { status?: number };
		}
		expect(caught?.status).toBe(401);
	});

	it('a session with NO grant -> throws 403', async () => {
		const { tenantId, personId } = await seedTenantWith();
		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(personId));
		} catch (error) {
			caught = error as { status?: number };
		}
		expect(caught?.status).toBe(403);
	});

	it('KEYHOLDER-ONLY (no finance grant) -> throws 403; must not read the withheld detail', async () => {
		const { tenantId, personId } = await seedTenantWith({ keyholder: true });
		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(personId));
		} catch (error) {
			caught = error as { status?: number };
		}
		expect(caught?.status).toBe(403);
	});

	it('a finance grant revoked mid-request (between two loads) is refused on the second', async () => {
		const { tenantId, personId } = await seedTenantWith({ finance: true });
		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		await expect(load(loadEvent(personId))).resolves.toMatchObject({ available: true });

		await withTenant(tenantId, (tx) => revokeRole(tx, tenantId, personId, FINANCE_ROLE), db);

		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(personId));
		} catch (error) {
			caught = error as { status?: number };
		}
		expect(caught?.status).toBe(403);
	});
});

describe('a live finance grant reads the withheld detail (§2.3 row 1, the flagged nuance closed)', () => {
	it('serves the dead cancel_billing lastError UNREDACTED — exactly what the keyholder surface withholds', async () => {
		const { tenantId, personId } = await seedTenantWith({ finance: true });
		const reason = 'Error: cancel refused for stripe subscription sub_ABC amount 2000';
		await seedOffboardedMembershipWithCancelBilling(tenantId, 'Finance Sees This One', 'dead', reason);

		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		const result = (await load(loadEvent(personId))) as {
			available: boolean;
			obligations: { displayName: string; status: string; attempts: number; lastError: string | null }[];
		};
		expect(result.available).toBe(true);
		const row = result.obligations.find((o) => o.displayName === 'Finance Sees This One');
		expect(row).toMatchObject({ status: 'dead', attempts: 8, lastError: reason });
	});

	it('excludes done cancel_billing jobs — resolved is not an open obligation', async () => {
		const { tenantId, personId } = await seedTenantWith({ finance: true });
		await seedOffboardedMembershipWithCancelBilling(tenantId, 'Already Resolved', 'done', null);

		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		const result = (await load(loadEvent(personId))) as { obligations: { displayName: string }[] };
		expect(result.obligations.find((o) => o.displayName === 'Already Resolved')).toBeUndefined();
	});

	it('includes pending and leased (not just dead) — an open obligation is anything not done', async () => {
		const { tenantId, personId } = await seedTenantWith({ finance: true });
		await seedOffboardedMembershipWithCancelBilling(tenantId, 'Still Pending', 'pending', null);
		await seedOffboardedMembershipWithCancelBilling(tenantId, 'Still Processing', 'leased', null);

		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		const result = (await load(loadEvent(personId))) as { obligations: { displayName: string; status: string }[] };
		expect(result.obligations.find((o) => o.displayName === 'Still Pending')?.status).toBe('pending');
		expect(result.obligations.find((o) => o.displayName === 'Still Processing')?.status).toBe('leased');
	});
});

describe('tenant isolation (RLS)', () => {
	it('a finance grant in tenant B cannot read tenant A obligations through A env', async () => {
		const a = await seedTenantWith();
		const b = await seedTenantWith({ finance: true });
		await seedOffboardedMembershipWithCancelBilling(a.tenantId, 'Tenant A Only', 'dead', 'tenant-a-secret-reason');

		const load = _createOffboardingObligationsLoad({
			env: { GFTB_TENANT_ID: a.tenantId, DATABASE_URL: fixture.runtimeDsn },
		});
		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(b.personId));
		} catch (error) {
			caught = error as { status?: number };
		}
		// b's finance grant lives in tenant B only; requireFinance resolves the
		// tenant from the GUC (this call's env), so b reads as no-grant here.
		expect(caught?.status).toBe(403);
	});
});
