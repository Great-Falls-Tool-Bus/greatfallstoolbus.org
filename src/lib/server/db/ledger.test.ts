/**
 * Drift rules for the immutable migration ledger (TIN-3817 slice S1).
 *
 * These run with no database on purpose. The rules that decide whether a
 * deployment is allowed to touch production DDL should be provable in
 * milliseconds, in `just check`, on a laptop with no Docker — otherwise they
 * only ever get exercised the night they matter.
 *
 * The database-side half (advisory lock, real application, the ledger table
 * itself) lives in `migrate.integration.test.ts` behind `just test-integration`.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { advisoryLockKey } from './migrate';
import {
	diffManifest,
	formatManifest,
	MigrationDriftError,
	parseManifest,
	readPlannedMigrations,
	sha256,
	splitStatements,
	verifyLedger,
	type AppliedMigration,
	type JournalEntry,
} from './ledger';

const scratch: string[] = [];

afterEach(() => {
	while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** Build a throwaway `drizzle/`-shaped directory. */
function fixture(files: Array<{ tag: string; sql: string }>): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'gftb-ledger-'));
	scratch.push(dir);
	mkdirSync(path.join(dir, 'meta'), { recursive: true });
	const entries: JournalEntry[] = files.map((file, idx) => ({
		idx,
		version: '7',
		when: 1_700_000_000_000 + idx,
		tag: file.tag,
		breakpoints: true,
	}));
	writeFileSync(
		path.join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2),
	);
	for (const file of files) writeFileSync(path.join(dir, `${file.tag}.sql`), file.sql);
	return dir;
}

function ledgerRowsFor(dir: string): AppliedMigration[] {
	return readPlannedMigrations(dir).map(({ idx, tag, checksum }) => ({ idx, tag, checksum }));
}

describe('splitStatements', () => {
	it('splits on drizzle-kit breakpoints, not on semicolons', () => {
		const sql = [
			'create table a (id int);',
			'--> statement-breakpoint',
			'do $$ begin perform 1; perform 2; end $$;',
			'--> statement-breakpoint',
			'create table b (id int);',
		].join('\n');

		const statements = splitStatements(sql);
		expect(statements).toHaveLength(3);
		// The whole DO block survives intact. A semicolon splitter would have
		// torn it into three unrunnable fragments, and 0002 is exactly this shape.
		expect(statements[1]).toBe('do $$ begin perform 1; perform 2; end $$;');
	});

	it('drops empty trailing fragments', () => {
		expect(splitStatements('select 1;\n--> statement-breakpoint\n   \n')).toEqual(['select 1;']);
	});
});

describe('readPlannedMigrations', () => {
	it('orders by journal idx and hashes exact bytes', () => {
		const dir = fixture([
			{ tag: '0000_a', sql: 'select 1;' },
			{ tag: '0001_b', sql: 'select 2;' },
		]);

		const planned = readPlannedMigrations(dir);
		expect(planned.map((p) => p.tag)).toEqual(['0000_a', '0001_b']);
		expect(planned[0].checksum).toBe(sha256('select 1;'));
		expect(planned[0].filename).toBe('0000_a.sql');
	});
});

describe('verifyLedger', () => {
	it('returns every migration as pending against an empty ledger', () => {
		const dir = fixture([
			{ tag: '0000_a', sql: 'select 1;' },
			{ tag: '0001_b', sql: 'select 2;' },
		]);
		expect(verifyLedger(readPlannedMigrations(dir), []).map((p) => p.tag)).toEqual(['0000_a', '0001_b']);
	});

	it('returns nothing pending on a re-run — a no-op is the steady state', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		expect(verifyLedger(readPlannedMigrations(dir), ledgerRowsFor(dir))).toEqual([]);
	});

	it('refuses when an applied migration file changed', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const applied = ledgerRowsFor(dir);
		writeFileSync(path.join(dir, '0000_a.sql'), 'select 1; -- one more thing');

		expect(() => verifyLedger(readPlannedMigrations(dir), applied)).toThrow(MigrationDriftError);
		try {
			verifyLedger(readPlannedMigrations(dir), applied);
		} catch (error) {
			expect((error as MigrationDriftError).details.join('\n')).toContain('changed on disk');
		}
	});

	it('refuses when an applied migration was renamed', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const applied = ledgerRowsFor(dir).map((row) => ({ ...row, tag: '0000_old_name' }));
		expect(() => verifyLedger(readPlannedMigrations(dir), applied)).toThrow(/was applied as "0000_old_name"/);
	});

	it('refuses when an applied migration vanished from the journal', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const applied: AppliedMigration[] = [
			...ledgerRowsFor(dir),
			{ idx: 1, tag: '0001_deleted', checksum: sha256('gone') },
		];
		expect(() => verifyLedger(readPlannedMigrations(dir), applied)).toThrow(
			/no longer in drizzle\/meta\/_journal\.json/,
		);
	});

	it('refuses a NEW migration inserted before an applied one', () => {
		// The subtle case: nothing changed and nothing vanished, but idx 0 is
		// unapplied while idx 1 is applied. Applying it now would make "applied
		// migration 1" mean a different database on every environment.
		const dir = fixture([
			{ tag: '0000_inserted', sql: 'select 0;' },
			{ tag: '0001_b', sql: 'select 2;' },
		]);
		const planned = readPlannedMigrations(dir);
		const applied = [{ idx: 1, tag: '0001_b', checksum: planned[1].checksum }];

		expect(() => verifyLedger(planned, applied)).toThrow(/may not be inserted into applied history/);
	});

	it('reports every finding at once rather than the first', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const applied: AppliedMigration[] = [
			{ idx: 0, tag: '0000_a', checksum: 'deadbeef' },
			{ idx: 9, tag: '0009_ghost', checksum: 'deadbeef' },
		];
		try {
			verifyLedger(readPlannedMigrations(dir), applied);
			expect.unreachable('expected drift');
		} catch (error) {
			expect((error as MigrationDriftError).details).toHaveLength(2);
		}
	});
});

describe('the checked-in manifest', () => {
	function manifestFor(dir: string) {
		return parseManifest(formatManifest(readPlannedMigrations(dir)));
	}

	it('is plain sha256sum output, so `shasum -a 256 -c` can audit it without this repo', () => {
		const dir = fixture([
			{ tag: '0000_a', sql: 'select 1;' },
			{ tag: '0001_b', sql: 'select 2;' },
		]);
		const text = formatManifest(readPlannedMigrations(dir));
		expect(text).toBe(`${sha256('select 1;')}  0000_a.sql\n${sha256('select 2;')}  0001_b.sql\n`);
		// Two spaces, not one: that is the separator sha256sum emits and reads.
		expect(text.split('\n')[0]).toMatch(/^[0-9a-f]{64} {2}0000_a\.sql$/);
	});

	it('is clean for a tree it was built from', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		expect(diffManifest(manifestFor(dir), readPlannedMigrations(dir))).toEqual([]);
	});

	it('reports an edit to a committed migration', () => {
		const dir = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const manifest = manifestFor(dir);
		writeFileSync(path.join(dir, '0000_a.sql'), 'drop table members;');
		expect(diffManifest(manifest, readPlannedMigrations(dir))[0]).toMatch(/0000_a\.sql changed/);
	});

	it('reports a migration added without regenerating the manifest', () => {
		const before = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		const manifest = manifestFor(before);
		const after = fixture([
			{ tag: '0000_a', sql: 'select 1;' },
			{ tag: '0001_new', sql: 'select 2;' },
		]);
		expect(diffManifest(manifest, readPlannedMigrations(after))[0]).toMatch(/not recorded/);
	});

	it('reports a migration deleted from the journal but left in the manifest', () => {
		const before = fixture([
			{ tag: '0000_a', sql: 'select 1;' },
			{ tag: '0001_b', sql: 'select 2;' },
		]);
		const manifest = manifestFor(before);
		const after = fixture([{ tag: '0000_a', sql: 'select 1;' }]);
		expect(diffManifest(manifest, readPlannedMigrations(after))).toEqual([
			'0001_b.sql is recorded in migration-ledger.sha256 but is not in the journal',
		]);
	});
});

describe('advisory lock key', () => {
	it('is a stable signed 64-bit value derived from a constant string', () => {
		// Pinned so the derivation documented in constants.ts cannot rot, and so
		// two releases of the migrator can never disagree about which lock they
		// are serialising on — which would silently restore the concurrent-apply
		// hazard this whole mechanism exists to remove.
		const key = advisoryLockKey();
		expect(key).toBe(BigInt.asIntN(64, BigInt(`0x${sha256('gftb:member-v0:migrator').slice(0, 16)}`)));
		expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
		expect(key).toBeLessThan(2n ** 63n);
		expect(advisoryLockKey()).toBe(key);
		expect(advisoryLockKey('something-else')).not.toBe(key);
	});
});
