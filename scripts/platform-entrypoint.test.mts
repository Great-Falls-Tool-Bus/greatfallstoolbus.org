// Contract tests for the platform process dispatcher (TIN-3815 slice S0,
// extended by TIN-3817 slices S1 and S3).
//
// These lock the application dispatcher contract, not GF-I09's still-missing
// final image wrappers/config: three stable role names, `--help` answering 0
// for each without side effects, and an unimplemented role failing CLOSED
// rather than reporting healthy.
//
// S1 landed the migrator and S3 landed the worker, so the rows that asserted
// those roles fail closed now assert they DISPATCH — the contract they were
// protecting (never exit 0 while doing nothing) is unchanged: a missing bundle
// is a malformed image (70), never a healthy no-op.

import { describe, expect, it } from 'vitest';

import {
	EXIT_MALFORMED,
	EXIT_UNAVAILABLE,
	EXIT_USAGE,
	PLATFORM_ROLES,
	isDirectInvocation,
	platformRoleHelp,
	resolveMigratorEntrypoint,
	resolvePlatformRole,
	resolveWebEntrypoint,
	resolveWorkerEntrypoint,
	runPlatformEntrypoint,
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore -- plain .mjs dispatcher, deliberately carried verbatim in the bundle
} from './platform-entrypoint.mjs';

function capture() {
	const chunks: string[] = [];
	return { write: (chunk: string) => chunks.push(chunk), text: () => chunks.join('') };
}

describe('platform dispatcher role contract', () => {
	it('carries exactly web, worker, and migrator', () => {
		expect(PLATFORM_ROLES).toEqual(['web', 'worker', 'migrator']);
	});

	it('resolves the role from the linked executable name', () => {
		expect(resolvePlatformRole('/bin/worker', [])).toEqual({ role: 'worker', args: [] });
		expect(resolvePlatformRole('/usr/local/bin/migrator', ['--help'])).toEqual({
			role: 'migrator',
			args: ['--help'],
		});
	});

	it('falls back to the first positional argument when not invoked by link name', () => {
		expect(resolvePlatformRole('/app/scripts/platform-entrypoint.mjs', ['web', '--help'])).toEqual({
			role: 'web',
			args: ['--help'],
		});
	});

	it('lets the linked name win, so /bin/worker cannot be argued into serving web', () => {
		expect(resolvePlatformRole('/bin/worker', ['web'])).toEqual({ role: 'worker', args: ['web'] });
	});
});

describe('--help', () => {
	it.each(PLATFORM_ROLES)('exits 0 for %s and names the role', async (role: string) => {
		const stdout = capture();
		const stderr = capture();

		const code = await runPlatformEntrypoint({
			argv1: `/bin/${role}`,
			args: ['--help'],
			env: {},
			stdout,
			stderr,
			importModule: async () => {
				throw new Error('--help must not load the server bundle');
			},
		});

		expect(code).toBe(0);
		expect(stdout.text()).toContain(`Usage: ${role}`);
		expect(stderr.text()).toBe('');
	});

	it('describes every role as implemented — a "declared only" line on a shipped role is a lie an operator acts on', () => {
		expect(platformRoleHelp('web')).not.toContain('not yet implemented');
		// TIN-3817 S1: the migrator is real.
		expect(platformRoleHelp('migrator')).not.toContain('not yet implemented');
		expect(platformRoleHelp('migrator')).toContain('advisory lock');
		// TIN-3817 S3: the worker is real.
		expect(platformRoleHelp('worker')).not.toContain('not yet implemented');
		expect(platformRoleHelp('worker')).toContain('SKIP LOCKED');
	});
});

describe('role dispatch', () => {
	it('loads the adapter-node bundle for web', async () => {
		const loaded: string[] = [];
		const code = await runPlatformEntrypoint({
			argv1: '/bin/web',
			args: [],
			env: { GFTB_WEB_ENTRYPOINT: '/app/build/index.js' },
			stdout: capture(),
			stderr: capture(),
			importModule: async (href: string) => {
				loaded.push(href);
			},
		});

		expect(code).toBe(0);
		expect(loaded).toEqual(['file:///app/build/index.js']);
	});

	it('runs the bundled outbox worker and returns ITS exit code', async () => {
		const seen: { href?: string; args?: string[] } = {};
		const code = await runPlatformEntrypoint({
			argv1: '/bin/worker',
			args: ['--once'],
			env: { GFTB_WORKER_ENTRYPOINT: '/app/build/worker.mjs' },
			stdout: capture(),
			stderr: capture(),
			importModule: async (href: string) => {
				seen.href = href;
				return {
					main: async (args: string[]) => {
						seen.args = args;
						return 0;
					},
				};
			},
		});

		expect(code).toBe(0);
		expect(seen.href).toBe('file:///app/build/worker.mjs');
		expect(seen.args).toEqual(['--once']);
	});

	it('passes the worker exit code through unchanged, including 78 for an unconfigured database', async () => {
		const code = await runPlatformEntrypoint({
			argv1: '/bin/worker',
			args: [],
			env: { GFTB_WORKER_ENTRYPOINT: '/app/build/worker.mjs' },
			stdout: capture(),
			stderr: capture(),
			importModule: async () => ({ main: async () => EXIT_UNAVAILABLE }),
		});

		expect(code).toBe(EXIT_UNAVAILABLE);
	});

	it('reports a missing worker bundle as a malformed image, not as an unavailable database', async () => {
		const stderr = capture();
		const code = await runPlatformEntrypoint({
			argv1: '/bin/worker',
			args: [],
			env: { GFTB_WORKER_ENTRYPOINT: '/app/build/worker.mjs' },
			stdout: capture(),
			stderr,
			importModule: async () => {
				throw new Error('ERR_MODULE_NOT_FOUND');
			},
		});

		expect(code).toBe(EXIT_MALFORMED);
		expect(code).not.toBe(EXIT_UNAVAILABLE);
		expect(stderr.text()).toContain('just worker-bundle');
	});

	it('reports a worker bundle with no main() as malformed', async () => {
		const stderr = capture();
		const code = await runPlatformEntrypoint({
			argv1: '/bin/worker',
			args: [],
			env: { GFTB_WORKER_ENTRYPOINT: '/app/build/worker.mjs' },
			stdout: capture(),
			stderr,
			importModule: async () => ({}),
		});

		expect(code).toBe(EXIT_MALFORMED);
		expect(stderr.text()).toContain('exports no main()');
	});

	it('runs the bundled applier for migrator and returns ITS exit code', async () => {
		const seen: { href?: string; args?: string[] } = {};
		const code = await runPlatformEntrypoint({
			argv1: '/bin/migrator',
			args: ['--dry-run'],
			env: { GFTB_MIGRATOR_ENTRYPOINT: '/app/build/migrator.mjs' },
			stdout: capture(),
			stderr: capture(),
			importModule: async (href: string) => {
				seen.href = href;
				return {
					main: async (args: string[]) => {
						seen.args = args;
						return 0;
					},
				};
			},
		});

		expect(code).toBe(0);
		expect(seen.href).toBe('file:///app/build/migrator.mjs');
		expect(seen.args).toEqual(['--dry-run']);
	});

	it('passes the applier exit code through unchanged, including 78 for an unreachable database', async () => {
		const code = await runPlatformEntrypoint({
			argv1: '/bin/migrator',
			args: [],
			env: { GFTB_MIGRATOR_ENTRYPOINT: '/app/build/migrator.mjs' },
			stdout: capture(),
			stderr: capture(),
			importModule: async () => ({ main: async () => EXIT_UNAVAILABLE }),
		});

		expect(code).toBe(EXIT_UNAVAILABLE);
	});

	it('reports a missing migrator bundle as a malformed image, not as an unavailable database', async () => {
		const stderr = capture();
		const code = await runPlatformEntrypoint({
			argv1: '/bin/migrator',
			args: [],
			env: { GFTB_MIGRATOR_ENTRYPOINT: '/app/build/migrator.mjs' },
			stdout: capture(),
			stderr,
			importModule: async () => {
				throw new Error('ERR_MODULE_NOT_FOUND');
			},
		});

		expect(code).toBe(EXIT_MALFORMED);
		expect(code).not.toBe(EXIT_UNAVAILABLE);
		expect(stderr.text()).toContain('just db-migrator-bundle');
	});

	it('rejects an unknown or missing role with EX_USAGE', async () => {
		const stderr = capture();
		expect(await runPlatformEntrypoint({ argv1: '/app/x.mjs', args: [], env: {}, stdout: capture(), stderr })).toBe(
			EXIT_USAGE,
		);
		expect(
			await runPlatformEntrypoint({ argv1: '/app/x.mjs', args: ['shell'], env: {}, stdout: capture(), stderr }),
		).toBe(EXIT_USAGE);
		expect(stderr.text()).toContain('expected one of web, worker, migrator');
	});
});

describe('web entrypoint resolution', () => {
	it('prefers the absolute override the image supplies', () => {
		expect(resolveWebEntrypoint('/app/build/index.js').href).toBe('file:///app/build/index.js');
	});

	it('defaults to the repo-relative custom server (TIN-3959 cache-header fix)', () => {
		expect(resolveWebEntrypoint(undefined).href).toMatch(/\/server\.js$/);
	});
});

describe('migrator entrypoint resolution', () => {
	it('prefers the absolute override the image supplies', () => {
		expect(resolveMigratorEntrypoint('/app/build/migrator.mjs').href).toBe('file:///app/build/migrator.mjs');
	});

	it('defaults to the repo-relative bundle', () => {
		expect(resolveMigratorEntrypoint(undefined).href).toMatch(/\/build\/migrator\.mjs$/);
	});
});

describe('worker entrypoint resolution', () => {
	it('prefers the absolute override the image supplies', () => {
		expect(resolveWorkerEntrypoint('/app/build/worker.mjs').href).toBe('file:///app/build/worker.mjs');
	});

	it('defaults to the repo-relative bundle', () => {
		expect(resolveWorkerEntrypoint(undefined).href).toMatch(/\/build\/worker\.mjs$/);
	});
});

describe('direct-invocation guard', () => {
	it('is false when the module is merely imported', () => {
		expect(isDirectInvocation(undefined, import.meta.url)).toBe(false);
	});
});
