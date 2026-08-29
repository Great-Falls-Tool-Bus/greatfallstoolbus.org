/**
 * The migrator against a real PostgreSQL 16.15 (TIN-3817 slice S1).
 *
 * Runs under `just test-integration`, which skips loudly when no container
 * daemon answers. Everything here needs a real server: `pg_advisory_lock` has
 * no in-memory analogue, and a ledger that fails closed only matters if the
 * DDL it guards was really applied.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEDGER_QUALIFIED, MIGRATOR_EXIT } from './constants';
import { MIGRATIONS_DIR, exec, query, startPostgres, type PgFixture } from './integration-support';
import { runMigrator } from './migrate';

let pg1: PgFixture;

const scratch: string[] = [];

function sink() {
	const chunks: string[] = [];
	return { write: (chunk: string) => chunks.push(chunk), text: () => chunks.join('') };
}

function io() {
	const stdout = sink();
	const stderr = sink();
	return { io: { stdout, stderr }, stdout, stderr };
}

beforeAll(async () => {
	pg1 = await startPostgres();
}, 180_000);

afterAll(async () => {
	while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
	await pg1?.stop();
});

describe('applying the checked-in migrations', () => {
	it('applies every migration to an empty database and then no-ops', async () => {
		const first = await runMigrator({
			args: ['--dsn', pg1.migratorDsn],
			env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
			io: io().io,
		});
		expect(first.code).toBe(MIGRATOR_EXIT.OK);
		expect(first.applied.length).toBeGreaterThanOrEqual(3);

		const ledger = await query<{ tag: string; checksum: string }>(
			pg1.migratorDsn,
			`select tag, checksum from ${LEDGER_QUALIFIED} order by idx`,
		);
		expect(ledger.map((r) => r.tag)).toEqual(first.applied);

		// A re-run is the steady state of a pre-rollout Job, so it must exit 0 —
		// not "0 because nothing was checked".
		const second = await runMigrator({
			args: ['--dsn', pg1.migratorDsn],
			env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
			io: io().io,
		});
		expect(second.code).toBe(MIGRATOR_EXIT.OK);
		expect(second.applied).toEqual([]);
	}, 120_000);

	it('created the tables, the enum, and the runtime role the migrations declare', async () => {
		const tables = await query<{ table_schema: string; table_name: string }>(
			pg1.migratorDsn,
			`select table_schema, table_name from information_schema.tables
			  where table_schema in ('public', 'auth') order by table_schema, table_name`,
		);
		const names = tables.map((t) => `${t.table_schema}.${t.table_name}`);
		expect(names).toEqual([
			'auth.audit_events',
			'auth.backup_codes',
			'auth.invitations',
			'auth.sessions',
			'auth.totp_secrets',
			'auth.users',
			'public.agreement_version', // S6 (TIN-3440): versioned membership agreement, migration 0009
			'public.application', // S4 (TIN-3440): the application aggregate rides migration 0007
			'public.application_claim', // S5 (TIN-3440): live-claim history, migration 0008
			'public.application_decision', // S5 (TIN-3440): the immutable decision record, migration 0008
			'public.application_email_token', // S4 (TIN-3440): hashed single-use tokens, migration 0007
			'public.assent', // S6 (TIN-3440): the immutable assent record, migration 0009
			'public.asset', // Inventory I1 (TIN-3814): tool asset aggregate, migration 0011
			'public.asset_component', // Inventory I1: expected contents and consumables, migration 0011
			'public.audit_event', // S6 (TIN-3440): the append-only audit spine, migration 0009
			'public.contribution_agreement',
			'public.finance_receipt',
			'public.inspection', // Inventory I1: checkout and return evidence, migration 0011
			'public.loan', // Inventory I1: custody lifecycle, migration 0011
			'public.location_observation', // Inventory I1: consented one-shot location, migration 0011
			'public.mail_delivery_journal', // TIN-4062: the disabled-delivery journal + idempotency receipt, migration 0010
			'public.member_role_grant', // S2 (TIN-3817): the role-grant table rides migration 0003
			'public.membership', // S6/S7 (TIN-3440): the membership aggregate, migration 0009
			'public.outbox_job',
			'public.person', // S6 (TIN-3440): immutable person identity, migration 0009
			'public.person_email', // S6 (TIN-3440): address history, migration 0009
			'public.repair_case', // Inventory I1: repair custody record, migration 0011
			'public.stripe_event_inbox',
			'public.tenant',
		]);

		const [role] = await query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
			pg1.migratorDsn,
			`select rolsuper, rolbypassrls, rolcanlogin from pg_catalog.pg_roles where rolname = 'gftb_app'`,
		);
		expect(role).toBeDefined();
		// Created by the migration with no login and no password: this repository
		// is public and the credential is the apply plane's to issue.
		expect(role.rolcanlogin).toBe(false);
		expect(role.rolsuper).toBe(false);
		expect(role.rolbypassrls).toBe(false);
	}, 60_000);

	it('gives the outbox its claim index on (tenant_id, available_at)', async () => {
		// S3 builds its dispatcher on this index; S1 owes it the shape.
		const [index] = await query<{ indexdef: string }>(
			pg1.migratorDsn,
			`select indexdef from pg_indexes where tablename = 'outbox_job' and indexname = 'outbox_job_claimable'`,
		);
		expect(index.indexdef).toContain('tenant_id');
		expect(index.indexdef).toContain('available_at');
		expect(index.indexdef).toMatch(/WHERE/i);
	}, 60_000);
});

describe('the advisory lock', () => {
	it('lets exactly one of two concurrent migrators apply, and the other wait cleanly', async () => {
		const fresh = await startPostgres();
		try {
			// Both start against the same empty database at the same moment. Without
			// the lock both would read an empty ledger, both would apply 0000, and
			// the second would fail on a duplicate CREATE TABLE — the failure mode
			// `drizzle-kit migrate` leaves open and this applier exists to close.
			const [a, b] = await Promise.all([
				runMigrator({ args: ['--dsn', fresh.migratorDsn], env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR }, io: io().io }),
				runMigrator({ args: ['--dsn', fresh.migratorDsn], env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR }, io: io().io }),
			]);

			expect(a.code).toBe(MIGRATOR_EXIT.OK);
			expect(b.code).toBe(MIGRATOR_EXIT.OK);

			const appliedCounts = [a.applied.length, b.applied.length].sort((x, y) => x - y);
			expect(appliedCounts[0]).toBe(0);
			expect(appliedCounts[1]).toBeGreaterThanOrEqual(3);

			// And the ledger has one row per migration, not two.
			const [{ count }] = await query<{ count: string }>(
				fresh.migratorDsn,
				`select count(*)::text as count from ${LEDGER_QUALIFIED}`,
			);
			expect(Number(count)).toBe(appliedCounts[1]);

			// The lock is released, not leaked, so a third run still works.
			const third = await runMigrator({
				args: ['--dsn', fresh.migratorDsn],
				env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
				io: io().io,
			});
			expect(third.code).toBe(MIGRATOR_EXIT.OK);
			const held = await query<{ count: string }>(
				fresh.migratorDsn,
				`select count(*)::text as count from pg_locks where locktype = 'advisory'`,
			);
			expect(Number(held[0].count)).toBe(0);
		} finally {
			await fresh.stop();
		}
	}, 300_000);
});

describe('ledger drift', () => {
	it('refuses to apply anything when a committed migration changed on disk', async () => {
		const fresh = await startPostgres();
		const mutated = mkdtempSync(path.join(tmpdir(), 'gftb-drift-'));
		scratch.push(mutated);
		try {
			cpSync(MIGRATIONS_DIR, mutated, { recursive: true });

			const applied = await runMigrator({
				args: ['--dsn', fresh.migratorDsn],
				env: { GFTB_MIGRATIONS_DIR: mutated },
				io: io().io,
			});
			expect(applied.code).toBe(MIGRATOR_EXIT.OK);

			// Editing an already-applied migration — the thing forward-only means.
			const target = path.join(mutated, '0000_app_tenant_foundation.sql');
			writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- a harmless-looking edit\n`);

			const drifted = io();
			const result = await runMigrator({
				args: ['--dsn', fresh.migratorDsn],
				env: { GFTB_MIGRATIONS_DIR: mutated },
				io: drifted.io,
			});

			expect(result.code).toBe(MIGRATOR_EXIT.DRIFT);
			expect(result.code).not.toBe(MIGRATOR_EXIT.OK);
			expect(drifted.stderr.text()).toContain('changed on disk');
			expect(drifted.stderr.text()).toContain('forward-only');

			// Nothing was applied, and the ledger still records the ORIGINAL hash:
			// a refusal that quietly rewrote the ledger would be worse than none.
			const ledger = await query<{ checksum: string }>(
				fresh.migratorDsn,
				`select checksum from ${LEDGER_QUALIFIED} where idx = 0`,
			);
			expect(ledger).toHaveLength(1);
			expect(readFileSync(target, 'utf8')).toContain('harmless-looking edit');
			expect(ledger[0].checksum).not.toBe('');
		} finally {
			await fresh.stop();
		}
	}, 300_000);
});

describe('failure modes the Job contract depends on', () => {
	it('exits 78 — not 0 — when the database is unreachable', async () => {
		const result = await runMigrator({
			// Port 1 is reserved and nothing listens on it.
			args: ['--dsn', 'postgres://nobody@127.0.0.1:1/nothing'],
			env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
			io: io().io,
		});
		expect(result.code).toBe(MIGRATOR_EXIT.UNAVAILABLE);
	}, 60_000);

	it('exits 78 when no connection string was supplied at all', async () => {
		const result = await runMigrator({ args: [], env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR }, io: io().io });
		expect(result.code).toBe(MIGRATOR_EXIT.UNAVAILABLE);
	});

	it('exits 70 — a malformed image, not an unavailable database — with no migrations directory', async () => {
		const empty = mkdtempSync(path.join(tmpdir(), 'gftb-nomig-'));
		scratch.push(empty);
		const result = await runMigrator({
			args: ['--dsn', pg1.migratorDsn],
			env: { GFTB_MIGRATIONS_DIR: path.join(empty, 'absent') },
			io: io().io,
		});
		expect(result.code).toBe(MIGRATOR_EXIT.MALFORMED);
	});

	it('reports pending work under --dry-run without applying it', async () => {
		const fresh = await startPostgres();
		try {
			const dry = await runMigrator({
				args: ['--dsn', fresh.migratorDsn, '--dry-run'],
				env: { GFTB_MIGRATIONS_DIR: MIGRATIONS_DIR },
				io: io().io,
			});
			expect(dry.code).toBe(MIGRATOR_EXIT.OK);
			expect(dry.applied).toEqual([]);
			expect(dry.pending.length).toBeGreaterThanOrEqual(3);

			await exec(fresh.superuserDsn, ['select 1']);
			const tables = await query<{ count: string }>(
				fresh.migratorDsn,
				`select count(*)::text as count from information_schema.tables where table_schema = 'public'`,
			);
			expect(Number(tables[0].count)).toBe(0);
		} finally {
			await fresh.stop();
		}
	}, 300_000);
});
