/**
 * Freshness math and guard shapes, no database (TIN-3817 slice S2).
 *
 * The database-backed halves — rotation actually killing the old row, the
 * wrong password NOT rotating, the stale session being refused end to end —
 * live in auth.integration.test.ts. This file pins the pure parts: the clock
 * arithmetic and the 401 shapes, which must hold no matter what the storage
 * layer does.
 */

import { describe, expect, it } from 'vitest';
import { REAUTH_WINDOW_MS, isFreshlyAuthenticated, requireFreshReauth } from './reauth';
import { AuthError, type AuthSession } from './session';

function sessionCreatedAt(createdAt: Date): AuthSession {
	return {
		id: '00000000-0000-4000-8000-000000000001',
		tenantId: '00000000-0000-4000-8000-0000000000aa',
		userId: '00000000-0000-4000-8000-000000000002',
		createdAt: createdAt.toISOString(),
		expires: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		clientIp: 'unknown',
		userAgent: 'unknown',
	};
}

describe('isFreshlyAuthenticated', () => {
	const now = new Date('2026-08-20T12:00:00.000Z');

	it('a session created just now is fresh', () => {
		expect(isFreshlyAuthenticated(sessionCreatedAt(now), { now })).toBe(true);
	});

	it('a session exactly at the window boundary is still fresh (closed interval)', () => {
		const atBoundary = sessionCreatedAt(new Date(now.getTime() - REAUTH_WINDOW_MS));
		expect(isFreshlyAuthenticated(atBoundary, { now })).toBe(true);
	});

	it('one millisecond past the window is stale', () => {
		const justPast = sessionCreatedAt(new Date(now.getTime() - REAUTH_WINDOW_MS - 1));
		expect(isFreshlyAuthenticated(justPast, { now })).toBe(false);
	});

	it('a createdAt in the future is NOT fresh — clock skew fails closed', () => {
		const future = sessionCreatedAt(new Date(now.getTime() + 1000));
		expect(isFreshlyAuthenticated(future, { now })).toBe(false);
	});

	it('an unparseable createdAt is NOT fresh — malformed data fails closed', () => {
		const broken = { ...sessionCreatedAt(now), createdAt: 'not-a-date' };
		expect(isFreshlyAuthenticated(broken, { now })).toBe(false);
	});

	it('honors an injected window override without touching the constant', () => {
		const twoSecondsOld = sessionCreatedAt(new Date(now.getTime() - 2000));
		expect(isFreshlyAuthenticated(twoSecondsOld, { now, windowMs: 1000 })).toBe(false);
		expect(isFreshlyAuthenticated(twoSecondsOld, { now, windowMs: 3000 })).toBe(true);
	});
});

describe('requireFreshReauth', () => {
	const now = new Date('2026-08-20T12:00:00.000Z');

	it('returns the session when fresh', () => {
		const fresh = sessionCreatedAt(now);
		expect(requireFreshReauth(fresh, { now })).toBe(fresh);
	});

	it('throws a 401 with code reauth_required when stale-but-valid', () => {
		const stale = sessionCreatedAt(new Date(now.getTime() - REAUTH_WINDOW_MS - 60_000));
		let thrown: unknown;
		try {
			requireFreshReauth(stale, { now });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(AuthError);
		expect((thrown as AuthError).status).toBe(401);
		expect((thrown as AuthError).code).toBe('reauth_required');
	});
});

describe('the window ASSUMPTION is visible, not smuggled', () => {
	it('is five minutes pending sitting #2', () => {
		expect(REAUTH_WINDOW_MS).toBe(5 * 60 * 1000);
	});
});
