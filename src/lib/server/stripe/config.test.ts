/**
 * The configuration refusal — first of the two independent live-mode refusals
 * (TIN-3818; slices §1.11). These rows prove the config type cannot carry a
 * live key: not hidden, not warned about — unconstructible.
 */

import { describe, expect, it } from 'vitest';
import {
	PUBLISHABLE_KEY_ENV,
	SECRET_KEY_ENV,
	StripeConfigError,
	WEBHOOK_SECRET_ENV,
	readStripeConfig,
	readTenantId,
} from './config';

// Assembled at runtime so no key-shaped literal exists in this public repo
// (the gitleaks default stripe rule would rightly flag one).
const SK_TEST = 'sk_' + 'test_' + 'gftbunitfixture0000000001';
const SK_LIVE = 'sk_' + 'live_' + 'gftbunitfixture0000000001';
const RK_LIVE = 'rk_' + 'live_' + 'gftbunitfixture0000000001';
const PK_TEST = 'pk_' + 'test_' + 'gftbunitfixture0000000001';
const PK_LIVE = 'pk_' + 'live_' + 'gftbunitfixture0000000001';
const WHSEC = 'whsec_' + 'gftbunitfixture0000000001';

describe('readStripeConfig', () => {
	it('is keyless by default: nothing set → configured false, fixtures carry the tests', () => {
		const config = readStripeConfig({});
		expect(config.configured).toBe(false);
		if (!config.configured) expect(config.reason).toContain('keyless');
	});

	it('accepts a complete test-mode set', () => {
		const config = readStripeConfig({
			[SECRET_KEY_ENV]: SK_TEST,
			[WEBHOOK_SECRET_ENV]: WHSEC,
			[PUBLISHABLE_KEY_ENV]: PK_TEST,
		});
		expect(config.configured).toBe(true);
		if (config.configured) {
			expect(config.mode).toBe('test');
			expect(config.secretKey).toBe(SK_TEST);
			expect(config.publishableKey).toBe(PK_TEST);
		}
	});

	it('REFUSES a live secret key — fail closed, not degraded', () => {
		expect(() => readStripeConfig({ [SECRET_KEY_ENV]: SK_LIVE, [WEBHOOK_SECRET_ENV]: WHSEC })).toThrow(
			StripeConfigError,
		);
	});

	it('REFUSES a restricted key, a live publishable key, and arbitrary strings', () => {
		for (const bad of [RK_LIVE, 'not-a-key', 'sk_' + 'prod_' + 'gftbunitfixture0000000001']) {
			expect(() => readStripeConfig({ [SECRET_KEY_ENV]: bad, [WEBHOOK_SECRET_ENV]: WHSEC })).toThrow(StripeConfigError);
		}
		expect(() =>
			readStripeConfig({
				[SECRET_KEY_ENV]: SK_TEST,
				[WEBHOOK_SECRET_ENV]: WHSEC,
				[PUBLISHABLE_KEY_ENV]: PK_LIVE,
			}),
		).toThrow(StripeConfigError);
	});

	it('REFUSES newline smuggling, bare prefixes, and any non-[A-Za-z0-9] body — whole-string shapes only (B3)', () => {
		const smuggled = SK_TEST + '\n' + SK_LIVE;
		for (const bad of [smuggled, 'sk_' + 'test_', 'sk_' + 'test_' + 'has space', 'sk_' + 'test_' + 'nul\0body']) {
			expect(() => readStripeConfig({ [SECRET_KEY_ENV]: bad, [WEBHOOK_SECRET_ENV]: WHSEC })).toThrow(StripeConfigError);
		}
		for (const bad of ['whsec_', 'whsec_ok\nwhsec_evil', 'whsec_has space']) {
			expect(() => readStripeConfig({ [SECRET_KEY_ENV]: SK_TEST, [WEBHOOK_SECRET_ENV]: bad })).toThrow(
				StripeConfigError,
			);
		}
	});

	it('REFUSES a malformed webhook secret', () => {
		expect(() => readStripeConfig({ [SECRET_KEY_ENV]: SK_TEST, [WEBHOOK_SECRET_ENV]: 'wrong' })).toThrow(
			StripeConfigError,
		);
	});

	it('REFUSES a half-configured environment', () => {
		expect(() => readStripeConfig({ [SECRET_KEY_ENV]: SK_TEST })).toThrow(/half-configured/);
		expect(() => readStripeConfig({ [WEBHOOK_SECRET_ENV]: WHSEC })).toThrow(/half-configured/);
	});

	it('never echoes the offending value in the error', () => {
		try {
			readStripeConfig({ [SECRET_KEY_ENV]: SK_LIVE, [WEBHOOK_SECRET_ENV]: WHSEC });
			expect.unreachable('should have thrown');
		} catch (error) {
			expect((error as Error).message).not.toContain(SK_LIVE);
			expect((error as Error).message).not.toContain('gftbunitfixture');
		}
	});
});

describe('readTenantId', () => {
	it('reads the runtime name and treats blank as unset', () => {
		expect(readTenantId({ GFTB_TENANT_ID: ' abc ' })).toBe('abc');
		expect(readTenantId({ GFTB_TENANT_ID: '   ' })).toBeUndefined();
		expect(readTenantId({})).toBeUndefined();
	});
});
