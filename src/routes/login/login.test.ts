/**
 * S12 structural proof, `just check`'s `test-unit` lane (no database) — PR
 * #198 review E2: the security-property list in `login.integration.test.ts`
 * proves the login-eligibility branch works, but that suite is not one of
 * this repo's required CI checks (see the PR body's Gates section; same
 * pre-existing posture as S2's own `auth.integration.test.ts` and 16 other
 * integration files on `main`). The review reproduced the consequence
 * directly: mutating `_LOGIN_ELIGIBLE_STATUSES` to admit `left`/`removed` —
 * the exact ADR 0014 §4 / slices §2.3 invariant-3 regression this PR exists
 * to close — left all eight required PR checks green, `just check` included,
 * because nothing in the unit lane named the set's contents.
 *
 * This file is that missing assertion, in the `offboarding.test.ts` style
 * (import the route module, pin an exported seam's exact shape, no
 * database). It cannot prove the DATABASE branch behaves correctly — only
 * the integration suite does that — but it DOES make "someone widens this
 * set" a red `just check`, on every PR, unconditionally.
 */

import { describe, expect, it } from 'vitest';
import { _LOGIN_ELIGIBLE_STATUSES } from './+page.server';

describe('/login eligibility set (PR #198 review E2 — CI-detectable regression guard)', () => {
	it('is exactly {active, paused} — NOT left or removed (ADR 0014 §4; slices §2.3 invariant 3)', () => {
		expect([..._LOGIN_ELIGIBLE_STATUSES].sort()).toEqual(['active', 'paused']);
	});

	it('explicitly excludes both offboarded terminal states', () => {
		expect(_LOGIN_ELIGIBLE_STATUSES.has('left')).toBe(false);
		expect(_LOGIN_ELIGIBLE_STATUSES.has('removed')).toBe(false);
	});

	it('includes paused (RA-2 / slices §1.9 row 11: pause preserves login)', () => {
		expect(_LOGIN_ELIGIBLE_STATUSES.has('paused')).toBe(true);
	});
});
