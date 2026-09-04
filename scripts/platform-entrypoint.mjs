#!/usr/bin/env node
// Member v0 platform process dispatcher (TIN-3815, slice S0).
//
// The owner publication contract produces ONE immutable image carrying THREE
// stable process names — `web`, `worker`, and `migrator`. This file is the
// application bundle's single dispatcher. The GF-I09 owner materializer owns
// the OCI wrappers/config that expose those names; this consumer does not
// prescribe links, interpreter paths, image layout, or runtime configuration.
//
// Two invocation shapes are supported, deliberately:
//
//   1. By executable name — `worker --help`. The role is read from
//      `basename(argv[1])`, independent of how the owner materializer exposes
//      that executable.
//   2. By explicit argument — `node scripts/platform-entrypoint.mjs worker
//      --help`. This is the shape a developer can exercise before the Bazel
//      bundle is consumed by the qualified owner publication transaction.
//
// `--help` answers for every role and exits 0 before any role-specific work.
// That is load-bearing: it is the per-entrypoint liveness proof in S0's
// acceptance rows, and it must not require a database, a queue, or a network.
//
// `migrator` was declared and failed closed in S0; TIN-3817 slice S1 filled it
// in, without changing this image contract. It now dispatches into the bundled
// applier (`build/migrator.mjs`, built by Bazel `//:migrator_bundle` or the
// `just db-migrator-bundle` developer mirror from src/lib/server/db/migrate.ts)
// which takes a PostgreSQL advisory lock and
// applies the checked-in drizzle/ migrations against an immutable hash ledger.
// `worker` was the last placeholder; TIN-3817 slice S3 filled it in the same
// way. It dispatches into the bundled outbox worker (`build/worker.mjs`, built
// by Bazel `//:worker_bundle` or the `just worker-bundle` developer mirror from
// src/lib/server/worker.ts), which claims
// transactional-outbox jobs with FOR UPDATE SKIP LOCKED under a lease and
// retries/dead-letters per spec §3.1. All three roles are now real; a missing
// bundle is a malformed image (70), never a healthy no-op.
//
// No secret value, cluster endpoint, or credential belongs in this file — see
// AGENTS.md "Repo Role". Runtime references only.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Stable application roles exported for GF-I09. Order is the help order. */
export const PLATFORM_ROLES = Object.freeze(['web', 'worker', 'migrator']);

/**
 * Roles whose implementation has not landed yet; each names the slice that
 * owns it. Empty since TIN-3817 S3 filled in `worker` — kept (with its help
 * and fail-closed plumbing below) so a future role addition inherits the
 * "declared, never silently healthy" contract instead of re-inventing it.
 */
const PENDING_ROLES = Object.freeze({});

/** One line per implemented role, so `--help` says what the boundary actually does. */
const ROLE_STATUS = Object.freeze({
	web: 'Status: implemented. Serves the adapter-node build output.',
	worker:
		'Status: implemented. Claims transactional-outbox jobs in bounded batches\n' +
		'(FOR UPDATE SKIP LOCKED) under a lease, runs the registered handler per\n' +
		'kind, retries with jittered backoff, and dead-letters after max_attempts.\n' +
		'Run `worker --once` for a single cycle; the worker prints its own option\n' +
		'list once loaded. No job kinds are registered until S7/S9 land.',
	migrator:
		'Status: implemented. Applies the checked-in drizzle/ migrations under a\n' +
		'PostgreSQL advisory lock against the immutable migration hash ledger, then\n' +
		'exits. A no-op is a success. Run `migrator --dry-run` to report without\n' +
		'applying; the applier prints its own option list once loaded.',
});

/** sysexits.h EX_USAGE: the caller named no role, or a role that does not exist. */
export const EXIT_USAGE = 64;
/**
 * The role exists but cannot proceed: its implementation has not landed
 * (`worker`), or the database it needs is unreachable/unconfigured
 * (`migrator`). Published by S0 and inherited unchanged, because the pre-rollout
 * Job in `great-falls-tool-bus-infra` keys its retry on this value.
 */
export const EXIT_UNAVAILABLE = 78;
/**
 * sysexits.h EX_SOFTWARE: the image is malformed — a role's bundle is absent.
 * Deliberately NOT 78: "this image was built wrong" and "the database is not
 * up yet" call for different operator responses, and an image that cannot ever
 * work must not look like one waiting on a dependency.
 */
export const EXIT_MALFORMED = 70;

const ROLE_SET = new Set(PLATFORM_ROLES);

/**
 * Resolve which process boundary was requested.
 *
 * Invocation by executable name wins over the positional argument, so
 * `/bin/worker web` cannot smuggle the web server into a worker Deployment.
 *
 * @param {string} argv1 value of `process.argv[1]` (the script or link path)
 * @param {string[]} args value of `process.argv.slice(2)`
 * @returns {{ role: string | undefined, args: string[] }}
 */
export function resolvePlatformRole(argv1, args) {
	const executableName = path.basename(argv1 ?? '');
	if (ROLE_SET.has(executableName)) return { role: executableName, args };

	const [role, ...rest] = args;
	return { role, args: rest };
}

/**
 * @param {string} role
 * @returns {string}
 */
export function platformRoleHelp(role) {
	const pending = PENDING_ROLES[/** @type {keyof typeof PENDING_ROLES} */ (role)];
	return [
		`Usage: ${role} [--help]`,
		'',
		`Great Falls Tool Bus platform "${role}" process boundary.`,
		'',
		'One image carries all of: ' + PLATFORM_ROLES.join(', ') + '.',
		pending
			? `Status: declared, not yet implemented. Owned by ${pending}.`
			: ROLE_STATUS[/** @type {keyof typeof ROLE_STATUS} */ (role)],
	].join('\n');
}

/**
 * Locate the web server entrypoint.
 *
 * This is `server.js` (TIN-3959), not adapter-node's own generated
 * `build/index.js`: server.js wraps the generated `build/handler.js` with a
 * Cache-Control/ETag fix (see server.js's own header comment) — running
 * `build/index.js` directly ships prerendered HTML with no Cache-Control and
 * an epoch Last-Modified (the build zeroes mtimes for reproducibility),
 * which lets browsers cache the page essentially forever without
 * revalidating.
 *
 * In an owner-materialized image the entrypoint may sit at an absolute path
 * handed over by GFTB_WEB_ENTRYPOINT. In the exported application root the
 * repo-relative `server.js` is the natural default.
 *
 * @param {string | undefined} override
 * @returns {URL}
 */
export function resolveWebEntrypoint(override) {
	if (override) return pathToFileURL(override);
	return new URL('../server.js', import.meta.url);
}

/**
 * Locate the bundled migrator (TIN-3817 S1).
 *
 * Same shape as the web entrypoint: an owner-materialized image may hand over
 * an absolute path through GFTB_MIGRATOR_ENTRYPOINT. In the exported
 * application root the repo-relative `build/migrator.mjs` — the output of
 * Bazel `//:migrator_bundle` (or `just db-migrator-bundle`) — is the natural
 * default.
 *
 * The migrator is a BUNDLE rather than the TypeScript source so it has one
 * immutable entrypoint. The image also carries adapter-node's external
 * runtime node_modules closure for the web process.
 *
 * @param {string | undefined} override
 * @returns {URL}
 */
export function resolveMigratorEntrypoint(override) {
	if (override) return pathToFileURL(override);
	return new URL('../build/migrator.mjs', import.meta.url);
}

/**
 * Locate the bundled outbox worker (TIN-3817 S3). Same contract as the
 * migrator bundle: GFTB_WORKER_ENTRYPOINT in the image, the repo-relative
 * output of Bazel `//:worker_bundle` (or `just worker-bundle`) outside it, and
 * a BUNDLE (pg and drizzle-orm inlined) so worker startup does not depend on
 * the runtime module-resolution layout. The web image separately carries its
 * production node_modules closure.
 *
 * @param {string | undefined} override
 * @returns {URL}
 */
export function resolveWorkerEntrypoint(override) {
	if (override) return pathToFileURL(override);
	return new URL('../build/worker.mjs', import.meta.url);
}

/**
 * @param {{
 *   argv1?: string,
 *   args?: string[],
 *   env?: Record<string, string | undefined>,
 *   stdout?: { write: (chunk: string) => unknown },
 *   stderr?: { write: (chunk: string) => unknown },
 *   importModule?: (href: string) => Promise<unknown>,
 * }} [options]
 * @returns {Promise<number>} the process exit code
 */
export async function runPlatformEntrypoint(options = {}) {
	const {
		argv1 = process.argv[1] ?? '',
		args = process.argv.slice(2),
		env = process.env,
		stdout = process.stdout,
		stderr = process.stderr,
		importModule = (href) => import(href),
	} = options;

	const { role, args: roleArgs } = resolvePlatformRole(argv1, args);

	if (!role || !ROLE_SET.has(role)) {
		stderr.write(
			`platform-entrypoint: expected one of ${PLATFORM_ROLES.join(', ')}` +
				(role ? `, got "${role}"` : ' (no role given)') +
				'\n',
		);
		return EXIT_USAGE;
	}

	if (roleArgs.includes('--help') || roleArgs.includes('-h')) {
		stdout.write(`${platformRoleHelp(role)}\n`);
		return 0;
	}

	if (role === 'web') {
		await importModule(resolveWebEntrypoint(env.GFTB_WEB_ENTRYPOINT).href);
		return 0;
	}

	if (role === 'migrator') {
		const href = resolveMigratorEntrypoint(env.GFTB_MIGRATOR_ENTRYPOINT).href;
		let migrator;
		try {
			migrator = /** @type {{ main?: (args: string[]) => Promise<number> }} */ (await importModule(href));
		} catch (error) {
			stderr.write(
				`platform-entrypoint: migrator bundle not loadable at ${href} ` +
					`(${/** @type {Error} */ (error).message}). Build it with \`just db-migrator-bundle\`.\n`,
			);
			return EXIT_MALFORMED;
		}
		if (typeof migrator.main !== 'function') {
			stderr.write(`platform-entrypoint: ${href} exports no main(); the migrator bundle is malformed.\n`);
			return EXIT_MALFORMED;
		}
		// The applier owns its own exit codes (0 no-op/applied, 65 ledger drift,
		// 78 database unreachable) — see src/lib/server/db/constants.ts.
		return await migrator.main(roleArgs);
	}

	if (role === 'worker') {
		const href = resolveWorkerEntrypoint(env.GFTB_WORKER_ENTRYPOINT).href;
		let worker;
		try {
			worker = /** @type {{ main?: (args: string[]) => Promise<number> }} */ (await importModule(href));
		} catch (error) {
			stderr.write(
				`platform-entrypoint: worker bundle not loadable at ${href} ` +
					`(${/** @type {Error} */ (error).message}). Build it with \`just worker-bundle\`.\n`,
			);
			return EXIT_MALFORMED;
		}
		if (typeof worker.main !== 'function') {
			stderr.write(`platform-entrypoint: ${href} exports no main(); the worker bundle is malformed.\n`);
			return EXIT_MALFORMED;
		}
		// The worker owns its own exit codes (0 help/--once/graceful shutdown,
		// 64 usage, 78 database or tenant unavailable) — see
		// src/lib/server/worker.ts.
		return await worker.main(roleArgs);
	}

	// Unreachable while every ROLE_SET member is implemented; keeps the
	// fail-closed contract for any future declared-only role.
	stderr.write(
		`platform-entrypoint: "${role}" is a reserved Member v0 process boundary; ` +
			`its implementation has not landed yet (${PENDING_ROLES[/** @type {keyof typeof PENDING_ROLES} */ (role)] ?? 'no owning slice recorded'}).\n`,
	);
	return EXIT_UNAVAILABLE;
}

/**
 * True when this module was executed directly rather than imported. Compared
 * through realpath so an owner-selected launcher path still counts as direct.
 *
 * @param {string | undefined} argv1
 * @param {string} moduleUrl
 * @returns {boolean}
 */
export function isDirectInvocation(argv1, moduleUrl) {
	if (!argv1) return false;
	try {
		return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
	} catch {
		return pathToFileURL(argv1).href === moduleUrl;
	}
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
	process.exitCode = await runPlatformEntrypoint();
}
