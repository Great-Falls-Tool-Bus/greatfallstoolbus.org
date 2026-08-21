/**
 * Public-intake rate limiting (TIN-3440 slice S4; spec §6 request contract:
 * "rate-limited, non-enumerating public endpoints"; slices §2.2 rows 1-2:
 * "rate limit not exceeded"; S4 acceptance: "exceeding the rate limit returns
 * 429 without leaking whether the address is known").
 *
 * NON-ENUMERATION BY CONSTRUCTION: the limiter is keyed by the CALLER (client
 * address), never by the submitted email — `check(key)` cannot leak address
 * knowledge because it never receives an address. The 429 the route maps a
 * denial to is one constant body for every caller and every payload.
 *
 * PROCESS-LOCAL, HONESTLY. This is an in-memory sliding window in the one
 * `web` process the platform image runs (single-replica Deployment,
 * TIN-3815/S0). It resets on restart and does not coordinate across replicas;
 * edge-level limiting is the apply plane's layer (AGENTS.md: this repo owns
 * no edge mutation). If the web Deployment ever scales past one replica, the
 * limiter needs a shared store — a recorded hand-off, not a silent gap.
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
