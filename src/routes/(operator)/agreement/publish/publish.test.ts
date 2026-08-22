/**
 * S13 unit rows for `/agreement/publish` that need no real database: the
 * export surface, and every refusal reachable BEFORE the route's `withTenant`
 * unit of work (env unconfigured, anonymous, rate-limited, and field
 * validation). The keyholder-grant / operator-allowlist / reauth / publish /
 * double-submit rows all need a live tenant and live migrations — those are
 * `publish.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
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
