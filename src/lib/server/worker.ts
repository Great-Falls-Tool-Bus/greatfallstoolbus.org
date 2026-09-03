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
 * HANDLERS START EMPTY AND GROW ONE SLICE AT A TIME. Member v0 registers job
 * kinds as each owning slice lands: S9 (Stripe) registers `stripe.project`
 * (`./outbox/handlers/stripe-project.ts`); S7 registers the three §2.3
 * offboarding projections (`offboard.cancel_billing`, `offboard.remove_lists`,
 * `offboard.disable_mailbox`). `defaultRuntime` registers only effects whose
 * delivery exists and names closed-gate kinds in its deferred claim set. Any
 * OTHER kind still burns its attempts and dead-letters VISIBLY through
 * `UnknownJobKindError`; a deferred kind remains pending at attempts=0. A
 * worker that exits 0 while discarding jobs would be the queue-shaped version
 * of the S0 placeholder bug this replaces.
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
import { createHandlerRegistry } from './outbox/handlers';
import {
	ADD_LISTS_JOB_KIND,
	createListReconciliationHandler,
	REMOVE_LISTS_JOB_KIND,
} from './outbox/handlers/add-lists';
import { cancelBillingHandler } from './outbox/handlers/cancel-billing';
import { createProductionStripeProjectHandler, STRIPE_PROJECT_JOB_KIND } from './outbox/handlers/stripe-project';
import {
	DEFAULT_BATCH_SIZE,
	DEFAULT_LEASE_SECONDS,
	type HandlerRegistry,
	type OutboxHandler,
} from './outbox/schema';
import { createDecisionEmailHandler, DECISION_EMAIL_JOB_KIND } from './outbox/handlers/application-decision-email';
import { createReceiptEmailHandler, RECEIPT_EMAIL_JOB_KIND } from './outbox/handlers/application-receipt-email';
import { createWithdrawnAckHandler, WITHDRAWN_ACK_JOB_KIND } from './outbox/handlers/application-withdrawn-ack';
import { readMailConfig } from './mail/config';
import { activationHazardWarning } from './mail/activation';
import { resolveDiscussListDeliveries } from './lists/mailman';
import { PROVISION_JOB_KINDS, reconcileActiveProvisioning } from './membership/provision';

/**
 * The production runtime: S7's delivery-capable offboarding projections,
 * S9's `stripe.project`
 * (`./outbox/handlers/stripe-project.ts`), the three TIN-4062
 * application-mail kinds (`application.receipt_email`,
 * `application.decision_email`, `application.withdrawn_ack`,
 * `./outbox/handlers/application-*.ts`), and — as of TIN-3964 — the
 * activation projections (`./membership/provision.ts`). Every entitlement is
 * enqueued, but only a kind with real delivery is registered; closed-gate
 * kinds are explicitly deferred rather than completed by placeholders. Any
 * undeclared kind still dead-letters visibly through `UnknownJobKindError`.
 *
 * THE MAIL HANDLERS ALWAYS SEND FOR REAL ONLY IF THEY CAN. `readMailConfig(env)`
 * below is a STARTUP VALIDATION call, same BLOCK-1 posture as
 * `createProductionStripeProjectHandler(env)`: a half-configured
 * `GFTB_MAIL_DELIVERY=enabled` with no transport DSN throws here and maps to
 * exit 78 (EX_UNAVAILABLE) at the try/catch in `runWorker` below, rather than
 * silently degrading. Its RESULT is unused — each handler resolves delivery
 * for itself, per job, per kind (`mail/delivery.ts`'s `resolveDelivery`),
 * because the template-approval gate is PER TEMPLATE: one template becoming
 * operator-approved must never require redeploying to un-break the other two,
 * and an unapproved template must never crash worker startup for kinds that
 * have nothing to do with it. Absent an explicit, operator-attended
 * `GFTB_MAIL_DELIVERY=enabled` + DSN + approved-template combination, every
 * mail handler here resolves to `DisabledDelivery`: no network I/O, ever,
 * from this deployment's default configuration — this repository holds no
 * mail-plane credential (AGENTS non-negotiables), same posture the two
 * offboarding mail projections below already carry.
 *
 * Built fresh per call (not a module constant) so it reads whichever `env`
 * the caller passed rather than always `process.env` — the same reason
 * `readStripeConfig` takes `env` as a parameter.
 */
interface DefaultRuntime {
	registry: HandlerRegistry;
	deferredKinds: readonly string[];
	reconcileProvisioning: true;
}

function defaultRuntime(env: NodeJS.ProcessEnv): DefaultRuntime {
	// BLOCK-1 posture: fail closed on a half-configured mail env at startup,
	// before any job ever claims a mail kind. See the docstring above.
	readMailConfig(env);

	// Same BLOCK-1 posture for list automation (TIN-3964): a half-configured
	// GFTB_LIST_AUTOMATION=enabled with no GFTB_MAILMAN_API_URL throws here
	// and maps to exit 78 below. When the gate is closed (the default), this
	// resolves to `undefined` and BOTH list kinds remain pending at attempts=0.
	// One switch governs both directions; no disabled handler can claim a row.
	const listDeliveries = resolveDiscussListDeliveries(env);

	const handlers: Record<string, OutboxHandler> = {
		[STRIPE_PROJECT_JOB_KIND]: createProductionStripeProjectHandler(env),
		'offboard.cancel_billing': cancelBillingHandler,
		[RECEIPT_EMAIL_JOB_KIND]: createReceiptEmailHandler({ env }),
		[DECISION_EMAIL_JOB_KIND]: createDecisionEmailHandler({ env }),
		[WITHDRAWN_ACK_JOB_KIND]: createWithdrawnAckHandler({ env }),
	};
	const deferredKinds = [
		...PROVISION_JOB_KINDS,
		'offboard.remove_lists',
		'offboard.disable_mailbox',
	];

	if (listDeliveries) {
		const listHandler = createListReconciliationHandler(listDeliveries);
		handlers[REMOVE_LISTS_JOB_KIND] = listHandler;
		handlers[ADD_LISTS_JOB_KIND] = listHandler;
	}

	return {
		registry: createHandlerRegistry(handlers),
		deferredKinds: listDeliveries
			? deferredKinds.filter((kind) => kind !== ADD_LISTS_JOB_KIND && kind !== REMOVE_LISTS_JOB_KIND)
			: deferredKinds,
		reconcileProvisioning: true,
	};
}

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
contract; consumers are idempotent by contract. S9's "stripe.project", S7's
three offboarding kinds ("offboard.cancel_billing", "offboard.remove_lists",
"offboard.disable_mailbox"), TIN-4062's three application-mail kinds
("application.receipt_email", "application.decision_email",
"application.withdrawn_ack"), and delivery-enabled provisioning projections
are registered by default; any other non-deferred job kind still dead-letters
visibly rather than being absorbed by a placeholder. The mail kinds resolve to a disabled,
no-network-I/O journal outcome unless GFTB_MAIL_DELIVERY=enabled, a transport
DSN, and an operator-approved template all agree; the two discuss-list kinds
("provision.add_lists" subscribe, "offboard.remove_lists" unsubscribe)
remain pending with attempts=0 unless GFTB_LIST_AUTOMATION=enabled and a
Mailman REST DSN agree — see Environment below.

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
  GFTB_MAIL_DELIVERY, GFTB_MAIL_SMTP_URL, GFTB_MAIL_FROM_ADDRESS
                   Mail delivery is DISABLED by default (operator interview
                   2026-08-23) regardless of these. All three names, together,
                   AND an operator-approved template are required to reach a
                   real SMTP transport; see src/lib/server/mail/config.ts and
                   src/lib/server/mail/delivery.ts. Half-configured (some but
                   not all three set while GFTB_MAIL_DELIVERY=enabled) fails
                   closed at startup, exit 78.
                   ACTIVATION ORDER MATTERS: approve a template BEFORE
                   enabling delivery. Enabling first strands every job of an
                   unapproved kind in the dead-letter state (they refuse to
                   send, loudly, per spec's fail-closed doctrine — never
                   silently). Startup prints a WARNING (not a failure) when
                   it detects this shape; see mail/activation.ts.
  GFTB_LIST_AUTOMATION, GFTB_MAILMAN_API_URL
                   Discuss-list automation (provision.add_lists subscribe,
                   offboard.remove_lists unsubscribe) is DISABLED by default
                   regardless of these. GFTB_LIST_AUTOMATION must be exactly
                   "enabled" AND GFTB_MAILMAN_API_URL must carry the Mailman 3
                   core REST DSN (https://user:pass@host/ shape, the
                   gftb-mailman-admin-password credential embedded —
                   apply-plane-side value, a name only here) to reach the
                   engine; see src/lib/server/lists/config.ts. Half-configured
                   (enabled without the DSN) fails closed at startup, exit 78.
                   Gate-disabled jobs remain pending with attempts=0. Worker
                   startup reconciles every Active/paused member through the
                   same generation-bound activation fan-out.
  GFTB_PUBLIC_ORIGIN
                   Optional override for the origin rendered links use.
                   Defaults to the production public origin.

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
	/** The handler set. Defaults to `defaultRuntime(env)` — see the module docstring. */
	registry?: HandlerRegistry;
	/** Delivery-gated kinds to leave pending. Used with a caller-supplied registry. */
	deferredKinds?: readonly string[];
	/** Test seam for the default runtime's Active/paused provisioning reconciliation. */
	reconcileProvisioningFn?: (tenantId: string) => Promise<number>;
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
		registry: registryOption,
		deferredKinds: deferredKindsOption,
		reconcileProvisioningFn,
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

	// BLOCK-1 fix (PR #185 adversarial review): `defaultRuntime(env)` calls
	// `readStripeConfig(env)`, which THROWS on a half-configured or
	// non-test-shaped environment (config.ts's own fail-closed contract). That
	// throw must never happen as a destructuring default — a default
	// evaluates before --help/--usage even run and outside every mapped error
	// path below, so it turned a non-secret, plausibly shared env var
	// (STRIPE_PUBLISHABLE_KEY alone) into an unhandled rejection: exit 1, a
	// raw stack trace, and `--help` no longer exiting 0 as its own docstring
	// promises. Building the registry HERE — after the early returns, inside
	// a try mapped to the same 78 (EX_UNAVAILABLE) every other
	// unconfigured/unreachable failure below uses — keeps exit codes to
	// exactly {0, 64, 78} as published, the set the infra Deployment's
	// restart behavior is keyed on.
	let registry: HandlerRegistry;
	let deferredKinds: readonly string[];
	let shouldReconcileProvisioning: boolean;
	try {
		if (registryOption) {
			registry = registryOption;
			deferredKinds = deferredKindsOption ?? [];
			shouldReconcileProvisioning = reconcileProvisioningFn !== undefined;
		} else {
			const runtime = defaultRuntime(env);
			registry = runtime.registry;
			deferredKinds = runtime.deferredKinds;
			shouldReconcileProvisioning = runtime.reconcileProvisioning;
		}
	} catch (error) {
		io.stderr.write(`worker: ${(error as Error).message}\n`);
		return WORKER_EXIT.UNAVAILABLE;
	}

	// PR #208 review E3: half-configured mail env already fails CLOSED above
	// (defaultRuntime's readMailConfig call); this is the softer sibling —
	// a VALID but hazardous shape (enabled, template(s) unapproved) does not
	// fail startup, because it is a legitimate intermediate operator state,
	// but it silently strands every job of an unapproved kind in `dead`
	// unless someone is warned loudly, here, at the one moment a human is
	// most likely watching (start/restart).
	const mailActivationWarning = activationHazardWarning(env);
	if (mailActivationWarning) {
		io.stderr.write(`worker: WARNING: ${mailActivationWarning}\n`);
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
		deferredKinds,
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

		if (shouldReconcileProvisioning) {
			const reconcile =
				reconcileProvisioningFn ??
				((id: string) => withTenant(id, (tx) => reconcileActiveProvisioning(tx)));
			const membershipCount = await reconcile(tenantId);
			if (membershipCount > 0) {
				io.stdout.write(`worker: reconciled provisioning intent for ${membershipCount} active/paused memberships\n`);
			}
		}

		io.stdout.write(
			`worker: ${worker} dispatching tenant ${tenantId} ` +
				`(kinds: ${registry.kinds().length > 0 ? registry.kinds().join(', ') : 'none registered'}; ` +
				`deferred: ${deferredKinds.length > 0 ? deferredKinds.join(', ') : 'none'})\n`,
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
