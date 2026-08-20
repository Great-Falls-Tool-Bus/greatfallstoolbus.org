/**
 * The `worker` process boundary (TIN-3817 slice S3).
 *
 * This file is the real implementation behind the entrypoint S0 declared and
 * failed closed: `/bin/worker` in the platform image, a Deployment in
 * `great-falls-tool-bus-infra`, and `just worker-bundle` for the payload. It
 * runs the transactional-outbox dispatch loop from `./outbox/dispatch` and
 * NOTHING else: no HTTP listener, no migrations on startup (spec §6 — only
 * the migrator runs DDL), no mail, no live delivery targets.
 *
 * HANDLERS ARE EMPTY ON PURPOSE. Member v0 has ratified no job kinds yet —
 * S7 (offboarding projections) and S9 (Stripe) register the first real ones.
 * Until then the worker runs `EMPTY_REGISTRY`, so any row that somehow appears
 * burns its attempts and dead-letters VISIBLY instead of being "completed" by
 * a placeholder. A worker that exits 0 while discarding jobs would be the
 * queue-shaped version of the S0 placeholder bug this replaces.
 *
 * CONFIGURATION IS NAMES, NEVER VALUES (ADR 0014 §0.2; this repository is
 * public). `DATABASE_URL` arrives from the apply plane exactly as it does for
 * `web` and the migrator, carrying the DML-only `gftb_app` credential.
 * `GFTB_TENANT_ID` names the one configured GFTB tenant (TIN-3817 scope):
 * under FORCE row-level security a worker cannot *discover* tenants — the
 * `tenant` table itself is policy-guarded — so the tenant is deployment
 * configuration, pinned per transaction through `withTenant`. The value is a
 * non-secret UUID and lives in `great-falls-tool-bus-infra`.
 *
 * THE TENANT ID IS INTEGRITY-CRITICAL, AND STARTUP PROVES IT EXISTS (PR #173
 * review, MEDIUM-3). A ghost UUID would otherwise produce a worker that is
 * indistinguishable from a healthy idle one forever — RLS turns "no such
 * tenant" into "no rows", the exact silent-healthy failure S0's fail-closed
 * doctrine exists to prevent. So startup runs one `select` against the tenant
 * registry inside `withTenant` and exits 78, naming the tenant, when it
 * returns no row. What that probe CANNOT catch: a wrong-but-REAL tenant id.
 * RLS enforces "one tenant per transaction", never "the RIGHT tenant" — a
 * worker pointed at another live tenant executes THAT tenant's jobs normally.
 * The hand-off row to `great-falls-tool-bus-infra` must treat GFTB_TENANT_ID
 * with config-review care, not env-var-default care.
 *
 * WORKER IDENTITY IS OBSERVABILITY, NOT A GUARD (PR #173 review, HIGH-2).
 * `GFTB_WORKER_ID` may be set identically across replicas (a Deployment-level
 * env var is exactly how an operator would set it) without harm: the
 * completion/release/renewal guard is the per-claim lease token minted in
 * `claimBatch`, never the worker name.
 *
 * EXIT CODES mirror the migrator's contract: 0 for `--help`, a clean `--once`
 * cycle, or a graceful signal-driven shutdown; 64 (EX_USAGE) for arguments
 * that do not parse; 78 (EX_UNAVAILABLE) when the database or tenant is
 * unconfigured/unreachable/nonexistent — the code S0 published and the infra
 * Deployment keys its restart behavior on.
 */

import { hostname } from 'node:os';
import { closeDb, resolveConnectionString } from './db/client';
import { tenant } from './db/schema';
import { assertTenantId, withTenant } from './db/tenant';
import { dispatchOnce, runWorkerLoop, type DispatchSummary, type WorkerLoopOptions } from './outbox/dispatch';
import { EMPTY_REGISTRY } from './outbox/handlers';
import { DEFAULT_BATCH_SIZE, DEFAULT_LEASE_SECONDS, type HandlerRegistry } from './outbox/schema';

export const WORKER_EXIT = Object.freeze({
	OK: 0,
	/** sysexits.h EX_USAGE: arguments that do not parse. */
	USAGE: 64,
	/**
	 * Database/tenant unconfigured or unreachable. Inherited from S0's
	 * published contract (the same 78 the migrator uses), because the infra
	 * Deployment keys its restart/backoff behavior on it.
	 */
	UNAVAILABLE: 78,
});

const HELP = `Usage: worker [--help] [--once] [--batch <n>] [--lease <seconds>] [--idle <ms>] [--tenant <uuid>] [--worker-id <name>]

Great Falls Tool Bus platform "worker" process boundary.

Dispatches the transactional outbox (spec §3.1): claims bounded batches with
FOR UPDATE SKIP LOCKED under a lease, runs the registered handler for each
job's kind, retries failures with exponential full-jitter backoff, and
dead-letters a job once its bounded attempt count is spent. At-least-once by
contract; consumers are idempotent by contract. No job kinds are registered
until S7/S9 land, so every claimed row dead-letters visibly rather than being
absorbed by a placeholder.

Options:
  --help               Print this and exit 0. Never touches the database.
  --once               Run exactly one dispatch cycle and exit 0.
  --batch <n>          Claim at most n jobs per cycle (default ${DEFAULT_BATCH_SIZE}).
  --lease <seconds>    Lease duration written on claim (default ${DEFAULT_LEASE_SECONDS}).
  --idle <ms>          Sleep between idle cycles (default 1000).
  --tenant <uuid>      Tenant to dispatch for. Defaults to $GFTB_TENANT_ID.
  --worker-id <name>   lease_owner identity. Defaults to $GFTB_WORKER_ID,
                       then worker-<pid>@<hostname>.

Environment:
  DATABASE_URL     Connection string (DML-only gftb_app role), supplied by the
                   apply plane. A name, never a value, in this repository.
  GFTB_TENANT_ID   The one configured GFTB tenant's UUID (TIN-3817 scope).
                   Startup proves it exists in the tenant registry and exits 78
                   if it does not. Integrity-critical: a wrong-but-REAL tenant
                   id executes that tenant's jobs — RLS cannot detect it.
  GFTB_WORKER_ID   Optional worker identity, for lease_owner OBSERVABILITY
                   only — safe to share across replicas; the completion guard
                   is a per-claim lease token, never this name.

Exit codes:
  ${WORKER_EXIT.OK}   --help, a clean --once cycle, or graceful shutdown
  ${WORKER_EXIT.USAGE}  arguments that do not parse
  ${WORKER_EXIT.UNAVAILABLE}  database or tenant unconfigured/unreachable/nonexistent`;

export interface WorkerIo {
	stdout: { write: (chunk: string) => unknown };
	stderr: { write: (chunk: string) => unknown };
}

export interface WorkerOptions {
	args?: string[];
	env?: NodeJS.ProcessEnv;
	io?: WorkerIo;
	/** The handler set. Production default is the fail-closed EMPTY_REGISTRY. */
	registry?: HandlerRegistry;
	/** Cooperative shutdown for the loop; main() wires SIGTERM/SIGINT to it. */
	signal?: AbortSignal;
	/** Test seam: replaces the single-cycle dispatch. */
	dispatchOnceFn?: typeof dispatchOnce;
	/** Test seam: replaces the polling loop. */
	runLoopFn?: (options: WorkerLoopOptions) => Promise<void>;
	/**
	 * Test seam: replaces the tenant existence probe (review MEDIUM-3).
	 * The default runs one `select` against the tenant registry inside
	 * `withTenant`; resolves true iff the pinned tenant's row exists.
	 */
	probeTenantFn?: (tenantId: string) => Promise<boolean>;
}

/** MEDIUM-3: does the configured tenant exist? Under RLS this is exactly "can this GUC see its own registry row". */
async function probeTenantExists(tenantId: string): Promise<boolean> {
	const rows = await withTenant(tenantId, (tx) => tx.select({ tenantId: tenant.tenantId }).from(tenant).limit(1));
	return rows.length === 1;
}

interface ParsedArgs {
	help: boolean;
	once: boolean;
	batchSize?: number;
	leaseSeconds?: number;
	idleDelayMs?: number;
	tenant?: string;
	workerId?: string;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
	const parsed: ParsedArgs = { help: false, once: false };
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		const takeValue = (name: string): string | { error: string } => {
			const value = args[i + 1];
			if (value === undefined) return { error: `${name} requires a value` };
			i += 1;
			return value;
		};
		const takePositiveInt = (name: string): number | { error: string } => {
			const raw = takeValue(name);
			if (typeof raw !== 'string') return raw;
			const value = Number(raw);
			if (!Number.isInteger(value) || value < 1) return { error: `${name} must be a positive integer, got "${raw}"` };
			return value;
		};

		switch (arg) {
			case '--help':
			case '-h':
				parsed.help = true;
				break;
			case '--once':
				parsed.once = true;
				break;
			case '--batch': {
				const value = takePositiveInt('--batch');
				if (typeof value !== 'number') return value;
				parsed.batchSize = value;
				break;
			}
			case '--lease': {
				const value = takePositiveInt('--lease');
				if (typeof value !== 'number') return value;
				parsed.leaseSeconds = value;
				break;
			}
			case '--idle': {
				const value = takePositiveInt('--idle');
				if (typeof value !== 'number') return value;
				parsed.idleDelayMs = value;
				break;
			}
			case '--tenant': {
				const value = takeValue('--tenant');
				if (typeof value !== 'string') return value;
				parsed.tenant = value;
				break;
			}
			case '--worker-id': {
				const value = takeValue('--worker-id');
				if (typeof value !== 'string') return value;
				parsed.workerId = value;
				break;
			}
			default:
				return { error: `unknown argument "${arg}"` };
		}
	}
	return parsed;
}

function summarize(summary: DispatchSummary): string {
	return (
		`claimed=${summary.claimed} done=${summary.done} retried=${summary.retried} ` +
		`dead=${summary.dead} lost=${summary.lost}`
	);
}

/**
 * Run the worker. Returns an exit code rather than calling `process.exit`, so
 * the S0 dispatcher owns the process and the tests can call it in-process —
 * the same shape as `runMigrator`.
 */
export async function runWorker(options: WorkerOptions = {}): Promise<number> {
	const {
		args = [],
		env = process.env,
		io = { stdout: process.stdout, stderr: process.stderr },
		registry = EMPTY_REGISTRY,
		signal,
		dispatchOnceFn = dispatchOnce,
		runLoopFn = runWorkerLoop,
		probeTenantFn = probeTenantExists,
	} = options;

	const parsed = parseArgs(args);
	if ('error' in parsed) {
		io.stderr.write(`worker: ${parsed.error}\n${HELP}\n`);
		return WORKER_EXIT.USAGE;
	}
	if (parsed.help) {
		io.stdout.write(`${HELP}\n`);
		return WORKER_EXIT.OK;
	}

	// Fail fast, with the migrator's manners: name what is missing and exit 78
	// before opening any socket.
	try {
		resolveConnectionString(env);
	} catch (error) {
		io.stderr.write(`worker: ${(error as Error).message}\n`);
		return WORKER_EXIT.UNAVAILABLE;
	}

	const rawTenant = parsed.tenant ?? env.GFTB_TENANT_ID?.trim();
	if (!rawTenant) {
		io.stderr.write(
			'worker: no tenant. Set GFTB_TENANT_ID (the one configured GFTB tenant, supplied by ' +
				'great-falls-tool-bus-infra) or pass --tenant <uuid>.\n',
		);
		return WORKER_EXIT.UNAVAILABLE;
	}
	let tenantId: string;
	try {
		tenantId = assertTenantId(rawTenant);
	} catch (error) {
		io.stderr.write(`worker: ${(error as Error).message}\n`);
		return WORKER_EXIT.UNAVAILABLE;
	}

	const worker = parsed.workerId ?? env.GFTB_WORKER_ID?.trim() ?? `worker-${process.pid}@${hostname()}`;

	const dispatchOptions = {
		tenantId,
		worker,
		registry,
		batchSize: parsed.batchSize,
		leaseSeconds: parsed.leaseSeconds,
		signal,
	};

	try {
		// MEDIUM-3: fail closed on a tenant the registry does not know. Without
		// this, a typo'd UUID yields a worker indistinguishable from a healthy
		// idle one, forever — RLS turns "no such tenant" into "no rows", never
		// into an error.
		let tenantExists: boolean;
		try {
			tenantExists = await probeTenantFn(tenantId);
		} catch (error) {
			io.stderr.write(`worker: database unavailable while verifying tenant: ${(error as Error).message}\n`);
			return WORKER_EXIT.UNAVAILABLE;
		}
		if (!tenantExists) {
			io.stderr.write(
				`worker: tenant ${tenantId} does not exist in this database's tenant registry. ` +
					'Check GFTB_TENANT_ID against great-falls-tool-bus-infra. Refusing to idle as if healthy. ' +
					'(Note: a wrong-but-REAL tenant id cannot be detected here — RLS enforces one tenant per ' +
					'transaction, never the RIGHT tenant.)\n',
			);
			return WORKER_EXIT.UNAVAILABLE;
		}

		io.stdout.write(
			`worker: ${worker} dispatching tenant ${tenantId} ` +
				`(kinds: ${registry.kinds().length > 0 ? registry.kinds().join(', ') : 'none registered — S7/S9 own the first handlers'})\n`,
		);

		if (parsed.once) {
			const summary = await dispatchOnceFn(dispatchOptions);
			io.stdout.write(`worker: cycle ${summarize(summary)}\n`);
			return WORKER_EXIT.OK;
		}

		await runLoopFn({
			...dispatchOptions,
			idleDelayMs: parsed.idleDelayMs,
			signal,
			onCycle: (summary) => {
				if (summary.claimed > 0) io.stdout.write(`worker: cycle ${summarize(summary)}\n`);
			},
		});
		io.stdout.write('worker: shutdown\n');
		return WORKER_EXIT.OK;
	} catch (error) {
		// The dispatch loop only throws for infrastructure failure (the handler
		// path converts per-job errors into retries). Unreachable database and
		// unconfigured DSN both land here.
		io.stderr.write(`worker: database unavailable: ${(error as Error).message}\n`);
		return WORKER_EXIT.UNAVAILABLE;
	} finally {
		await closeDb().catch(() => undefined);
	}
}

/**
 * Process wrapper. Exported so `scripts/platform-entrypoint.mjs` can hand the
 * `worker` role straight through without re-deriving argument parsing —
 * the same seam `migrate.ts` exposes for the migrator.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const controller = new AbortController();
	const stop = (): void => controller.abort();
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
	try {
		return await runWorker({ args: argv, signal: controller.signal });
	} finally {
		process.removeListener('SIGTERM', stop);
		process.removeListener('SIGINT', stop);
	}
}

// `tsx src/lib/server/worker.ts` and the bundled `build/worker.mjs` both
// arrive here. Imported (dispatcher, tests) it stays inert.
if (process.argv[1] && /(?:worker\.ts|worker\.mjs)$/.test(process.argv[1])) {
	process.exitCode = await main();
}
