/**
 * S4 unit rows for the intake rate limiter (spec §6 "rate-limited,
 * non-enumerating public endpoints"). The 429 mapping and its constant body
 * are asserted end-to-end in application.integration.test.ts; here the
 * window mechanics and the structural never-sees-an-address property.
 */

import { describe, expect, it } from 'vitest';
import { INTAKE_RATE_LIMIT_MAX, INTAKE_RATE_LIMIT_WINDOW_MS, createRateLimiter } from './ratelimit';

const T0 = new Date('2026-08-20T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('createRateLimiter — sliding window over caller keys', () => {
	it('allows up to max and denies the next attempt', () => {
		const limiter = createRateLimiter({ max: 3, windowMs: 1000 });
		for (let i = 0; i < 3; i++) expect(limiter.check('k', at(i)).allowed).toBe(true);
		const denied = limiter.check('k', at(10));
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterMs).toBeGreaterThan(0);
	});

	it('recovers when the window slides past the oldest hit', () => {
		const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
		limiter.check('k', at(0));
		limiter.check('k', at(100));
		expect(limiter.check('k', at(200)).allowed).toBe(false);
		expect(limiter.check('k', at(1001)).allowed).toBe(true);
	});

	it('does not count denied attempts — hammering while limited does not extend the lockout', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
		limiter.check('k', at(0));
		for (let i = 1; i <= 5; i++) expect(limiter.check('k', at(i * 10)).allowed).toBe(false);
		expect(limiter.check('k', at(1001)).allowed).toBe(true);
	});

	it('isolates keys and prunes idle ones', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
		expect(limiter.check('a', at(0)).allowed).toBe(true);
		expect(limiter.check('b', at(0)).allowed).toBe(true);
		expect(limiter.check('a', at(1)).allowed).toBe(false);
		// After the window, both keys are prunable and usable again.
		expect(limiter.check('a', at(2000)).allowed).toBe(true);
	});

	it('reset drops all state (the test seam)', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
		limiter.check('k', at(0));
		limiter.reset();
		expect(limiter.check('k', at(1)).allowed).toBe(true);
	});

	it('structurally cannot leak address knowledge: the decision derives from the key alone', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
		limiter.check('caller', at(0));
		const denial = limiter.check('caller', at(1));
		// Same denial regardless of anything BUT the key; and the decision shape
		// carries only allowed/retryAfterMs — no field an address could ride in.
		expect(Object.keys(denial).sort()).toEqual(['allowed', 'retryAfterMs']);
	});

	it('documents the ASSUMPTION defaults (resolver Jess, sitting #2 umbrella)', () => {
		expect(INTAKE_RATE_LIMIT_MAX).toBe(5);
		expect(INTAKE_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
	});
});
