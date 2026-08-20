/**
 * Row-level security, proved against PostgreSQL 16.15 (TIN-3817 slice S1).
 *
 * Every assertion here runs as `gftb_app` or `gftb_migrator` — never as the
 * container superuser, which bypasses RLS unconditionally and would turn this
 * whole file into the specific shape of green that proves nothing.
 *
 * The four properties, and why each has its own row:
 *
 *   cross-tenant read      the headline claim
 *   missing GUC            must DENY, not RAISE — `''::uuid` would raise, which
 *                          is why every policy wraps the GUC in nullif
 *   WITH CHECK             a USING-only policy isolates reads and not writes
 *   FORCE, as the OWNER    without FORCE the migration role reads everything,
 *                          and no test that only used the runtime role would see it
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from './client';
import { RUNTIME_ROLE, TENANT_SCOPED_SCHEMAS } from './constants';
import { currentTenantId, withTenant } from './tenant';
import {
	MIGRATIONS_DIR,
	asTenant,
	credentialRuntimeRole,
	query,
	seedOutboxJob,
	seedTenant,
	startPostgres,
	type PgFixture,
} from './integration-support';
import { runMigrator } from './migrate';

let db: PgFixture;
let tenantA: string;
let tenantB: string;

const silent = { stdout: { write: () => undefined }, stderr: { write: () => undefined } };

beforeAll(async () => {
	db = await startPostgres();
	const migrated = await runMigrator({
		args: ['--dsn', db.migratorDsn],
		env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
		io: silent,
	});
	if (migrated.code !== 0) throw new Error(`fixture migration failed with code ${migrated.code}`);
	await credentialRuntimeRole(db);

	tenantA = await seedTenant(db.migratorDsn, 'tenant-a');
	tenantB = await seedTenant(db.migratorDsn, 'tenant-b');
	await seedOutboxJob(db.migratorDsn, tenantA, 'a.only');
	await seedOutboxJob(db.migratorDsn, tenantB, 'b.only');
}, 240_000);

afterAll(async () => {
	await db?.stop();
});

describe('the catalog, table by table', () => {
	it('has RLS enabled AND forced on every table in every tenant-scoped schema', async () => {
		// Iterating pg_class rather than a hand-written list is the point: a table
		// added by S2 or S4 without a policy fails this row instead of shipping.
		const rows = await query<{
			nspname: string;
			relname: string;
			relrowsecurity: boolean;
			relforcerowsecurity: boolean;
		}>(
			db.migratorDsn,
			`select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
			   from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where c.relkind = 'r' and n.nspname = any($1)
			  order by n.nspname, c.relname`,
			[TENANT_SCOPED_SCHEMAS],
		);

		expect(rows.length).toBeGreaterThanOrEqual(8);
		const unprotected = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity);
		expect(unprotected.map((r) => `${r.nspname}.${r.relname}`)).toEqual([]);
	});

	it('carries a tenant policy with both USING and WITH CHECK on every one of them', async () => {
		const policies = await query<{ schemaname: string; tablename: string; qual: string; with_check: string }>(
			db.migratorDsn,
			`select schemaname, tablename, qual, with_check from pg_policies where schemaname = any($1)`,
			[TENANT_SCOPED_SCHEMAS],
		);
		const tables = await query<{ nspname: string; relname: string }>(
			db.migratorDsn,
			`select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
			  where c.relkind = 'r' and n.nspname = any($1)`,
			[TENANT_SCOPED_SCHEMAS],
		);

		for (const table of tables) {
			const own = policies.filter((p) => p.schemaname === table.nspname && p.tablename === table.relname);
			expect(own.length, `${table.nspname}.${table.relname} has no policy`).toBeGreaterThanOrEqual(1);
			for (const policy of own) {
				expect(policy.qual).toContain('tenant_id');
				// A USING-only policy silently permits an INSERT that writes another
				// tenant's tenant_id, so a null with_check is a finding, not a detail.
				expect(policy.with_check, `${table.nspname}.${table.relname} policy has no WITH CHECK`).toBeTruthy();
			}
		}
	});

	it('gave the six vendored auth tables the policies the package omits', async () => {
		const rows = await query<{ tablename: string }>(
			db.migratorDsn,
			`select tablename from pg_policies where schemaname = 'auth' order by tablename`,
		);
		expect(rows.map((r) => r.tablename)).toEqual([
			'audit_events',
			'backup_codes',
			'invitations',
			'sessions',
			'totp_secrets',
			'users',
		]);
	});
});

describe('the runtime role reads only its own tenant', () => {
	it('returns zero rows for another tenant’s data', async () => {
		const seen = await asTenant(db.runtimeDsn, tenantB, async (client) => {
			const { rows } = await client.query<{ kind: string }>('select kind from outbox_job');
			return rows.map((r) => r.kind);
		});
		expect(seen).toEqual(['b.only']);
		expect(seen).not.toContain('a.only');
	});

	it('sees only its own tenant row in the tenant registry', async () => {
		const seen = await asTenant(db.runtimeDsn, tenantA, async (client) => {
			const { rows } = await client.query<{ tenant_id: string }>('select tenant_id from tenant');
			return rows.map((r) => r.tenant_id);
		});
		expect(seen).toEqual([tenantA]);
	});

	it('returns zero rows — not an error — when the GUC was never set', async () => {
		// `current_setting('app.tenant_id', true)` yields '' here, and ''::uuid
		// RAISES. The nullif in every policy is what turns that into a denial.
		const rows = await asTenant(db.runtimeDsn, null, async (client) => {
			const result = await client.query('select count(*)::int as n from outbox_job');
			return result.rows[0].n as number;
		});
		expect(rows).toBe(0);
	});

	it('returns zero rows — not an error — after the GUC is reset to empty', async () => {
		const rows = await asTenant(db.runtimeDsn, tenantA, async (client) => {
			await client.query(`select set_config('app.tenant_id', '', false)`);
			const result = await client.query('select count(*)::int as n from outbox_job');
			return result.rows[0].n as number;
		});
		expect(rows).toBe(0);
	});

	it('cannot INSERT a row belonging to another tenant', async () => {
		await expect(
			asTenant(db.runtimeDsn, tenantA, async (client) => {
				await client.query(
					`insert into outbox_job (tenant_id, kind, aggregate_type, aggregate_id, payload, idempotency_key)
					 values ($1, 'smuggled', 'fixture', gen_random_uuid(), '{}'::jsonb, $2)`,
					[tenantB, randomUUID()],
				);
			}),
		).rejects.toThrow(/row-level security/i);
	});

	it('cannot UPDATE another tenant’s row into its own', async () => {
		const changed = await asTenant(db.runtimeDsn, tenantA, async (client) => {
			const result = await client.query(`update outbox_job set kind = 'stolen' where kind = 'b.only'`);
			return result.rowCount;
		});
		// Not an error — the row is simply invisible, so zero rows match.
		expect(changed).toBe(0);
	});
});

describe('FORCE ROW LEVEL SECURITY binds the table owner too', () => {
	it('filters the migration role, which owns every table', async () => {
		const [owner] = await query<{ tableowner: string }>(
			db.migratorDsn,
			`select tableowner from pg_tables where tablename = 'outbox_job'`,
		);
		expect(owner.tableowner).toBe('gftb_migrator');

		// Without FORCE this returns both rows: an owner is exempt from its own
		// policies by default, and the migration role owns everything.
		const seen = await asTenant(db.migratorDsn, tenantB, async (client) => {
			const { rows } = await client.query<{ kind: string }>('select kind from outbox_job');
			return rows.map((r) => r.kind);
		});
		expect(seen).toEqual(['b.only']);
	});

	it('is not carrying BYPASSRLS on either non-superuser role', async () => {
		const roles = await query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
			db.migratorDsn,
			`select rolname, rolbypassrls, rolsuper from pg_catalog.pg_roles where rolname in ('gftb_migrator', $1)`,
			[RUNTIME_ROLE],
		);
		expect(roles).toHaveLength(2);
		for (const role of roles) {
			expect(role.rolbypassrls, `${role.rolname} has BYPASSRLS`).toBe(false);
			expect(role.rolsuper, `${role.rolname} is SUPERUSER`).toBe(false);
		}
	});
});

describe('the runtime role holds DML and nothing more', () => {
	it('is accepted on INSERT', async () => {
		const id = await seedOutboxJob(db.runtimeDsn, tenantA, 'runtime.insert');
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('is rejected on CREATE TABLE', async () => {
		await expect(
			asTenant(db.runtimeDsn, tenantA, async (client) => {
				await client.query('create table smuggled_in (id int)');
			}),
		).rejects.toThrow(/permission denied/i);
	});

	it('is rejected on DROP TABLE', async () => {
		await expect(
			asTenant(db.runtimeDsn, tenantA, async (client) => {
				await client.query('drop table outbox_job');
			}),
		).rejects.toThrow(/must be owner|permission denied/i);
	});

	it('cannot read or write the migration ledger at all', async () => {
		// Stronger than a row policy: there is no statement gftb_app can issue
		// that touches migration history.
		await expect(
			asTenant(db.runtimeDsn, tenantA, async (client) => {
				await client.query('select * from migration.applied_migration');
			}),
		).rejects.toThrow(/permission denied/i);
	});
});

describe('withTenant carries the GUC to the connection that runs the query', () => {
	// This is spec §1.3 finding B3, and it is the row S2 inherits. If the GUC
	// does not reach the connection the adapter uses, every read returns null and
	// every write fails WITH CHECK — a silent total auth outage that a suite
	// against a policy-free database would call green.
	let pool: pg.Pool;
	let client: Db;

	beforeAll(() => {
		pool = new pg.Pool({ connectionString: db.runtimeDsn });
		client = createDb(pool);
	});

	afterAll(async () => {
		await pool?.end();
	});

	it('sees the tenant it was opened for, and reads back a NON-NULL row', async () => {
		const seen = await withTenant(
			tenantA,
			async (tx) => {
				expect(await currentTenantId(tx)).toBe(tenantA);
				const rows = await tx.select().from(schema.tenant);
				return rows;
			},
			client,
		);
		expect(seen).toHaveLength(1);
		expect(seen[0].tenantId).toBe(tenantA);
	});

	it('reads zero rows for the other tenant through the SAME client', async () => {
		const seen = await withTenant(tenantB, async (tx) => tx.select().from(schema.outboxJob), client);
		expect(seen.map((row) => row.kind)).not.toContain('a.only');
	});

	it('releases the GUC when the transaction ends, so a pooled connection cannot leak it', async () => {
		await withTenant(tenantA, async () => undefined, client);
		// A fresh transaction on a connection the previous one may have returned
		// to the pool must start with no tenant at all, not with tenantA.
		const leaked = await client.transaction(async (tx) => currentTenantId(tx));
		expect(leaked).toBeNull();
	});

	it('refuses a non-UUID tenant before opening a transaction', async () => {
		await expect(withTenant('not-a-uuid', async () => undefined, client)).rejects.toThrow(/must be a UUID/);
	});
});
