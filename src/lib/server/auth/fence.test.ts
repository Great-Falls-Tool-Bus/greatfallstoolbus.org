/**
 * The application-level fence, asserted (TIN-3817 slice S2 — REBUILT after
 * the PR #175 adversarial review's HIGH finding).
 *
 * Spec §0.7's correction is the whole reason this file exists: pinning
 * `@tummycrypt/tinyland-auth@0.3.3` does NOT keep TOTP or the fail-open
 * invitation surface out of Member v0 — 0.3.3 is the version that still
 * SHIPS them ungated, and the adapter hands us their tables either way.
 * The review then proved the first fence bound the wrong surface: it named
 * PACKAGE exports while the reachable path was the adapter's METHODS, and a
 * file calling `adapterFor(tx).getPendingInvitations()` re-exported through
 * index.ts passed every gate green.
 *
 * The rebuilt fence binds the reachable surface, in four layers, all driven
 * by the one manifest in ./fence.ts:
 *   1. runtime — adapterFor's Proxy throws on forbidden method ACCESS
 *      (string/dynamic access included), asserted here without a database;
 *   2. types — adapterFor returns Omit<…, forbidden>, asserted here with
 *      @ts-expect-error so `just typecheck` breaks if the Omit is dropped;
 *   3. lint — eslint bans the imports, static AND dynamic; the config is
 *      asserted to still carry the dynamic-import selector;
 *   4. scan — `scanFenceViolations` walks the tree for call sites and
 *      specifiers, and the reviewer's exact bypass is committed as a
 *      NEGATIVE FIXTURE (fence-bypass.fixture.txt) that must be flagged.
 * Plus the door itself: `Object.keys(index)` must EQUAL the committed
 * allow-list — an unreviewed re-export fails the suite by existing.
 *
 * Also here, because they are repo-shaped rows of the S2 acceptance table:
 * the single-drizzle-copy proof, the no-override-as-proof assertion, the
 * package-journal-unused proof (static half), and the 0003 migration's
 * USING/WITH CHECK + ENABLE/FORCE pairing and vocabulary-freedom.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DbTransaction } from '$lib/server/db/client';
import { adapterFor } from './adapter';
import { DOOR_EXPORT_ALLOWLIST, FORBIDDEN_ADAPTER_METHODS, SCAN_EXEMPT, scanFenceViolations } from './fence';
import * as door from './index';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const srcRoot = path.join(repoRoot, 'src');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (/\.(ts|svelte|js|mjs|mts)$/.test(entry)) out.push(full);
	}
	return out;
}

// src/ plus scripts/ (the review noted scripts/ was unscanned — build tooling
// can import packages too). Repo-root CONFIG files are deliberately not
// walked: vite.config.ts and vitest.integration.config.ts must NAME
// '@tummycrypt/tinyland-auth' to bundle it (the bcryptjs fix), and a config
// names packages, it cannot call them.
const sourceFiles = [...walk(srcRoot), ...walk(path.join(repoRoot, 'scripts'))].map((file) => ({
	rel: path.relative(repoRoot, file).split(path.sep).join('/'),
	text: readFileSync(file, 'utf8'),
}));

describe('layer 4 — the tree scan', () => {
	it('flags nothing in the real tree (the two manifest files exempt, and only those)', () => {
		const offenders = sourceFiles
			.filter(({ rel }) => !(SCAN_EXEMPT as readonly string[]).includes(rel))
			.flatMap(({ rel, text }) => scanFenceViolations(rel, text));
		expect(offenders).toEqual([]);
	});

	it("FAILS on the reviewer's exact bypass — the committed negative fixture", () => {
		const fixture = readFileSync(path.join(repoRoot, 'src/lib/server/auth/fence-bypass.fixture.txt'), 'utf8');
		const offenders = scanFenceViolations('src/lib/server/auth/leak.ts', fixture);
		// The three adapter methods the reviewer read the forbidden tables with:
		expect(offenders).toEqual(
			expect.arrayContaining([
				'src/lib/server/auth/leak.ts: getPendingInvitations',
				'src/lib/server/auth/leak.ts: getBackupCodes',
				'src/lib/server/auth/leak.ts: getTOTPSecret',
			]),
		);
		expect(offenders.length).toBeGreaterThanOrEqual(3);
	});

	it('flags a forbidden adapter-method CALL SITE outside the fixture too', () => {
		const offenders = scanFenceViolations(
			'src/routes/anywhere/+page.server.ts',
			'const a = await something(); await a.createInvitation(tenantId, {} as never);',
		);
		expect(offenders).toContain('src/routes/anywhere/+page.server.ts: createInvitation');
	});

	it('flags a dynamic import literal and a deep door import outside the door', () => {
		expect(
			scanFenceViolations('src/routes/x/+server.ts', "const m = await import('@tummycrypt/tinyland-auth');"),
		).toContain('src/routes/x/+server.ts: auth package imported outside the door');
		expect(
			scanFenceViolations('src/routes/x/+server.ts', "import { setPassword } from '$lib/server/auth/session';"),
		).toContain('src/routes/x/+server.ts: door-internal module imported outside the door');
	});
});

describe('the door — export surface EQUALS the committed allow-list', () => {
	it('exports exactly the allow-list, nothing more, nothing less', () => {
		expect(Object.keys(door).sort()).toEqual([...DOOR_EXPORT_ALLOWLIST].sort());
	});

	it('the allow-list itself names no forbidden surface', () => {
		const leaked = (DOOR_EXPORT_ALLOWLIST as readonly string[]).filter((name) =>
			/totp|invitation|backup|bootstrap|credential|adapter/i.test(name),
		);
		expect(leaked).toEqual([]);
	});
});

describe('layer 1 — the runtime Proxy binds the adapter METHOD surface', () => {
	// No database needed: construction opens nothing, and the trap fires on
	// property ACCESS — before any query could exist.
	const fenced = adapterFor({} as DbTransaction);

	it('throws on access to every forbidden method, by name, however reached', () => {
		for (const method of FORBIDDEN_ADAPTER_METHODS) {
			// Dynamic/string access — the path no static layer can see:
			expect(() => (fenced as unknown as Record<string, unknown>)[method], method).toThrowError(/auth fence/);
		}
	});

	it('still hands out the allowed surface', () => {
		expect(typeof (fenced as unknown as Record<string, unknown>).getUser).toBe('function');
		expect(typeof (fenced as unknown as Record<string, unknown>).createSession).toBe('function');
		expect(typeof (fenced as unknown as Record<string, unknown>).logAuditEvent).toBe('function');
	});

	it('layer 2 — the FencedAdapter type omits the forbidden methods', () => {
		// @ts-expect-error getPendingInvitations is Omit-ted from FencedAdapter —
		// if this line ever compiles, the type fence is gone (and the runtime
		// trap below still catches it).
		expect(() => fenced.getPendingInvitations).toThrowError(/auth fence/);
		// @ts-expect-error getTOTPSecret likewise.
		expect(() => fenced.getTOTPSecret).toThrowError(/auth fence/);
	});
});

describe('layer 3 — the lint config still carries what the scan cannot re-check', () => {
	const eslintConfig = readFileSync(path.join(repoRoot, 'eslint.config.ts'), 'utf8');

	it('bans dynamic import() of the auth packages (ImportExpression selector present)', () => {
		expect(eslintConfig).toMatch(/ImportExpression > Literal\[value=/);
	});

	it('fences the -pg pool-owning constructors and bootstrap surface', () => {
		expect(eslintConfig).toContain('createNodePgStorageAdapter');
		expect(eslintConfig).toContain('bootstrapUsers');
		expect(eslintConfig).toContain('@tummycrypt/tinyland-auth-pg/bootstrap-users');
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
			.filter((rel) => !(SCAN_EXEMPT as readonly string[]).includes(rel));
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
		// `role` would ratify a role list by migration. The append-only trigger
		// constrains row LIFECYCLE (delete/rewrite), never which roles exist.
		expect(migration).not.toMatch(/"role"[^,\n]*CHECK/i);
		expect(migration).not.toMatch(/CREATE TYPE .*role/i);
	});

	it('0003 revokes blanket write from the runtime role and installs the append-only trigger', () => {
		expect(migration).toMatch(/REVOKE UPDATE, DELETE ON "member_role_grant" FROM gftb_app/);
		expect(migration).toMatch(/GRANT UPDATE \("revoked_at"\) ON "member_role_grant" TO gftb_app/);
		expect(migration).toMatch(/CREATE TRIGGER member_role_grant_append_only/);
		expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "member_role_grant"/);
	});
});
