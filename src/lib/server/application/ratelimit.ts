/**
 * Public rate limiting: intake (TIN-3440 slice S4) and, below, login
 * (TIN-3440 slice S12) — both consumers of the ONE `createRateLimiter`
 * factory, reused rather than forked (spec §6 request contract:
 * "rate-limited, non-enumerating public endpoints"; slices §2.2 rows 1-2:
 * "rate limit not exceeded"; S4 acceptance: "exceeding the rate limit returns
 * 429 without leaking whether the address is known").
 *
 * NON-ENUMERATION BY CONSTRUCTION: the limiter is keyed by the CALLER (client
 * address), never by the submitted email — `check(key)` cannot leak address
 * knowledge because it never receives an address. The 429 the route maps a
 * denial to is one constant body for every caller and every payload. S12's
 * `loginRateLimiter` keeps the SAME construction for the SAME reason: keying
 * by the submitted identifier would make a 429 shape a (weak) knowledge
 * signal about that identifier specifically, which this file's whole design
 * refuses to introduce anywhere.
 *
 * PROCESS-LOCAL, HONESTLY. This is an in-memory sliding window in the one
 * `web` process the platform image runs (single-replica Deployment,
 * TIN-3815/S0). It resets on restart and does not coordinate across replicas;
 * edge-level limiting is the apply plane's layer (AGENTS.md: this repo owns
 * no edge mutation). If the web Deployment ever scales past one replica, the
 * limiter needs a shared store — a recorded hand-off, not a silent gap. For
 * `loginRateLimiter` specifically this ALSO means an attacker distributing a
 * credential-stuffing run across many source addresses is bounded per address
 * only, never per targeted identifier — the same caller-keyed shape that
 * keeps this file non-enumerating leaves no per-account throttle. Recorded as
 * an S12 residual, not a silent gap: closing it needs the same shared store
 * as the multi-replica hand-off above.
 *
 * THE NUMBERS ARE ASSUMPTIONS, not ratified values: recorded here in the
 * slices §3.1 pattern (per-call overridable, cheap to change; resolver Jess,
 * sitting #2). Nothing in ADR 0014 or the system spec names a figure.
 */

/** Max submissions per key per window. ASSUMPTION — resolver Jess. */
export const INTAKE_RATE_LIMIT_MAX = 5;

/** Sliding-window width. ASSUMPTION — resolver Jess. */
export const INTAKE_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitDecision {
	allowed: boolean;
	/** When denied: how long until the oldest counted hit leaves the window. */
	retryAfterMs: number;
}

export interface RateLimiter {
	/** Record one attempt for `key` and decide. Denials are not recorded. */
	check(key: string, now?: Date): RateLimitDecision;
	/** Test seam: drop all state. */
	reset(): void;
}

export interface RateLimiterOptions {
	max?: number;
	windowMs?: number;
}

/**
 * Sliding-window limiter over per-key hit timestamps. Stale keys are pruned
 * on every check so an enumeration of client addresses cannot grow the map
 * without bound.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
	const max = options.max ?? INTAKE_RATE_LIMIT_MAX;
	const windowMs = options.windowMs ?? INTAKE_RATE_LIMIT_WINDOW_MS;
	const hits = new Map<string, number[]>();

	return {
		check(key: string, now: Date = new Date()): RateLimitDecision {
			const cutoff = now.getTime() - windowMs;
			for (const [k, stamps] of hits) {
				const live = stamps.filter((t) => t > cutoff);
				if (live.length === 0) hits.delete(k);
				else hits.set(k, live);
			}
			const live = hits.get(key) ?? [];
			if (live.length >= max) {
				return { allowed: false, retryAfterMs: live[0] + windowMs - now.getTime() };
			}
			live.push(now.getTime());
			hits.set(key, live);
			return { allowed: true, retryAfterMs: 0 };
		},
		reset(): void {
			hits.clear();
		},
	};
}

/** The one process-wide limiter the `/apply` action consults. */
export const intakeRateLimiter: RateLimiter = createRateLimiter();

/**
 * Max login attempts per caller per window. ASSUMPTION — resolver Jess,
 * sitting #2, same footing as `INTAKE_RATE_LIMIT_MAX` above: no ratified
 * figure exists, tighter than intake's because a login attempt guesses a
 * credential rather than merely submitting a form.
 */
export const LOGIN_RATE_LIMIT_MAX = 10;

/** Sliding-window width for login. ASSUMPTION — resolver Jess. */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** The one process-wide limiter the `/login` action consults (S12). */
export const loginRateLimiter: RateLimiter = createRateLimiter({
	max: LOGIN_RATE_LIMIT_MAX,
	windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
});
