/**
 * S11 structural proof: `/offboarding` is read-only (slices-shaped acceptance
 * row, mirroring visibility.test.ts's "asserted by shape" style). The route
 * module exports `load` and nothing else — no `actions`, so SvelteKit's own
 * routing has no POST handler wired for this page: there is no `<form>`
 * target and no retry/replay control reachable from this surface.
 *
 * Round-2 correction (adversarial review B4): this file previously claimed
 * the integration suite additionally asserts a live POST 404s. No such
 * assertion existed anywhere in this repository — deleted here rather than
 * left as an uncorrected false evidence claim. The `actions`-absence proof
 * below is the actual, load-bearing evidence: SvelteKit's node adapter
 * derives its POST/method routing table from a route module's `actions`
 * export, so a module with none has nothing to route a POST to. A live HTTP
 * 404/405 assertion would require driving the built server (`.svelte-kit/output`)
 * rather than calling `load` in-process, which the rest of this suite (and
 * `/remove`'s, `/review`'s) does not do either — recorded as an honest scope
 * limit, not re-claimed as proven.
 */

import { describe, expect, it } from 'vitest';
import * as route from './+page.server';

describe('/offboarding route module', () => {
	it('exports load and prerender only — no actions export at all', () => {
		expect(Object.keys(route).sort()).toEqual(['_createOffboardingLoad', 'load', 'prerender']);
	});

	it('is explicitly not prerendered (request-time, session-gated, like /review and /remove)', () => {
		expect(route.prerender).toBe(false);
	});
});
