/**
 * S11 structural proof: `/offboarding` is read-only (slices-shaped acceptance
 * row, mirroring visibility.test.ts's "asserted by shape" style). The route
 * module exports `load` and nothing else — no `actions`, so there is no
 * `<form>` target, no POST handler, and no retry/replay control reachable
 * from this surface. Integration coverage (offboarding-observability.
 * integration.test.ts) additionally asserts a live POST to this route 404s.
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
