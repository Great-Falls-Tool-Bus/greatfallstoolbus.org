// Contract tests for the platform process dispatcher (TIN-3815, slice S0).
//
// These lock the IMAGE CONTRACT, not an implementation detail: three stable
// role names, `--help` answering 0 for each of them without side effects, and
// worker/migrator failing CLOSED until S1/S3 land. S1 and S3 may change what
// those roles DO; they must not change the contract asserted here.

import { describe, expect, it } from 'vitest';

import {
	EXIT_UNAVAILABLE,
	EXIT_USAGE,
	PLATFORM_ROLES,
	isDirectInvocation,
	platformRoleHelp,
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
		expect(platformRoleHelp('migrator')).toContain('not yet implemented');
		expect(platformRoleHelp('web')).not.toContain('not yet implemented');
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

	it.each(['worker', 'migrator'])('fails closed for %s rather than reporting healthy', async (role: string) => {
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

describe('direct-invocation guard', () => {
	it('is false when the module is merely imported', () => {
		expect(isDirectInvocation(undefined, import.meta.url)).toBe(false);
	});
});
