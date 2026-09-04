/**
 * The `migrator` process boundary (TIN-3817 slice S1).
 *
 * This file is the real implementation behind the application `migrator` role
 * S0 declared and failed closed. GF-I09 must expose that role in the qualified
 * owner image; `great-falls-tool-bus-infra` selects it for a pre-rollout Job,
 * and `just db-migrate` is the developer entrypoint. It is the ONLY thing in
 * the fleet that runs DDL. `web` and `worker` never migrate on startup (spec
 * §6).
 *
 * The contract, in order:
 *
 *   1. Take a fixed 64-bit PostgreSQL advisory lock. Every migrator in the
 *      fleet serialises here, so "applied exactly once" survives two pods, a
 *      retried Job, and an operator running `just db-migrate` by hand at the
 *      same moment. `drizzle-kit migrate` takes no such lock, which is one of
 *      the two reasons this applier is first-party.
 *   2. Create the ledger if it is absent — and ONLY then read it, because a
 *      ledger read before the lock is a read of a state another process is
 *      still writing.
 *   3. Refuse, changing nothing, if the ledger and the checked-in migrations
 *      disagree in any of the four ways `verifyLedger` enumerates. Forward-only
 *      by contract (spec §6). This is the second reason the applier is
 *      first-party.
 *   4. Apply each pending migration in its own transaction, inserting its
 *      ledger row inside that same transaction, so a crash mid-migration can
 *      never leave an applied migration unrecorded or a recorded migration
 *      unapplied.
 *   5. Release the lock. Exit 0 — including when there was nothing to do,
 *      because a no-op is the normal steady state of a pre-rollout Job.
 *
 * NO CREDENTIALS. The DSN arrives by the name `DATABASE_URL`. This repository
 * is public and learns names only (ADR 0014 §0.2).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
	LEDGER_QUALIFIED,
	LEDGER_SCHEMA,
	LEDGER_TABLE,
	MIGRATION_ADVISORY_LOCK_SEED,
	MIGRATOR_EXIT,
} from './constants';
import {
	MigrationDriftError,
	readPlannedMigrations,
	sha256,
	splitStatements,
	verifyLedger,
	type AppliedMigration,
	type PlannedMigration,
} from './ledger';

/**
 * The advisory-lock key, derived once from a constant string so it is stable
 * across releases and reproducible by anyone reading this file. A unit test
 * pins the derivation so the comment in `constants.ts` cannot rot.
 */
export function advisoryLockKey(seed: string = MIGRATION_ADVISORY_LOCK_SEED): bigint {
	return BigInt.asIntN(64, BigInt(`0x${sha256(seed).slice(0, 16)}`));
}

export interface MigratorIo {
	stdout: { write: (chunk: string) => unknown };
	stderr: { write: (chunk: string) => unknown };
}

export interface MigratorOptions {
	args?: string[];
	env?: NodeJS.ProcessEnv;
	io?: MigratorIo;
	/** Test seam: build the client. Defaults to a real `pg.Client`. */
	createClient?: (dsn: string) => pg.Client;
}

export interface MigratorResult {
	code: number;
	applied: string[];
	pending: string[];
}

const HELP = `Usage: migrator [--help] [--dry-run] [--dsn <url>]

Great Falls Tool Bus platform "migrator" process boundary.

Applies the checked-in drizzle/ migrations under a PostgreSQL advisory lock,
against the immutable ${LEDGER_QUALIFIED} hash ledger. Forward-only: a changed
or reordered history fails closed and applies nothing.

Options:
  --help        Print this and exit 0. Never touches the database.
  --dry-run     Report the pending migrations and exit 0 without applying.
  --dsn <url>   Connection string. Defaults to $DATABASE_URL.

Environment:
  DATABASE_URL           Connection string, supplied by the apply plane.
  GFTB_MIGRATIONS_DIR    Absolute path to the migrations directory.

Exit codes:
  ${MIGRATOR_EXIT.OK}   applied cleanly, or had nothing to do
  ${MIGRATOR_EXIT.DRIFT}  ledger drift — history changed; nothing was applied
  ${MIGRATOR_EXIT.MALFORMED}  the migrations directory is missing
  ${MIGRATOR_EXIT.UNAVAILABLE}  the database is unreachable or unconfigured`;

/**
 * Locate `drizzle/`.
 *
 * Three candidates, in order of how much the caller told us: the explicit
 * environment name; the application-root layout exported by
 * `//:deployment_bundle` (`build/` next to `drizzle/`); and the repo layout used
 * by `just db-migrate` and the integration suite. A miss is EX_MALFORMED rather
 * than an empty migration set, because "no migrations found" and "no migrations
 * pending" must never look alike.
 */
export function resolveMigrationsDir(
	env: NodeJS.ProcessEnv = process.env,
	moduleUrl: string = import.meta.url,
): string | undefined {
	const fromEnv = env.GFTB_MIGRATIONS_DIR?.trim();
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined;

	const here = path.dirname(fileURLToPath(moduleUrl));
	const candidates = [
		// Bundled: /app/build/migrator.mjs -> /app/drizzle
		path.resolve(here, '..', 'drizzle'),
		// Source: src/lib/server/db/migrate.ts -> <repo>/drizzle
		path.resolve(here, '..', '..', '..', '..', 'drizzle'),
	];
	return candidates.find((candidate) => existsSync(path.join(candidate, 'meta', '_journal.json')));
}

async function ensureLedger(client: pg.Client): Promise<void> {
	await client.query(`create schema if not exists ${LEDGER_SCHEMA}`);
	await client.query(`
		create table if not exists ${LEDGER_QUALIFIED} (
			idx         integer     primary key,
			tag         text        not null unique,
			checksum    text        not null,
			applied_at  timestamptz not null default now(),
			applied_by  text        not null default current_user
		)
	`);
	// The ledger is migration-role property. The DML-only runtime role is never
	// granted anything on it, which is a stronger guarantee than a row policy:
	// there is no statement the runtime role can issue that reads or writes it.
	await client.query(`revoke all on schema ${LEDGER_SCHEMA} from public`);
	await client.query(`revoke all on ${LEDGER_QUALIFIED} from public`);
}

async function readApplied(client: pg.Client): Promise<AppliedMigration[]> {
	const { rows } = await client.query<{ idx: number; tag: string; checksum: string }>(
		`select idx, tag, checksum from ${LEDGER_QUALIFIED} order by idx`,
	);
	return rows.map((row) => ({ idx: Number(row.idx), tag: row.tag, checksum: row.checksum }));
}

async function applyOne(client: pg.Client, migration: PlannedMigration): Promise<void> {
	await client.query('begin');
	try {
		for (const statement of splitStatements(migration.sql)) {
			await client.query(statement);
		}
		await client.query(`insert into ${LEDGER_QUALIFIED} (idx, tag, checksum) values ($1, $2, $3)`, [
			migration.idx,
			migration.tag,
			migration.checksum,
		]);
		await client.query('commit');
	} catch (error) {
		await client.query('rollback').catch(() => undefined);
		throw error;
	}
}

/**
 * Run the migrator. Returns an exit code rather than calling `process.exit`, so
 * the S0 dispatcher can own the process and the integration suite can call it
 * in-process.
 */
export async function runMigrator(options: MigratorOptions = {}): Promise<MigratorResult> {
	const {
		args = [],
		env = process.env,
		io = { stdout: process.stdout, stderr: process.stderr },
		createClient = (dsn: string) => new pg.Client({ connectionString: dsn }),
	} = options;

	if (args.includes('--help') || args.includes('-h')) {
		io.stdout.write(`${HELP}\n`);
		return { code: MIGRATOR_EXIT.OK, applied: [], pending: [] };
	}

	const dryRun = args.includes('--dry-run');
	const dsnFlagIndex = args.indexOf('--dsn');
	const dsn = (dsnFlagIndex >= 0 ? args[dsnFlagIndex + 1] : undefined) ?? env.DATABASE_URL?.trim();
	if (!dsn) {
		io.stderr.write(
			'migrator: no connection string. Set DATABASE_URL (supplied at runtime by great-falls-tool-bus-infra) or pass --dsn.\n',
		);
		return { code: MIGRATOR_EXIT.UNAVAILABLE, applied: [], pending: [] };
	}

	const migrationsDir = resolveMigrationsDir(env);
	if (!migrationsDir) {
		io.stderr.write(
			'migrator: no migrations directory. Expected GFTB_MIGRATIONS_DIR, ../drizzle next to the bundle, or the repo drizzle/.\n',
		);
		return { code: MIGRATOR_EXIT.MALFORMED, applied: [], pending: [] };
	}

	const planned = readPlannedMigrations(migrationsDir);
	const client = createClient(dsn);
	try {
		await client.connect();
	} catch (error) {
		io.stderr.write(`migrator: database unreachable: ${(error as Error).message}\n`);
		return { code: MIGRATOR_EXIT.UNAVAILABLE, applied: [], pending: [] };
	}

	const lockKey = advisoryLockKey().toString();
	let lockHeld = false;
	try {
		await client.query('select pg_advisory_lock($1::bigint)', [lockKey]);
		lockHeld = true;
		io.stdout.write(`migrator: advisory lock ${lockKey} acquired\n`);

		await ensureLedger(client);
		const applied = await readApplied(client);
		const pending = verifyLedger(planned, applied);

		if (pending.length === 0) {
			io.stdout.write(`migrator: up to date — ${applied.length} migration(s) applied, 0 pending\n`);
			return { code: MIGRATOR_EXIT.OK, applied: [], pending: [] };
		}

		if (dryRun) {
			io.stdout.write(`migrator: dry-run — ${pending.length} pending: ${pending.map((p) => p.tag).join(', ')}\n`);
			return { code: MIGRATOR_EXIT.OK, applied: [], pending: pending.map((p) => p.tag) };
		}

		const appliedNow: string[] = [];
		for (const migration of pending) {
			io.stdout.write(`migrator: applying ${migration.filename} (sha256 ${migration.checksum})\n`);
			await applyOne(client, migration);
			appliedNow.push(migration.tag);
		}
		io.stdout.write(`migrator: applied ${appliedNow.length} migration(s)\n`);
		return { code: MIGRATOR_EXIT.OK, applied: appliedNow, pending: [] };
	} catch (error) {
		if (error instanceof MigrationDriftError) {
			io.stderr.write(`${error.message}\n`);
			return { code: MIGRATOR_EXIT.DRIFT, applied: [], pending: [] };
		}
		io.stderr.write(`migrator: failed: ${(error as Error).message}\n`);
		throw error;
	} finally {
		if (lockHeld) await client.query('select pg_advisory_unlock($1::bigint)', [lockKey]).catch(() => undefined);
		await client.end().catch(() => undefined);
	}
}

/**
 * Process wrapper. Exported so `scripts/platform-entrypoint.mjs` can hand the
 * `migrator` role straight through without re-deriving argument parsing.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const { code } = await runMigrator({ args: argv });
	return code;
}

// `tsx src/lib/server/db/migrate.ts` and the bundled `build/migrator.mjs` both
// arrive here. Imported (dispatcher, tests) it stays inert.
if (process.argv[1] && /(?:migrate\.ts|migrator\.mjs)$/.test(process.argv[1])) {
	process.exitCode = await main();
}

export { LEDGER_QUALIFIED, LEDGER_TABLE, MIGRATOR_EXIT };
