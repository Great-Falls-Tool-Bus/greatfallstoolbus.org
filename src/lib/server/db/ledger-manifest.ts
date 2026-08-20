/**
 * Write or verify `drizzle/migration-ledger.sha256` (TIN-3817 slice S1).
 *
 *   just db-generate   -> `write`   (rewrites the manifest from the bytes on disk)
 *   just db-check      -> `verify`  (fails when the tree and the manifest disagree)
 *
 * The database ledger is authoritative, but it is only consulted at deploy
 * time. This manifest is the same fact moved into review: editing a migration
 * production already applied becomes a diff a human sees, rather than a Job
 * that refuses at 03:00.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { diffManifest, formatManifest, LEDGER_MANIFEST_FILENAME, readManifest, readPlannedMigrations } from './ledger';

export function writeLedgerManifest(migrationsDir: string): string {
	const planned = readPlannedMigrations(migrationsDir);
	const target = path.join(migrationsDir, LEDGER_MANIFEST_FILENAME);
	writeFileSync(target, formatManifest(planned), 'utf8');
	return target;
}

export function verifyLedgerManifest(migrationsDir: string): string[] {
	return diffManifest(readManifest(migrationsDir), readPlannedMigrations(migrationsDir));
}

function cli(argv: string[]): number {
	const [command = 'verify', dirArg] = argv;
	const migrationsDir = path.resolve(dirArg ?? 'drizzle');

	if (command === 'write') {
		const target = writeLedgerManifest(migrationsDir);
		process.stdout.write(`db-ledger: wrote ${path.relative(process.cwd(), target)}\n`);
		return 0;
	}

	if (command === 'verify') {
		const problems = verifyLedgerManifest(migrationsDir);
		if (problems.length === 0) {
			process.stdout.write('db-ledger: migration hashes match the checked-in manifest\n');
			return 0;
		}
		process.stderr.write(
			[
				`db-ledger: ${LEDGER_MANIFEST_FILENAME} does not match drizzle/.`,
				'Applied migrations are immutable (spec §6). If this is a NEW migration, run just db-generate.',
				'If it is an EDIT to a committed migration, revert it and add a forward migration instead.',
				`Audit independently with: cd ${path.relative(process.cwd(), migrationsDir)} && shasum -a 256 -c ${LEDGER_MANIFEST_FILENAME}`,
				'',
				...problems.map((p) => `  • ${p}`),
				'',
			].join('\n'),
		);
		return 1;
	}

	process.stderr.write(`db-ledger: unknown command ${JSON.stringify(command)} (expected write or verify)\n`);
	return 64;
}

if (process.argv[1] && /ledger-manifest\.(?:ts|mjs|js)$/.test(process.argv[1])) {
	process.exitCode = cli(process.argv.slice(2));
}
