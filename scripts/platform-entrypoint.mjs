#!/usr/bin/env node
// Member v0 platform process dispatcher (TIN-3815, slice S0).
//
// The platform publishes ONE immutable image carrying THREE stable process
// names — `web`, `worker`, and `migrator`. This file is that image's single
// dispatcher: the image installs `/bin/web`, `/bin/worker`, and
// `/bin/migrator` as thin links onto it, so an OCI runtime (and a Kubernetes
// Deployment/Job) selects a process boundary by executable name rather than by
// a bespoke argv contract per workload.
//
// Two invocation shapes are supported, deliberately:
//
//   1. By linked name — `/bin/worker --help`. The role is read from
//      `basename(argv[1])`. Node keeps argv[1] as the *link* path rather than
//      the realpath, which is what makes the link scheme work at all.
//   2. By explicit argument — `node scripts/platform-entrypoint.mjs worker
//      --help`. This is the shape the Nix wrappers and `just
//      platform-entrypoints-check` use, and the shape a developer gets without
//      an image.
//
// `--help` answers for every role and exits 0 before any role-specific work.
// That is load-bearing: it is the per-entrypoint liveness proof in S0's
// acceptance rows, and it must not require a database, a queue, or a network.
//
// `worker` and `migrator` are declared here and FAIL CLOSED. S1 owns the
// migrator (advisory-locked, hash-ledgered) and S3 owns the outbox dispatcher
// worker; both replace the placeholder below WITHOUT changing this image
// contract. A placeholder that exited 0 would let a Deployment report healthy
// while doing nothing, so the placeholder exits 78 (EX_UNAVAILABLE) instead.
//
// No secret value, cluster endpoint, or credential belongs in this file — see
// AGENTS.md "Repo Role". Runtime references only.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Stable process names carried by the platform image. Order is the help order. */
export const PLATFORM_ROLES = Object.freeze(['web', 'worker', 'migrator']);

/** Roles whose implementation has not landed yet; each names the slice that owns it. */
const PENDING_ROLES = Object.freeze({
	worker: 'S3 (TIN-3817) — transactional outbox dispatcher',
	migrator: 'S1 (TIN-3817) — advisory-locked migrator against the hash ledger',
});

/** sysexits.h EX_USAGE: the caller named no role, or a role that does not exist. */
export const EXIT_USAGE = 64;
/** sysexits.h EX_UNAVAILABLE: the role exists but its implementation has not landed. */
export const EXIT_UNAVAILABLE = 78;

const ROLE_SET = new Set(PLATFORM_ROLES);

/**
 * Resolve which process boundary was requested.
 *
 * Invocation by linked name wins over the positional argument, so
 * `/bin/worker web` cannot smuggle the web server into a worker Deployment.
 *
 * @param {string} argv1 value of `process.argv[1]` (the script or link path)
 * @param {string[]} args value of `process.argv.slice(2)`
 * @returns {{ role: string | undefined, args: string[] }}
 */
export function resolvePlatformRole(argv1, args) {
	const linkedName = path.basename(argv1 ?? '');
	if (ROLE_SET.has(linkedName)) return { role: linkedName, args };

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
			: 'Status: implemented. Serves the adapter-node build output.',
	].join('\n');
}

/**
 * Locate the adapter-node server bundle.
 *
 * In the image the bundle sits at an absolute path handed over by
 * GFTB_WEB_ENTRYPOINT, because the dispatcher itself is installed into the Nix
 * store (or /app/scripts) and cannot assume a repo-relative layout. Outside the
 * image the repo-relative `build/index.js` is the natural default.
 *
 * @param {string | undefined} override
 * @returns {URL}
 */
export function resolveWebEntrypoint(override) {
	if (override) return pathToFileURL(override);
	return new URL('../build/index.js', import.meta.url);
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

	stderr.write(
		`platform-entrypoint: "${role}" is a reserved Member v0 process boundary; ` +
			`its implementation has not landed yet (${PENDING_ROLES[/** @type {keyof typeof PENDING_ROLES} */ (role)]}).\n`,
	);
	return EXIT_UNAVAILABLE;
}

/**
 * True when this module was executed directly rather than imported. Compared
 * through realpath so the /bin/<role> links still count as "direct".
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
