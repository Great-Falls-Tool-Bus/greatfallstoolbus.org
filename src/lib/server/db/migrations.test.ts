/**
 * Repository-shape assertions for the migration surface (TIN-3817 slice S1).
 *
 * These are the acceptance rows that are true or false about the TREE rather
 * than about a running database, so they belong in `just check` where a
 * reviewer sees them, not in the Docker-gated integration suite where this
 * repository's CI cannot currently run them at all.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diffManifest, readManifest, readPlannedMigrations } from './ledger';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const migrationsDir = path.join(repoRoot, 'drizzle');

function read(relative: string): string {
	return readFileSync(path.join(repoRoot, relative), 'utf8');
}

/** Justfile lines with `#` comments stripped, so prose about `push` is not mistaken for a call. */
function justfileCommands(): string {
	return read('Justfile')
		.split('\n')
		.map((line) => line.replace(/#.*$/, ''))
		.join('\n');
}

describe('the migration tree is checked in', () => {
	it('is where the test thinks it is', () => {
		expect(existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
		expect(existsSync(path.join(migrationsDir, 'meta', '_journal.json'))).toBe(true);
	});

	it('carries generated SQL for every journal entry', () => {
		const planned = readPlannedMigrations(migrationsDir);
		expect(planned.length).toBeGreaterThanOrEqual(3);
		for (const migration of planned) {
			expect(existsSync(path.join(migrationsDir, migration.filename))).toBe(true);
		}
	});

	it('matches drizzle/migration-ledger.sha256 byte for byte', () => {
		// The source-level half of the immutable hash ledger: editing a committed
		// migration shows up here, in review, instead of at 03:00 in a pre-rollout
		// Job. Regenerate with `just db-generate`.
		expect(diffManifest(readManifest(migrationsDir), readPlannedMigrations(migrationsDir))).toEqual([]);
	});

	it('vendors the auth adapter DDL with the provenance receipt intact', () => {
		const vendored = read('drizzle/0001_auth_pg_vendored_0_2_4.sql');
		expect(vendored).toContain('@tummycrypt/tinyland-auth-pg@0.2.4');
		expect(vendored).toContain('98c9942ec60503d697ccaa8e435cd968cced0af178af50fbbb78e76c6379facb');
		// All six tables the package ships, each with the RLS it omits (spec §1.3 M11).
		for (const table of ['audit_events', 'backup_codes', 'invitations', 'sessions', 'totp_secrets', 'users']) {
			expect(vendored).toContain(`CREATE TABLE "auth"."${table}"`);
			expect(vendored).toContain(`ALTER TABLE "auth"."${table}" FORCE ROW LEVEL SECURITY;`);
			expect(vendored).toContain(`CREATE POLICY "${table}_tenant" ON "auth"."${table}"`);
		}
	});

	it('writes every policy to deny — not to raise — on an unset tenant GUC', () => {
		// `current_setting(…, true)` returns '' (not NULL) for a GUC that was set
		// and then reset, and ''::uuid RAISES. A policy missing the nullif turns a
		// finished session into an error factory instead of an empty result.
		for (const file of [
			'drizzle/0001_auth_pg_vendored_0_2_4.sql',
			'drizzle/0002_rls_force_and_runtime_grants.sql',
			'drizzle/0005_payment_rails_rls_grants.sql',
		]) {
			const sql = read(file);
			// Anchored to the start of a line so the prose explaining the rule is
			// not counted as an instance of it.
			const policies = sql.match(/^CREATE POLICY/gm) ?? [];
			const usings =
				sql.match(/^\tUSING\s+\(tenant_id = nullif\(current_setting\('app\.tenant_id', true\), ''\)::uuid\)$/gm) ?? [];
			const checks =
				sql.match(/^\tWITH CHECK \(tenant_id = nullif\(current_setting\('app\.tenant_id', true\), ''\)::uuid\);$/gm) ??
				[];
			expect(policies.length).toBeGreaterThan(0);
			// Every policy constrains reads AND writes. A USING-only policy silently
			// permits an INSERT that writes another tenant's tenant_id.
			expect(usings).toHaveLength(policies.length);
			expect(checks).toHaveLength(policies.length);
		}
	});

	it('forces row-level security on every table it enables it for', () => {
		for (const file of [
			'drizzle/0001_auth_pg_vendored_0_2_4.sql',
			'drizzle/0002_rls_force_and_runtime_grants.sql',
			'drizzle/0005_payment_rails_rls_grants.sql',
		]) {
			const sql = read(file);
			const enabled = sql.match(/^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;$/gm) ?? [];
			const forced = sql.match(/^ALTER TABLE .* FORCE ROW LEVEL SECURITY;$/gm) ?? [];
			expect(enabled.length).toBeGreaterThan(0);
			// Without FORCE the table owner — the migration role — bypasses every
			// policy, and the isolation is decorative.
			expect(forced).toHaveLength(enabled.length);
		}
	});
});

describe('drizzle push is banned, not merely discouraged', () => {
	it('appears in no Justfile recipe', () => {
		expect(justfileCommands()).not.toMatch(/drizzle-kit\s+push|drizzle\s+push/);
	});

	it('appears in no package.json script', () => {
		const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
		for (const [name, body] of Object.entries(scripts)) {
			expect(`${name}: ${body}`).not.toMatch(/push/);
		}
	});

	it('is not what drizzle.config.ts is wired for', () => {
		const config = read('drizzle.config.ts');
		expect(config).toContain("out: './drizzle'");
		expect(config).toContain("schema: './src/lib/server/db/schema.ts'");
	});
});

describe('dependency pins the auth adapter forces (spec §0.7)', () => {
	const pkg = JSON.parse(read('package.json')) as {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
		pnpm?: { overrides?: Record<string, string> };
	};

	it('pins drizzle-orm to the adapter’s EXACT version, not a range', () => {
		// @tummycrypt/tinyland-auth-pg@0.2.4 depends on drizzle-orm at the exact
		// version 0.39.3. A caret here resolves a second copy, and the adapter's
		// tables and ours end up on different query builders — which fails as a
		// type error at best and as a silent empty result at worst.
		expect(pkg.dependencies['drizzle-orm']).toBe('0.39.3');
	});

	it('keeps drizzle-kit inside the adapter’s dev range', () => {
		expect(pkg.devDependencies['drizzle-kit']).toBe('^0.30.5');
	});

	it('keeps pg inside the adapter’s declared range', () => {
		expect(pkg.dependencies['pg']).toBe('^8.20.0');
	});

	it('uses no pnpm override to manufacture compatibility', () => {
		// Spec §4 bans peer overrides or local casts as production compatibility
		// proof. S2 re-asserts this for @tummycrypt/*; S1 asserts there is no
		// override map at all to grow one in.
		expect(pkg.pnpm?.overrides ?? {}).toEqual({});
	});
});
