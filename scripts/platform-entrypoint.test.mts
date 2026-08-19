// Contract tests for the platform process dispatcher (TIN-3815 slice S0,
// extended by TIN-3817 slice S1).
//
// These lock the IMAGE CONTRACT, not an implementation detail: three stable
// role names, `--help` answering 0 for each of them without side effects, and
// an unimplemented role failing CLOSED rather than reporting healthy.
//
// S1 landed the migrator, so the rows that asserted `migrator` fails closed now
// assert it DISPATCHES — the contract they were protecting (never exit 0 while
// doing nothing) is unchanged and still asserted for `worker`.

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
	runPlatformEntrypoint,
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore -- plain .mjs dispatcher, deliberately not compiled for the image
} from './platform-entrypoint.mjs';

function capture() {
	const chunks: string[] = [];
	return { write: (chunk: string) => chunks.push(chunk), text: () => chunks.join('') };
}

describe('platform image role contract', () => {
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

	it('marks the not-yet-implemented roles as declared-only in help text', () => {
		expect(platformRoleHelp('worker')).toContain('not yet implemented');
		expect(platformRoleHelp('web')).not.toContain('not yet implemented');
		// TIN-3817 S1: the migrator is real now, and its help must say so —
		// a "declared only" line on a shipped role is a lie an operator acts on.
		expect(platformRoleHelp('migrator')).not.toContain('not yet implemented');
		expect(platformRoleHelp('migrator')).toContain('advisory lock');
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

	it.each(['worker'])('fails closed for %s rather than reporting healthy', async (role: string) => {
		const stderr = capture();
		const code = await runPlatformEntrypoint({
			argv1: `/bin/${role}`,
			args: [],
			env: {},
			stdout: capture(),
			stderr,
			importModule: async () => {
				throw new Error('placeholder roles must not load anything');
			},
		});

		expect(code).toBe(EXIT_UNAVAILABLE);
		expect(stderr.text()).toContain('has not landed yet');
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

	it('defaults to the repo-relative adapter-node output', () => {
		expect(resolveWebEntrypoint(undefined).href).toMatch(/\/build\/index\.js$/);
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

describe('direct-invocation guard', () => {
	it('is false when the module is merely imported', () => {
		expect(isDirectInvocation(undefined, import.meta.url)).toBe(false);
	});
});
