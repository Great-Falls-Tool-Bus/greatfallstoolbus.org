/**
 * The application-level fence, asserted (TIN-3817 slice S2).
 *
 * Spec §0.7's correction is the whole reason this file exists: pinning
 * `@tummycrypt/tinyland-auth@0.3.3` does NOT keep TOTP or the fail-open
 * invitation surface out of Member v0 — 0.3.3 is the version that still SHIPS
 * them ungated, and the adapter hands us their tables either way. Spec §4 is
 * satisfied by an app-level fence, and these tests are that fence's committed
 * assertion — "load-bearing rather than decorative". The eslint rules in
 * eslint.config.ts enforce the same boundaries interactively; this file makes
 * their deletion a red test instead of a silent widening.
 *
 * Also here, because they are repo-shaped rather than database-shaped rows of
 * the S2 acceptance table: the single-drizzle-copy proof, the
 * no-override-as-proof assertion, the package-journal-unused proof (static
 * half; the database half is in auth.integration.test.ts), and the
 * USING/WITH CHECK pairing of the S2 migration.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as door from './index';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const srcRoot = path.join(repoRoot, 'src');
const AUTH_DOOR = path.join('src', 'lib', 'server', 'auth');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (/\.(ts|svelte|js|mjs|mts)$/.test(entry)) out.push(full);
	}
	return out;
}

/**
 * Comments may NAME the forbidden things (that is how a fence documents
 * itself); only code may not. So identifier scans run over comment-stripped
 * text. Import specifiers never live in comments, so nothing is lost.
 */
function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const sourceFiles = walk(srcRoot).map((file) => ({
	rel: path.relative(repoRoot, file),
	text: readFileSync(file, 'utf8'),
	code: stripComments(readFileSync(file, 'utf8')),
}));

describe('the auth packages have one door', () => {
	it('nothing outside src/lib/server/auth imports either auth package', () => {
		const offenders = sourceFiles
			.filter(({ rel }) => !rel.startsWith(AUTH_DOOR))
			.filter(({ text }) => /['"]@tummycrypt\/tinyland-auth(-pg)?(\/|['"])/.test(text))
			.map(({ rel }) => rel);
		expect(offenders).toEqual([]);
	});

	it('nothing outside src/lib/server/auth imports the internal adapter seam', () => {
		const offenders = sourceFiles
			.filter(({ rel }) => !rel.startsWith(AUTH_DOOR))
			.filter(({ text }) => /['"][^'"]*server\/auth\/adapter['"]/.test(text))
			.map(({ rel }) => rel);
		expect(offenders).toEqual([]);
	});
});

describe('TOTP and invitations are unreachable from app code (spec §4, §0.7)', () => {
	// The names 0.3.3 exports for the surfaces spec §4 forbids. If a package
	// upgrade renames them, this list must grow before the upgrade lands.
	const forbiddenIdentifiers = [
		'TOTPService',
		'createTOTPService',
		'InvitationService',
		'createInvitationService',
		'BootstrapService',
		'createBootstrapService',
		'generateTOTPSecret',
		'generateTOTPUri',
		'generateTOTPQRCode',
		'generateTOTPToken',
		'getTOTPTimeRemaining',
		'generateTempPassword',
		'generateBackupCodes',
		'createBackupCodeSet',
		'verifyBackupCode',
	];
	const forbiddenSubpaths = ['@tummycrypt/tinyland-auth/totp', '@tummycrypt/tinyland-auth/cred-gen'];

	it('no source file anywhere — the auth door included — names a forbidden export or subpath', () => {
		const offenders: string[] = [];
		for (const { rel, code } of sourceFiles) {
			if (rel === path.join(AUTH_DOOR, 'fence.test.ts')) continue; // this file names them to ban them
			for (const identifier of forbiddenIdentifiers) {
				if (new RegExp(`\\b${identifier}\\b`).test(code)) offenders.push(`${rel}: ${identifier}`);
			}
			for (const subpath of forbiddenSubpaths) {
				if (code.includes(subpath)) offenders.push(`${rel}: ${subpath}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('the door module re-exports no TOTP, invitation, backup-code, bootstrap, or raw-adapter surface', () => {
		const exported = Object.keys(door);
		expect(exported.length).toBeGreaterThan(0);
		const leaked = exported.filter((name) => /totp|invitation|backup|bootstrap|credential|adapter/i.test(name));
		expect(leaked).toEqual([]);
	});

	it('the adapter methods for the forbidden tables are not reachable through any door export', () => {
		// Every runtime export is a function or class the app may call; none of
		// them IS the storage adapter, whose getInvitation/createInvitation/
		// getTOTPSecret methods would otherwise ride along. (adapterFor stays
		// module-internal; eslint + the scan above keep it that way.)
		for (const [name, value] of Object.entries(door)) {
			if (typeof value !== 'function' && typeof value !== 'object') continue;
			const surface = value as unknown as Record<string, unknown>;
			expect(surface?.createInvitation, `door export ${name} exposes createInvitation`).toBeUndefined();
			expect(surface?.getTOTPSecret, `door export ${name} exposes getTOTPSecret`).toBeUndefined();
		}
	});
});

describe('exactly one drizzle-orm, at exactly the version the adapter forces (spec §0.7)', () => {
	it('the lockfile resolves a single drizzle-orm version: 0.39.3', () => {
		// `pnpm ls drizzle-orm` is the interactive form of this row; the lockfile
		// is what CI and the ledger of record actually pin. Package keys in
		// pnpm-lock v9 look like `drizzle-orm@0.39.3:` or
		// `drizzle-orm@0.39.3(peer)(suffixes):` — same version, one copy.
		const lockfile = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
		const versions = new Set(
			[...lockfile.matchAll(/^\s{2}drizzle-orm@([0-9]+\.[0-9]+\.[0-9]+)[(:]/gm)].map((m) => m[1]),
		);
		expect([...versions]).toEqual(['0.39.3']);
	});

	it('package.json pins the pair exactly, no ranges', () => {
		const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		expect(pkg.dependencies['@tummycrypt/tinyland-auth']).toBe('0.3.3');
		expect(pkg.dependencies['@tummycrypt/tinyland-auth-pg']).toBe('0.2.4');
		expect(pkg.dependencies['drizzle-orm']).toBe('0.39.3');
	});
});

describe('no override-as-proof (spec §4)', () => {
	it('pnpm.overrides contains no @tummycrypt/* entry', () => {
		// S1's migrations.test.ts asserts the overrides map is entirely empty,
		// which is stronger; this row re-states the S2 acceptance table's exact
		// claim so it survives even if an unrelated override is ever justified.
		const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		const overrides: Record<string, string> = pkg.pnpm?.overrides ?? {};
		expect(Object.keys(overrides).filter((k) => k.startsWith('@tummycrypt/'))).toEqual([]);
	});
});

describe("the package's own migration journal is never invoked (spec §1.3 M11)", () => {
	it('our journal carries no tag of the package journal, and every tag is ours', () => {
		const journal = JSON.parse(readFileSync(path.join(repoRoot, 'drizzle', 'meta', '_journal.json'), 'utf8')) as {
			entries: Array<{ tag: string }>;
		};
		const tags = journal.entries.map((e) => e.tag);
		expect(tags.some((t) => t.includes('lush_carmella'))).toBe(false);
		// The vendored copy rides OUR ledger under OUR name:
		expect(tags).toContain('0001_auth_pg_vendored_0_2_4');
	});

	it('no source file reaches into the package drizzle directory', () => {
		const offenders = sourceFiles
			.filter(({ text }) => text.includes('tinyland-auth-pg/drizzle'))
			.map(({ rel }) => rel)
			.filter((rel) => rel !== path.join(AUTH_DOOR, 'fence.test.ts'));
		expect(offenders).toEqual([]);
	});
});

describe('the S2 migration carries its own belt and suspenders', () => {
	// SQL comments narrate the DDL and may name what it does; count only the
	// statements themselves.
	const migration = readFileSync(path.join(repoRoot, 'drizzle', '0003_member_role_grant.sql'), 'utf8')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('--'))
		.join('\n');

	it('0003 pairs every USING with a WITH CHECK and every ENABLE with a FORCE', () => {
		const usings = migration.match(/USING\s*\(/g) ?? [];
		const checks = migration.match(/WITH CHECK\s*\(/g) ?? [];
		expect(usings.length).toBeGreaterThan(0);
		expect(checks).toHaveLength(usings.length);
		const enabled = migration.match(/ENABLE ROW LEVEL SECURITY/g) ?? [];
		const forced = migration.match(/FORCE ROW LEVEL SECURITY/g) ?? [];
		expect(enabled.length).toBeGreaterThan(0);
		expect(forced).toHaveLength(enabled.length);
	});

	it('0003 places no CHECK constraint on role — the vocabulary is sitting #2 Item 2, not a migration', () => {
		// `WITH CHECK` is the RLS policy half and is required; a column CHECK on
		// `role` would ratify a role list by migration.
		expect(migration).not.toMatch(/"role"[^,\n]*CHECK/i);
		expect(migration).not.toMatch(/CREATE TYPE .*role/i);
	});
});
