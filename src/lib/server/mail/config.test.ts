/**
 * `readMailConfig`/`readPublicOrigin` — the fail-closed shape (TIN-4062).
 * Pure, no database, no network.
 */

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PUBLIC_ORIGIN,
	MAIL_DELIVERY_ENV,
	MAIL_FROM_ADDRESS_ENV,
	MAIL_SMTP_URL_ENV,
	MailConfigError,
	PUBLIC_ORIGIN_ENV,
	readMailConfig,
	readPublicOrigin,
} from './config';

const VALID = {
	[MAIL_DELIVERY_ENV]: 'enabled',
	[MAIL_SMTP_URL_ENV]: 'smtps://user:pass@mail.example.invalid:465',
	[MAIL_FROM_ADDRESS_ENV]: 'noreply@example.invalid',
} as NodeJS.ProcessEnv;

describe('readMailConfig — disabled by default', () => {
	it('is disabled when GFTB_MAIL_DELIVERY is unset', () => {
		const config = readMailConfig({});
		expect(config.enabled).toBe(false);
	});

	it.each(['true', '1', 'yes', 'ENABLED', 'disabled'])('treats %j as disabled, never a warning', (value) => {
		const config = readMailConfig({ [MAIL_DELIVERY_ENV]: value } as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(false);
	});

	it('trims surrounding whitespace before comparing (the same normalization readStripeConfig applies)', () => {
		// " enabled " trims to the exact activating string, so — with the two
		// other required names ALSO present — this is the one whitespace case
		// that reaches the enabled shape, not the disabled default.
		const config = readMailConfig({ ...VALID, [MAIL_DELIVERY_ENV]: ' enabled ' } as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(true);
	});

	it('stays disabled even when a transport DSN and from-address happen to be present', () => {
		const config = readMailConfig({
			[MAIL_SMTP_URL_ENV]: VALID[MAIL_SMTP_URL_ENV],
			[MAIL_FROM_ADDRESS_ENV]: VALID[MAIL_FROM_ADDRESS_ENV],
		} as NodeJS.ProcessEnv);
		expect(config.enabled).toBe(false);
	});
});

describe('readMailConfig — half-configured is a misconfiguration, never a degraded mode', () => {
	it('throws when enabled with no transport DSN and no from-address', () => {
		expect(() => readMailConfig({ [MAIL_DELIVERY_ENV]: 'enabled' } as NodeJS.ProcessEnv)).toThrow(MailConfigError);
	});

	it('throws when enabled with a DSN but no from-address', () => {
		expect(() =>
			readMailConfig({
				[MAIL_DELIVERY_ENV]: 'enabled',
				[MAIL_SMTP_URL_ENV]: VALID[MAIL_SMTP_URL_ENV],
			} as NodeJS.ProcessEnv),
		).toThrow(MailConfigError);
	});

	it('throws when enabled with a from-address but no DSN', () => {
		expect(() =>
			readMailConfig({
				[MAIL_DELIVERY_ENV]: 'enabled',
				[MAIL_FROM_ADDRESS_ENV]: VALID[MAIL_FROM_ADDRESS_ENV],
			} as NodeJS.ProcessEnv),
		).toThrow(MailConfigError);
	});

	it('throws on a malformed transport DSN', () => {
		expect(() => readMailConfig({ ...VALID, [MAIL_SMTP_URL_ENV]: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow(
			MailConfigError,
		);
	});

	it('throws on an implausible from-address', () => {
		expect(() => readMailConfig({ ...VALID, [MAIL_FROM_ADDRESS_ENV]: 'not-an-address' } as NodeJS.ProcessEnv)).toThrow(
			MailConfigError,
		);
	});

	it('never echoes the DSN value in its error message', () => {
		try {
			readMailConfig({ ...VALID, [MAIL_SMTP_URL_ENV]: 'smtp://leaked-secret-value' } as NodeJS.ProcessEnv);
			expect.unreachable();
		} catch (error) {
			expect((error as Error).message).not.toContain('leaked-secret-value');
		}
	});
});

describe('readMailConfig — the one reachable shape', () => {
	it('returns enabled:true with the transport URL and from-address when fully and validly configured', () => {
		const config = readMailConfig(VALID);
		expect(config).toEqual({
			enabled: true,
			transportUrl: VALID[MAIL_SMTP_URL_ENV],
			fromAddress: VALID[MAIL_FROM_ADDRESS_ENV],
		});
	});

	it('accepts a plain smtp:// DSN too', () => {
		const config = readMailConfig({ ...VALID, [MAIL_SMTP_URL_ENV]: 'smtp://mail.example.invalid:587' });
		expect(config.enabled).toBe(true);
	});
});

describe('readPublicOrigin', () => {
	it('defaults to the production public origin', () => {
		expect(readPublicOrigin({})).toBe(DEFAULT_PUBLIC_ORIGIN);
	});

	it('honors an override, stripped of a trailing slash', () => {
		expect(readPublicOrigin({ [PUBLIC_ORIGIN_ENV]: 'https://staging.example.invalid/' } as NodeJS.ProcessEnv)).toBe(
			'https://staging.example.invalid',
		);
	});
});
