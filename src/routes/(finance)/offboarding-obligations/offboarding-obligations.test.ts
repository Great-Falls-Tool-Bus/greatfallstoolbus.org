/**
 * S11 round-2 structural proof: `/offboarding-obligations` is read-only, the
 * `offboarding.test.ts` precedent applied here. The route module exports
 * `load` and nothing else — no `actions`, so there is no POST handler wired
 * for this page at all.
 */

import { describe, expect, it } from 'vitest';
import * as route from './+page.server';

describe('/offboarding-obligations route module', () => {
	it('exports load and prerender only — no actions export at all', () => {
		expect(Object.keys(route).sort()).toEqual(['_createOffboardingObligationsLoad', 'load', 'prerender']);
	});

	it('is explicitly not prerendered (request-time, session-gated, like /contributions)', () => {
		expect(route.prerender).toBe(false);
	});
});
