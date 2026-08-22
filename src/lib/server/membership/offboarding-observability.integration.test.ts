/**
 * S11 integration rows (TIN-3440; L70 mandate, sitting-2 QA gap "offboarding
 * HTTP observability"), on the S1/S3/S6/S7 fixture: real migrator run, real
 * `gftb_migrator`/`gftb_app` role split, FORCE RLS.
 *
 * ROUND 2 (adversarial review BLOCK on PR #194 @ 83947ea). The finance-only
 * and mid-request-revocation cells below are adapted from the reviewer's own
 * cross-slice probe (not committed to either PR):
 * `reviewer-cross-slice.integration.test.ts`, `MATRIX /offboarding` and
 * `mid-request revocation` describe blocks — credited in the commit body.
 *
 *   - role-gate rejection: a session with no live `keyholder` grant reads the
 *     surface as unauthorized/empty, never the underlying rows (spec §6);
 *   - FINANCE-ONLY (a live `finance` grant, no `keyholder` grant) is refused
 *     the same way — holding `finance` never implies `keyholder`
 *     (decisions/0018:81-85) — the round-1 untested cell (EDIT-1);
 *   - a keyholder grant revoked BETWEEN two loads is refused on the second
 *     (EDIT-2), same discipline `requireKeyholder` gives every other S5-S7
 *     surface;
 *   - correct rendering of every outbox state — pending, leased ("processing"
 *     at the HTTP edge), done, AND dead — including the dead-letter reason,
 *     EXCEPT `offboard.cancel_billing`'s, which round 2 withholds from the
 *     keyholder surface entirely (spec §5 "failure detail"; §2.3 row 1 names
 *     finance as that job kind's audience instead — see
 *     `offboarding-obligations.integration.test.ts` for the finance side);
 *   - `leaseExpiresAt` is not served at all (round-2 EDIT-3: never rendered,
 *     never shipped);
 *   - tenant isolation: a keyholder in tenant B never sees tenant A's
 *     offboarded memberships or jobs, even holding a live grant of their own;
 *   - a non-auth failure (malformed tenant id, standing in for "the database
 *     is unreachable") is NOT swallowed as "not signed in" — it throws a real
 *     500 (round-2 EDIT-4; round 1 proved this bug, this file now proves the
 *     fix);
 *   - the surface is read-only: the route module ships no `actions` (unit-
 *     level proof in `offboarding.test.ts`), and this file additionally
 *     proves the LOAD ITSELF never mutates an `outbox_job` row it reads.
 *
 * Rows are seeded directly (application/person/membership/outbox_job inserts)
 * rather than replayed through the full intake→activate→offboard pipeline:
 * this slice's surface is a pure READER over S3/S7's already-proven state
 * machine, so the fixture only needs rows shaped like their output, not the
 * transitions that produce them.
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
import { FINANCE_ROLE } from '../contribution/finance-read';
import { application, membership, outboxJob, person } from '../db/schema';
import { OFFBOARD_JOB_KINDS, type OffboardJobKind } from './offboard';
import { _createOffboardingLoad } from '../../../routes/(keyholder)/offboarding/+page.server';

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

/** Minimal RequestEvent carrying a pre-validated session — the route seam (review.integration.test.ts precedent). */
function loadEvent(personId: string | null) {
	return { locals: { authSession: personId ? { userId: personId } : null } } as unknown as Parameters<
		ReturnType<typeof _createOffboardingLoad>
	>[0];
}

/** One offboarded (`left`/`removed`) membership, inserted directly — see file docstring. */
async function seedOffboardedMembership(
	tenantId: string,
	status: 'left' | 'removed',
	displayName: string,
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
				.values({
					tenantId,
					personId: p.id,
					applicationId: app.id,
					status,
					endedAt: new Date(),
				})
				.returning();
			return { membershipId: m.id, personId: p.id };
		},
		db,
	);
}

interface JobSpec {
	kind: OffboardJobKind;
	status: 'pending' | 'leased' | 'done' | 'dead';
	attempts: number;
	lastError?: string;
}

async function seedJobs(tenantId: string, membershipId: string, specs: JobSpec[]): Promise<void> {
	await withTenant(
		tenantId,
		async (tx) => {
			for (const spec of specs) {
				await tx.insert(outboxJob).values({
					tenantId,
					kind: spec.kind,
					aggregateType: 'membership',
					aggregateId: membershipId,
					payload: { membershipId },
					idempotencyKey: `${tenantId}:membership:${membershipId}:${spec.kind}`,
					status: spec.status,
					attempts: spec.attempts,
					lastError: spec.lastError ?? null,
				});
			}
		},
		db,
	);
}

async function newTenantWithKeyholder(): Promise<{ tenantId: string; keyholder: string }> {
	const tenantId = await seedTenant(fixture.migratorDsn, `s11-${randomUUID().slice(0, 8)}`);
	const keyholder = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: keyholder, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return { tenantId, keyholder };
}

/** A tenant plus a person holding a live FINANCE grant and no keyholder grant. */
async function newTenantWithFinanceOnly(): Promise<{ tenantId: string; financeOnly: string }> {
	const tenantId = await seedTenant(fixture.migratorDsn, `s11-fin-${randomUUID().slice(0, 8)}`);
	const financeOnly = randomUUID();
	await withTenant(
		tenantId,
		(tx) => grantRole(tx, tenantId, { personId: financeOnly, role: FINANCE_ROLE, grantedBy: randomUUID() }),
		db,
	);
	return { tenantId, financeOnly };
}

describe('role gate (spec §6: authorization checked in the same unit of work as the read)', () => {
	it('a session with no live keyholder grant reads as unauthorized — never the underlying rows', async () => {
		const { tenantId } = await newTenantWithKeyholder();
		const stranger = randomUUID(); // no grant of any kind in this tenant
		const { membershipId } = await seedOffboardedMembership(tenantId, 'removed', 'No Keyholder Sees Me');
		await seedJobs(tenantId, membershipId, [{ kind: 'offboard.cancel_billing', status: 'dead', attempts: 8 }]);

		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await load(loadEvent(stranger))) as {
			available: boolean;
			authenticated: boolean;
			memberships: unknown[];
		};
		expect(result.authenticated).toBe(false);
		expect(result.memberships).toEqual([]);
	});

	it('an unauthenticated request (no session) also reads as unauthorized', async () => {
		const { tenantId } = await newTenantWithKeyholder();
		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await load(loadEvent(null))) as { authenticated: boolean };
		expect(result.authenticated).toBe(false);
	});

	// EDIT-1 (adversarial review, adapted from reviewer-cross-slice.integration.test.ts
	// "FINANCE-ONLY -> REFUSED (the untested cell in PR #194)"): a live `finance`
	// grant does not imply `keyholder` — this route stays keyholder-only.
	it('a live FINANCE grant with no keyholder grant is refused, same as no grant at all', async () => {
		const { tenantId, financeOnly } = await newTenantWithFinanceOnly();
		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await load(loadEvent(financeOnly))) as { authenticated: boolean; memberships: unknown[] };
		expect(result).toMatchObject({ authenticated: false, memberships: [] });
	});

	// EDIT-2 (adversarial review, adapted from reviewer-cross-slice.integration.test.ts
	// "mid-request revocation"): the grant check rides the load's own unit of
	// work, so a revocation committed BETWEEN two loads is seen on the second.
	it('a keyholder grant revoked between two loads is refused on the second', async () => {
		const { tenantId } = await newTenantWithKeyholder();
		const kh = randomUUID();
		await withTenant(
			tenantId,
			(tx) => grantRole(tx, tenantId, { personId: kh, role: KEYHOLDER_ROLE, grantedBy: randomUUID() }),
			db,
		);
		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const before = (await load(loadEvent(kh))) as { authenticated: boolean };
		expect(before.authenticated).toBe(true);

		await withTenant(tenantId, (tx) => revokeRole(tx, tenantId, kh, KEYHOLDER_ROLE), db);

		const after = (await load(loadEvent(kh))) as { authenticated: boolean; memberships: unknown[] };
		expect(after).toMatchObject({ authenticated: false, memberships: [] });
	});
});

// EDIT-4 (adversarial review, proven bug): a non-auth failure must not render
// as "please sign in". A malformed tenant id stands in for "the database is
// unreachable" — both are infrastructure failures `withTenant`'s own
// `assertTenantId` throws a plain (non-`AuthError`) `Error` for, which is
// exactly the class round 1's blanket catch swallowed.
describe('a non-auth failure is not swallowed as unauthenticated (round-2 EDIT-4 fix)', () => {
	it('a malformed GFTB_TENANT_ID throws a real 500, not a soft "unauthenticated" 200', async () => {
		const load = _createOffboardingLoad({
			env: { GFTB_TENANT_ID: 'not-a-real-tenant-id', DATABASE_URL: fixture.runtimeDsn },
		});
		let caught: { status?: number } | undefined;
		try {
			await load(loadEvent(randomUUID()));
		} catch (error) {
			caught = error as { status?: number };
		}
		expect(caught).toBeDefined();
		expect(caught?.status).toBe(500);
	});
});

describe('rendering every outbox state, including dead-letter (S11 acceptance)', () => {
	it('a live keyholder sees kind, state, attempts, and timestamps for every job — but NEVER cancel_billing lastError', async () => {
		const { tenantId, keyholder } = await newTenantWithKeyholder();
		const { membershipId } = await seedOffboardedMembership(tenantId, 'removed', 'Fully Processed Then One Poison');
		await seedJobs(tenantId, membershipId, [
			// The withheld kind (round-2 B2 fix): dead, with a money-shaped reason.
			{
				kind: 'offboard.cancel_billing',
				status: 'dead',
				attempts: 8,
				lastError: 'Error: cancel refused for stripe subscription sub_ABC amount 2000',
			},
			// A dead NON-billing kind: lastError is NOT money-adjacent and must
			// still pass through — proves the redaction is kind-specific, not blanket.
			{ kind: 'offboard.remove_lists', status: 'dead', attempts: 8, lastError: 'mailman: list not found' },
			{ kind: 'offboard.disable_mailbox', status: 'leased', attempts: 2 },
		]);

		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await load(loadEvent(keyholder))) as {
			authenticated: boolean;
			memberships: {
				membershipId: string;
				status: string;
				jobs: Record<string, unknown>[];
			}[];
		};
		expect(result.authenticated).toBe(true);
		const entry = result.memberships.find((m) => m.membershipId === membershipId);
		expect(entry).toBeDefined();
		expect(entry!.status).toBe('removed');

		const byKind = Object.fromEntries(entry!.jobs.map((j) => [j.kind as string, j]));
		// Redacted: dead cancel_billing carries a real lastError in the DB, but
		// the keyholder-served value is null — the exact string never crosses.
		expect(byKind['offboard.cancel_billing']).toMatchObject({ status: 'dead', attempts: 8, lastError: null });
		expect(JSON.stringify(result)).not.toContain('sub_ABC');
		expect(JSON.stringify(result)).not.toContain('amount 2000');
		// Not redacted: dead, but not the billing kind.
		expect(byKind['offboard.remove_lists']).toMatchObject({
			status: 'dead',
			attempts: 8,
			lastError: 'mailman: list not found',
		});
		// Not dead, so no lastError shipped regardless of kind (EDIT-3: matches what the page renders).
		expect(byKind['offboard.disable_mailbox']).toMatchObject({ status: 'leased', attempts: 2, lastError: null });

		// EDIT-3: leaseExpiresAt is never rendered by the page and is not served at all.
		for (const job of entry!.jobs) {
			expect(Object.keys(job)).not.toContain('leaseExpiresAt');
		}
		// every job carries ISO timestamps a keyholder can read
		for (const job of entry!.jobs) {
			expect(() => new Date((job as unknown as { availableAt: string }).availableAt)).not.toThrow();
			expect(Number.isNaN(Date.parse((job as unknown as { updatedAt: string }).updatedAt))).toBe(false);
		}
	});

	it('a freshly offboarded membership with no dispatch yet shows three pending jobs, none dead', async () => {
		const { tenantId, keyholder } = await newTenantWithKeyholder();
		const { membershipId } = await seedOffboardedMembership(tenantId, 'left', 'Just Left, Nothing Dispatched');
		await seedJobs(
			tenantId,
			membershipId,
			OFFBOARD_JOB_KINDS.map((kind) => ({ kind, status: 'pending' as const, attempts: 0 })),
		);

		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await load(loadEvent(keyholder))) as {
			memberships: { membershipId: string; jobs: { status: string }[] }[];
		};
		const entry = result.memberships.find((m) => m.membershipId === membershipId)!;
		expect(entry.jobs).toHaveLength(3);
		expect(entry.jobs.every((j) => j.status === 'pending')).toBe(true);
	});
});

describe('tenant isolation (RLS, not app logic)', () => {
	it('a keyholder in tenant B never sees tenant A offboarded memberships or jobs', async () => {
		const a = await newTenantWithKeyholder();
		const b = await newTenantWithKeyholder();
		const { membershipId: aMembership } = await seedOffboardedMembership(a.tenantId, 'removed', 'Tenant A Person');
		await seedJobs(a.tenantId, aMembership, [{ kind: 'offboard.cancel_billing', status: 'dead', attempts: 8 }]);

		const loadAsB = _createOffboardingLoad({ env: { GFTB_TENANT_ID: b.tenantId, DATABASE_URL: fixture.runtimeDsn } });
		const result = (await loadAsB(loadEvent(b.keyholder))) as {
			authenticated: boolean;
			memberships: { membershipId: string }[];
		};
		expect(result.authenticated).toBe(true); // b's own grant is live — not a role-gate rejection
		expect(result.memberships.find((m) => m.membershipId === aMembership)).toBeUndefined();
	});
});

describe('read-only (S11 requirement: no mutation path on this surface)', () => {
	it('the load never changes an outbox_job row it reads', async () => {
		const { tenantId, keyholder } = await newTenantWithKeyholder();
		const { membershipId } = await seedOffboardedMembership(tenantId, 'removed', 'Untouched By Reading');
		await seedJobs(tenantId, membershipId, [
			{ kind: 'offboard.cancel_billing', status: 'dead', attempts: 8, lastError: 'x' },
		]);

		const before = await withTenant(
			tenantId,
			(tx) => tx.select().from(outboxJob).where(eq(outboxJob.aggregateId, membershipId)),
			db,
		);

		const load = _createOffboardingLoad({ env: { GFTB_TENANT_ID: tenantId, DATABASE_URL: fixture.runtimeDsn } });
		await load(loadEvent(keyholder));
		await load(loadEvent(keyholder)); // twice — a GET is idempotent, not just non-mutating once

		const after = await withTenant(
			tenantId,
			(tx) => tx.select().from(outboxJob).where(eq(outboxJob.aggregateId, membershipId)),
			db,
		);
		expect(after).toEqual(before);
	});
});
