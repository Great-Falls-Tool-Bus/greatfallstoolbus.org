/**
 * `withTenant`'s fail-fast guard (TIN-3817 slice S1).
 *
 * The behavioural half — that the GUC actually reaches the connection running
 * the query, which is the failure mode spec §1.3 B3 warns about — needs a real
 * policy-bearing database and lives in `rls.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { resolveConnectionString } from './client';
import { assertTenantId } from './tenant';

describe('assertTenantId', () => {
	it('accepts a canonical UUID and normalises its case', () => {
		expect(assertTenantId('3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
	});

	it('rejects anything that is not a UUID', () => {
		// A malformed id is not an injection risk — set_config is parameterised.
		// It is worse than that: PostgreSQL would accept the string, no row would
		// match it, and the caller would read an empty tenant that looks exactly
		// like a real but empty one.
		for (const bad of ['', 'gftb', '3f2504e0-4f89-11d3-9a0c', "' or true --", '3f2504e04f8911d39a0c0305e82c3301']) {
			expect(() => assertTenantId(bad)).toThrow(/must be a UUID/);
		}
	});
});

describe('resolveConnectionString', () => {
	it('reads the runtime name and never a baked-in value', () => {
		expect(resolveConnectionString({ DATABASE_URL: 'postgres://example/db' })).toBe('postgres://example/db');
	});

	it('refuses to invent a localhost default', () => {
		// A worker that quietly connected somewhere plausible would be worse than
		// one that refuses to start: the wrong database is not a degraded mode.
		expect(() => resolveConnectionString({})).toThrow(/DATABASE_URL is not set/);
		expect(() => resolveConnectionString({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL is not set/);
	});
});
