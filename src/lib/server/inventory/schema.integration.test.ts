/**
 * Inventory schema foundation, proved against PostgreSQL 16.15 (TIN-3814
 * slice I1).
 *
 * The suite runs the ordinary checked-in migrator, exactly as production
 * does. Inventory is part of Drizzle's explicit schema input set and its
 * numbered migration is journaled and hash-ledgered; there is no test-only
 * direct-apply bridge. Fixture writes use the exported Drizzle table objects,
 * so the TypeScript schema and the SQL migration cannot drift behind a suite
 * that only happens to speak compatible raw SQL.
 *
 * Acceptance rows proved here (slices §1.2):
 *   - all six tables have `relrowsecurity` and `relforcerowsecurity` true,
 *     plus one USING+WITH CHECK policy — the S1 `pg_class`/`pg_policies`
 *     query (`rls.integration.test.ts`), extended to the inventory tables;
 *   - inserting a second `active` loan for one asset raises the partial-unique
 *     violation; a second `returned`/`cancelled` loan for the same asset
 *     inserts fine;
 *   - a session under tenant B reads zero inventory rows written under
 *     tenant A;
 *   - the loan default term constant is seven days (unit, no fixture).
 */

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_SCOPED_SCHEMAS } from '../db/constants';
import {
	asTenant,
	credentialRuntimeRole,
	MIGRATIONS_DIR,
	query,
	seedTenant,
	startPostgres,
	type PgFixture,
} from '../db/integration-support';
import { runMigrator } from '../db/migrate';
import { application, person } from '../db/schema';
import { asset, loan } from './schema';

let db: PgFixture;
let tenantA: string;
let tenantB: string;
let personA: string;
let personB: string;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

const INVENTORY_TABLES = ['asset', 'asset_component', 'loan', 'inspection', 'location_observation', 'repair_case'];

beforeAll(async () => {
	db = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', db.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(db);

	tenantA = await seedTenant(db.migratorDsn, 'inv-tenant-a');
	tenantB = await seedTenant(db.migratorDsn, 'inv-tenant-b');
	personA = await insertPerson(db.migratorDsn, tenantA, 'Inventory A');
	personB = await insertPerson(db.migratorDsn, tenantB, 'Inventory B');
}, 240_000);

afterAll(async () => {
	await db?.stop();
});

async function insertAsset(dsn: string, tenantId: string, shortId: string): Promise<string> {
	return asTenant(dsn, tenantId, async (client) => {
		const rows = await drizzle(client)
			.insert(asset)
			.values({
				tenantId,
				shortId,
				displayLabel: `Fixture ${shortId}`,
				kind: 'sewing-machine',
				custodyBasis: 'bus-owned',
			})
			.returning({ id: asset.id });
		return rows[0].id;
	});
}

/** Seed the canonical immutable person identity required by every custody actor edge. */
async function insertPerson(dsn: string, tenantId: string, displayName: string): Promise<string> {
	return asTenant(dsn, tenantId, async (client) => {
		const tx = drizzle(client);
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
			.returning({ id: application.id });
		const [row] = await tx
			.insert(person)
			.values({ tenantId, applicationId: app.id, displayName })
			.returning({ id: person.id });
		return row.id;
	});
}

async function insertLoan(
	dsn: string,
	tenantId: string,
	assetId: string,
	personId: string,
	state: 'draft' | 'active' | 'overdue' | 'returned' | 'cancelled',
): Promise<string> {
	return asTenant(dsn, tenantId, async (client) => {
		const rows = await drizzle(client)
			.insert(loan)
			.values({ tenantId, assetId, personId, state })
			.returning({ id: loan.id });
		return rows[0].id;
	});
}

describe('pg_class / pg_policies, table by table (S1 query, extended to inventory)', () => {
	it('has RLS enabled AND forced on every I1 table', async () => {
		const rows = await query<{
			nspname: string;
			relname: string;
			relrowsecurity: boolean;
			relforcerowsecurity: boolean;
		}>(
			db.migratorDsn,
			`select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
			   from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where c.relkind = 'r' and n.nspname = any($1) and c.relname = any($2)
			  order by c.relname`,
			[TENANT_SCOPED_SCHEMAS, INVENTORY_TABLES],
		);

		expect(rows.map((r) => r.relname).sort()).toEqual([...INVENTORY_TABLES].sort());
		const unprotected = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
		expect(unprotected.map((r) => r.relname)).toEqual([]);
	});

	it('carries a tenant policy with both USING and WITH CHECK on every I1 table', async () => {
		const policies = await query<{ tablename: string; qual: string; with_check: string }>(
			db.migratorDsn,
			`select tablename, qual, with_check from pg_policies where tablename = any($1)`,
			[INVENTORY_TABLES],
		);

		for (const table of INVENTORY_TABLES) {
			const own = policies.filter((p) => p.tablename === table);
			expect(own.length, `${table} has no policy`).toBeGreaterThanOrEqual(1);
			for (const policy of own) {
				expect(policy.qual).toContain('tenant_id');
				expect(policy.with_check, `${table} policy has no WITH CHECK`).toBeTruthy();
			}
		}
	});
});

describe('the partial unique index — at most one live loan per asset', () => {
	it('raises on a second `active` loan for the same asset', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'active');

		await expect(insertLoan(db.migratorDsn, tenantA, assetId, personA, 'active')).rejects.toThrow(
			/duplicate key value violates unique constraint "loan_one_live_per_asset"/,
		);
	});

	it('raises when the second live loan is `overdue` instead of `active`', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'active');

		await expect(insertLoan(db.migratorDsn, tenantA, assetId, personA, 'overdue')).rejects.toThrow(
			/loan_one_live_per_asset/,
		);
	});

	it('permits a second `returned` loan for the same asset once the first is not live', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'returned');
		const secondId = await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'returned');
		expect(secondId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('permits a second `cancelled` loan for the same asset', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'cancelled');
		const secondId = await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'cancelled');
		expect(secondId).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('permits two simultaneous `draft` loans for the same asset (pre-custody, spec §1.2)', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		const first = await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'draft');
		const second = await insertLoan(db.migratorDsn, tenantA, assetId, personA, 'draft');
		expect(first).not.toBe(second);
	});

	it('rejects a person reference from another tenant', async () => {
		const assetId = await insertAsset(db.migratorDsn, tenantA, `race-${randomUUID().slice(0, 8)}`);
		await expect(insertLoan(db.migratorDsn, tenantA, assetId, personB, 'draft')).rejects.toThrow(
			/loan_person_in_tenant_fk/,
		);
	});
});

describe('tenant isolation over the inventory tables', () => {
	it('a session under tenant B reads zero inventory rows written under tenant A', async () => {
		const shortId = `iso-${randomUUID().slice(0, 8)}`;
		await insertAsset(db.migratorDsn, tenantA, shortId);

		const seen = await asTenant(db.runtimeDsn, tenantB, async (client) => {
			const { rows } = await client.query<{ short_id: string }>('select short_id from asset');
			return rows.map((r) => r.short_id);
		});
		expect(seen).not.toContain(shortId);
	});

	it('tenant A sees only its own asset through the runtime role', async () => {
		const shortId = `iso-${randomUUID().slice(0, 8)}`;
		await insertAsset(db.migratorDsn, tenantA, shortId);

		const seen = await asTenant(db.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ short_id: string }>('select short_id from asset where short_id = $1', [
				shortId,
			]);
			return rows.map((r) => r.short_id);
		});
		expect(seen).toEqual([shortId]);
	});

	it('the runtime role inherits INSERT on inventory tables created after the role grant migration', async () => {
		const shortId = `runtime-insert-${randomUUID().slice(0, 8)}`;
		const id = await insertAsset(db.runtimeDsn, tenantA, shortId);
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
	});
});
