/**
 * S13 unit rows for `/agreement/publish` that need no real database: the
 * export surface, and every refusal reachable BEFORE the route's `withTenant`
 * unit of work (env unconfigured, anonymous, rate-limited, and field
 * validation). The keyholder-grant / operator-allowlist / reauth / publish /
 * double-submit rows all need a live tenant and live migrations — those are
 * `publish.integration.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+page.server';
import type { RateLimiter } from '$lib/server/application/ratelimit';

function event(
	fields: Record<string, string>,
	personId: string | null,
	overrides: { clientAddress?: string } = {},
): RequestEvent {
	const body = new URLSearchParams(fields);
	return {
		request: new Request('http://localhost/agreement/publish', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		locals: { authSession: personId ? { userId: personId, id: 'sess-1', createdAt: new Date() } : null },
		getClientAddress: () => overrides.clientAddress ?? '203.0.113.9',
		cookies: { set: () => undefined },
	} as unknown as RequestEvent;
}

const CONFIGURED_ENV = { GFTB_TENANT_ID: 'tenant-1', DATABASE_URL: 'postgres://unused' };

const alwaysAllow: RateLimiter = { check: () => ({ allowed: true, retryAfterMs: 0 }), reset: () => undefined };
const alwaysDeny: RateLimiter = { check: () => ({ allowed: false, retryAfterMs: 60_000 }), reset: () => undefined };

describe('/agreement/publish route module', () => {
	it('exports exactly the runtime surface this route is meant to have', () => {
		expect(Object.keys(route).sort()).toEqual([
			'_PUBLISH_RATE_LIMIT_MAX',
			'_PUBLISH_RATE_LIMIT_WINDOW_MS',
			'_StaleAgreementPreviewError',
			'_createPublishAction',
			'_createPublishLoad',
			'_parseEffectiveFromUTC',
			'actions',
			'load',
			'prerender',
		]);
	});

	it('is explicitly not prerendered (request-time, session- and allowlist-gated)', () => {
		expect(route.prerender).toBe(false);
	});
});

describe('_createPublishLoad — refusals reachable without a database', () => {
	it('runtime unconfigured (no tenant/database env) reads as unavailable', async () => {
		const load = route._createPublishLoad({ env: {} });
		const result = await load(event({}, null));
		expect(result).toEqual({ available: false, authenticated: false, authorized: false, nextVersionId: null });
	});

	it('anonymous, but runtime configured, reads as not-authenticated', async () => {
		const load = route._createPublishLoad({ env: CONFIGURED_ENV });
		const result = await load(event({}, null));
		expect(result).toEqual({ available: true, authenticated: false, authorized: false, nextVersionId: null });
	});
});

describe('_createPublishAction — refusals reachable without a database', () => {
	it('runtime unconfigured → 503, before any auth or field is inspected', async () => {
		const action = route._createPublishAction({ env: {} });
		const result = await action(event({}, 'alice'));
		expect(result).toMatchObject({ status: 503, data: { code: 'agreement_publish_unavailable' } });
	});

	it('anonymous → 401, before rate limiting or field parsing', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(event({}, null));
		expect(result).toMatchObject({ status: 401, data: { code: 'not_authenticated' } });
	});

	it('rate limit denial → 429, before any field is read', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysDeny });
		const result = await action(event({ body: 'text' }, 'alice'));
		expect(result).toMatchObject({ status: 429, data: { code: 'rate_limited' } });
	});

	it('missing body → 400 body_required', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(event({ confirm: 'on', password: 'x', expectedNextVersionId: '1' }, 'alice'));
		expect(result).toMatchObject({ status: 400, data: { code: 'body_required' } });
	});

	it('blank (whitespace-only) body → 400 body_required, not treated as present', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(
			event({ body: '   ', confirm: 'on', password: 'x', expectedNextVersionId: '1' }, 'alice'),
		);
		expect(result).toMatchObject({ status: 400, data: { code: 'body_required' } });
	});

	it('missing confirmation checkbox → 400 confirmation_required, even with a valid body', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(event({ body: 'text', password: 'x', expectedNextVersionId: '1' }, 'alice'));
		expect(result).toMatchObject({ status: 400, data: { code: 'confirmation_required' } });
	});

	it('missing password → 401 reauth_required, even with confirmation checked', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(event({ body: 'text', confirm: 'on', expectedNextVersionId: '1' }, 'alice'));
		expect(result).toMatchObject({ status: 401, data: { code: 'reauth_required' } });
	});

	it('unparseable effectiveFrom → 400 invalid_effective_from', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(
			event(
				{ body: 'text', confirm: 'on', password: 'x', expectedNextVersionId: '1', effectiveFrom: 'not-a-date' },
				'alice',
			),
		);
		expect(result).toMatchObject({ status: 400, data: { code: 'invalid_effective_from' } });
	});

	it('missing expectedNextVersionId → 400 expected_version_required', async () => {
		const action = route._createPublishAction({ env: CONFIGURED_ENV, limiter: alwaysAllow });
		const result = await action(event({ body: 'text', confirm: 'on', password: 'x' }, 'alice'));
		expect(result).toMatchObject({ status: 400, data: { code: 'expected_version_required' } });
	});
});

describe('_parseEffectiveFromUTC — TZ-invariant by construction (review E2)', () => {
	// A plain `new Date(effectiveFromRaw)` on this zoneless shape parses as
	// the PROCESS's local time (ES Date Time String Format semantics) — the
	// exact class of bug `auth/adapter.ts`'s `parseDbInstant` already fixed
	// on the READ side. This block re-derives the review's own measurement
	// (`2026-08-30T09:00` -> 09:00Z / 13:00Z / 00:00Z / 07:00Z under
	// UTC / America/New_York / Asia/Tokyo / Europe/Berlin) as a permanent
	// regression guard against the REAL exported parser, not a re-statement
	// of the bug report.
	const originalTZ = process.env.TZ;

	afterEach(() => {
		if (originalTZ === undefined) delete process.env.TZ;
		else process.env.TZ = originalTZ;
	});

	it('the identical input yields the identical instant under four different process time zones', () => {
		const input = '2026-08-30T09:00';
		const zones = ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Berlin'];
		const results = zones.map((tz) => {
			process.env.TZ = tz;
			return route._parseEffectiveFromUTC(input)?.toISOString();
		});
		// Every zone agrees, AND agrees on the specific correct instant — not
		// merely "all equal to each other" (which four equally-wrong answers
		// would also satisfy).
		expect(results).toEqual(zones.map(() => '2026-08-30T09:00:00.000Z'));
	});

	it("a second input reproduces the review's independently-observed 4-hour case", () => {
		process.env.TZ = 'UTC';
		const utc = route._parseEffectiveFromUTC('2026-08-30T00:00')?.toISOString();
		process.env.TZ = 'America/New_York';
		const ny = route._parseEffectiveFromUTC('2026-08-30T00:00')?.toISOString();
		expect(utc).toBe('2026-08-30T00:00:00.000Z');
		expect(ny).toBe(utc);
	});

	it('accepts an explicit seconds component, still UTC and TZ-invariant', () => {
		process.env.TZ = 'Asia/Tokyo';
		expect(route._parseEffectiveFromUTC('2026-08-30T09:00:30')?.toISOString()).toBe('2026-08-30T09:00:30.000Z');
	});

	it('rejects offset-bearing input — the field is documented UTC-only, not general ISO 8601', () => {
		expect(route._parseEffectiveFromUTC('2026-08-30T09:00:00Z')).toBeNull();
		expect(route._parseEffectiveFromUTC('2026-08-30T09:00:00+05:00')).toBeNull();
		expect(route._parseEffectiveFromUTC('2026-08-30T09:00:00-04:00')).toBeNull();
	});

	it('rejects calendar overflow instead of letting Date.UTC silently normalize it', () => {
		expect(route._parseEffectiveFromUTC('2026-02-30T00:00')).toBeNull(); // no Feb 30
		expect(route._parseEffectiveFromUTC('2026-13-01T00:00')).toBeNull(); // no month 13
		expect(route._parseEffectiveFromUTC('2026-08-30T24:00')).toBeNull(); // no hour 24
	});

	it("rejects the sanity bound: the review's own out-of-bound probe values", () => {
		expect(route._parseEffectiveFromUTC('1900-01-01T00:00')).toBeNull();
		expect(route._parseEffectiveFromUTC('9999-12-31T23:59')).toBeNull();
	});

	it('accepts ordinary in-bound values', () => {
		expect(route._parseEffectiveFromUTC('2026-08-30T09:00')?.toISOString()).toBe('2026-08-30T09:00:00.000Z');
	});
});
