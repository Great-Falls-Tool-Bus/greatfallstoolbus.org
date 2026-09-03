/**
 * `readListAutomationConfig` — the fail-closed shape (TIN-3964; mirrors
 * `../mail/config.test.ts`). Pure, no database, no network.
 */

import { describe, expect, it } from 'vitest';
import { LIST_AUTOMATION_ENV, ListConfigError, MAILMAN_API_URL_ENV, readListAutomationConfig } from './config';

const VALID = {
	[LIST_AUTOMATION_ENV]: 'enabled',
	[MAILMAN_API_URL_ENV]: 'https://restadmin:pass@mailman.example.invalid/',
} as NodeJS.ProcessEnv;

describe('readListAutomationConfig — disabled by default', () => {
	it('is disabled when GFTB_LIST_AUTOMATION is unset', () => {
		const config = readListAutomationConfig({});
		expect(config.enabled).toBe(false);
	});

	it.each(['true', '1', 'yes', 'ENABLED', 'disabled'])('treats %j as disabled, never a warning', (value) => {
		const config = readListAutomationConfig({ [LIST_AUTOMATION_ENV]: value } as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(false);
	});

	it('trims surrounding whitespace before comparing (the readMailConfig normalization)', () => {
		const config = readListAutomationConfig({ ...VALID, [LIST_AUTOMATION_ENV]: ' enabled ' } as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(true);
	});

	it('stays disabled even when a Mailman DSN happens to be present (the staged-rollout shape)', () => {
		const config = readListAutomationConfig({
			[MAILMAN_API_URL_ENV]: VALID[MAILMAN_API_URL_ENV],
		} as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(false);
	});
});

describe('readListAutomationConfig — half-configured is a misconfiguration, never a degraded mode', () => {
	it('throws when enabled with no DSN', () => {
		expect(() => readListAutomationConfig({ [LIST_AUTOMATION_ENV]: 'enabled' } as NodeJS.ProcessEnv)).toThrow(
			ListConfigError,
		);
	});

	it('throws when enabled with a blank DSN', () => {
		expect(() =>
			readListAutomationConfig({
				[LIST_AUTOMATION_ENV]: 'enabled',
				[MAILMAN_API_URL_ENV]: '   ',
			} as NodeJS.ProcessEnv),
		).toThrow(ListConfigError);
	});

	it('throws on a malformed DSN', () => {
		expect(() =>
			readListAutomationConfig({ ...VALID, [MAILMAN_API_URL_ENV]: 'not-a-url' } as NodeJS.ProcessEnv),
		).toThrow(ListConfigError);
	});

	it('NEVER echoes the DSN value in the error (embedded credential; this repository is public)', () => {
		let message = '';
		try {
			readListAutomationConfig({ ...VALID, [MAILMAN_API_URL_ENV]: 'ftp://user:pass@host' } as NodeJS.ProcessEnv);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toContain('user:pass');
		expect(message).not.toContain('ftp://');
		expect(message.length).toBeGreaterThan(0);
	});
});

describe('readListAutomationConfig — the enabled shape', () => {
	it('returns the DSN when enabled and http(s)-shaped', () => {
		const config = readListAutomationConfig(VALID);
		expect(config).toEqual({ enabled: true, apiUrl: VALID[MAILMAN_API_URL_ENV] });
	});

	it('accepts plain http (an in-cluster REST endpoint shape — fixture host only; zero cluster endpoints, ever)', () => {
		const config = readListAutomationConfig({
			...VALID,
			[MAILMAN_API_URL_ENV]: 'http://restadmin:pw@mailman.example.invalid:8001/',
		} as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(true);
	});
});
