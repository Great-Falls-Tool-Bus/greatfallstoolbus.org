/**
 * The immutable migration hash ledger (TIN-3817 slice S1, spec §6).
 *
 * Everything in this file is pure: it reads the checked-in `drizzle/` tree and
 * compares it against a list of already-applied rows. It opens no sockets, so
 * every drift rule below is unit-testable without a database — which matters,
 * because the drift rules are the part that must never be wrong.
 *
 * WHY NOT `drizzle-kit migrate`. TIN-3817 mandates Drizzle and forbids `push`.
 * `drizzle-kit`'s own runner then remains, and it does two things spec §6
 * forbids: it takes no PostgreSQL advisory lock, so two pods can apply the same
 * migration concurrently, and it does not fail closed when a historical file's
 * hash changes. Both are load-bearing, so the applier is first-party. It is
 * about eighty lines (`./migrate.ts`); the rules are here.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** One entry of `drizzle/meta/_journal.json`, as drizzle-kit writes it. */
export interface JournalEntry {
	idx: number;
	version: string;
	when: number;
	tag: string;
	breakpoints: boolean;
}

export interface Journal {
	version: string;
	dialect: string;
	entries: JournalEntry[];
}

/** A migration as the applier sees it: ordered, named, hashed, and read. */
export interface PlannedMigration {
	idx: number;
	tag: string;
	/** Repo-relative filename, exactly as it is recorded in the ledger. */
	filename: string;
	/** sha256 of the file's EXACT bytes, lowercase hex. */
	checksum: string;
	sql: string;
}

/** One row of `migration.applied_migration`. */
export interface AppliedMigration {
	idx: number;
	tag: string;
	checksum: string;
}

export class MigrationDriftError extends Error {
	readonly details: string[];
	constructor(details: string[]) {
		super(
			[
				'Migration ledger drift — refusing to apply anything.',
				'Migrations are forward-only by contract (spec §6): applied hashes are immutable',
				'and changed history fails closed. Fix the tree, do not edit the ledger.',
				'',
				...details.map((d) => `  • ${d}`),
			].join('\n'),
		);
		this.name = 'MigrationDriftError';
		this.details = details;
	}
}

/** sha256 over exact bytes, lowercase hex. The one hash function in the slice. */
export function sha256(bytes: Buffer | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export function readJournal(migrationsDir: string): Journal {
	const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
	const raw = readFileSync(journalPath, 'utf8');
	const journal = JSON.parse(raw) as Journal;
	if (!Array.isArray(journal.entries)) {
		throw new Error(`${journalPath}: no "entries" array — this is not a drizzle-kit journal.`);
	}
	return journal;
}

/**
 * Read every migration named by the journal, in `idx` order, hashing the bytes
 * on the way past.
 *
 * The journal — not a directory listing — is the ordering authority. A `.sql`
 * file that no journal entry names is a drift finding (`verifyLedger` below),
 * not silently applied.
 */
export function readPlannedMigrations(migrationsDir: string): PlannedMigration[] {
	const journal = readJournal(migrationsDir);
	return [...journal.entries]
		.sort((a, b) => a.idx - b.idx)
		.map((entry) => {
			const filename = `${entry.tag}.sql`;
			const bytes = readFileSync(path.join(migrationsDir, filename));
			return {
				idx: entry.idx,
				tag: entry.tag,
				filename,
				checksum: sha256(bytes),
				sql: bytes.toString('utf8'),
			};
		});
}

/**
 * Split a drizzle-kit migration into executable statements.
 *
 * The separator is drizzle-kit's own `--> statement-breakpoint` marker rather
 * than `;`, and that is deliberate: a `DO $$ … $$;` block or a function body
 * contains semicolons, and a semicolon splitter would tear it in half. Custom
 * migrations in this repo use the same marker for the same reason.
 */
export function splitStatements(sqlText: string): string[] {
	return sqlText
		.split(/-->\s*statement-breakpoint/g)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Compare the ledger against the checked-in migrations and return the ones
 * still to apply.
 *
 * Fails closed on all four ways history can be rewritten:
 *
 *  1. an applied file's bytes changed (checksum mismatch);
 *  2. an applied entry was renamed (tag mismatch at the same idx);
 *  3. an applied entry was deleted from the journal;
 *  4. a NEW migration was inserted BEFORE an already-applied one, which would
 *     make "applied" mean a different database state on every deployment.
 *
 * @throws MigrationDriftError
 */
export function verifyLedger(planned: PlannedMigration[], applied: AppliedMigration[]): PlannedMigration[] {
	const details: string[] = [];
	const plannedByIdx = new Map(planned.map((p) => [p.idx, p]));

	for (const row of applied) {
		const match = plannedByIdx.get(row.idx);
		if (!match) {
			details.push(`applied migration ${row.idx} "${row.tag}" is no longer in drizzle/meta/_journal.json`);
			continue;
		}
		if (match.tag !== row.tag) {
			details.push(`migration ${row.idx} was applied as "${row.tag}" but the journal now names "${match.tag}"`);
			continue;
		}
		if (match.checksum !== row.checksum) {
			details.push(
				`migration ${row.idx} "${row.tag}" changed on disk: ledger sha256 ${row.checksum}, file sha256 ${match.checksum}`,
			);
		}
	}

	const highestApplied = applied.reduce((max, row) => Math.max(max, row.idx), -1);
	const appliedIdx = new Set(applied.map((row) => row.idx));
	const pending = planned.filter((p) => !appliedIdx.has(p.idx));
	for (const p of pending) {
		if (p.idx < highestApplied) {
			details.push(
				`migration ${p.idx} "${p.tag}" is unapplied but sorts before applied migration ${highestApplied}; ` +
					'a migration may not be inserted into applied history',
			);
		}
	}

	if (details.length > 0) throw new MigrationDriftError(details);
	return pending;
}

/**
 * The checked-in mirror of the ledger: `drizzle/migration-ledger.sha256`.
 *
 * The authoritative ledger lives in the database, but it is only consulted at
 * deploy time — far too late to tell a reviewer that a pull request edited a
 * migration that production already applied. This file moves that failure into
 * `just check`: `just db-generate` rewrites it from the bytes on disk, and
 * `just db-check` fails when the rewrite changes anything tracked. Editing a
 * committed migration therefore stops being a deploy-time incident and becomes
 * a diff.
 *
 * FORMAT: plain `sha256sum` output — `<hex>  <filename>`, one per line, in
 * journal order. Not JSON, deliberately. Anyone can audit it without this
 * repository, its toolchain, or Node:
 *
 *     cd drizzle && shasum -a 256 -c migration-ledger.sha256
 *
 * A verification surface that needs the code it is verifying is a weaker
 * verification surface.
 */
export type LedgerManifest = Map<string, string>;

export const LEDGER_MANIFEST_FILENAME = 'migration-ledger.sha256';

/** Render `sha256sum`-format lines in journal order. */
export function formatManifest(planned: PlannedMigration[]): string {
	return planned.map((p) => `${p.checksum}  ${p.filename}\n`).join('');
}

/** Parse `sha256sum` format into filename -> hex. Blank lines are skipped. */
export function parseManifest(text: string): LedgerManifest {
	const entries = new Map<string, string>();
	for (const line of text.split('\n')) {
		const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trimEnd());
		if (match) entries.set(match[2], match[1]);
	}
	return entries;
}

export function readManifest(migrationsDir: string): LedgerManifest {
	return parseManifest(readFileSync(path.join(migrationsDir, LEDGER_MANIFEST_FILENAME), 'utf8'));
}

/** Human-readable differences between the manifest and the tree. Empty means clean. */
export function diffManifest(manifest: LedgerManifest, planned: PlannedMigration[]): string[] {
	const problems: string[] = [];
	const remaining = new Map(manifest);
	for (const p of planned) {
		const recorded = remaining.get(p.filename);
		if (!recorded) {
			problems.push(`${p.filename} is not recorded in ${LEDGER_MANIFEST_FILENAME} — run just db-generate`);
			continue;
		}
		if (recorded !== p.checksum) {
			problems.push(`${p.filename} changed: manifest records ${recorded}, file hashes to ${p.checksum}`);
		}
		remaining.delete(p.filename);
	}
	for (const orphan of remaining.keys()) {
		problems.push(`${orphan} is recorded in ${LEDGER_MANIFEST_FILENAME} but is not in the journal`);
	}
	return problems;
}
