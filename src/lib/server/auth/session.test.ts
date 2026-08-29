/**
 * `session.ts`, DB-free unit lane (TIN-3440 S12, PR #198 round-2 review,
 * ED-1). `authenticate()`'s B1 fix (`_DUMMY_PASSWORD_HASH`) is otherwise
 * guarded only by `login.integration.test.ts`, which lives in the
 * integration lane no required CI check runs — and even there, the guard
 * asserts wall-clock comparability, not the cost factor the whole fix
 * depends on. The review proved the gap by mutation: swap
 * `_DUMMY_PASSWORD_HASH` for a hash generated at cost 11 instead of 12 (one
 * round cheaper — half the bcrypt work) and the shipped integration test
 * still PASSES, while the channel becomes a PERFECT oracle (review's
 * measurement: AUC 0.000, 0/25 sample overlap). `@tummycrypt/tinyland-auth`
 * is pinned at `0.3.3` but is not in `.github/dependabot.yml`'s ignore list
 * and sits inside the `minor-and-patch` group, so a routine automated bump
 * that moves `DEFAULT_CONFIG.rounds` would re-arm B1 with every existing
 * gate green.
 *
 * This file pins the one thing that actually matters: `_DUMMY_PASSWORD_HASH`
 * must cost exactly what the INSTALLED package's own default costs, read
 * live off disk rather than hardcoded here as a second "12" that could drift
 * out of sync with the first.
 *
 * Does NOT call `hashPassword()` to get a same-process comparison hash, on
 * purpose: `password.js` does `import * as bcrypt from 'bcryptjs'`, and
 * `bcryptjs`'s CJS export shape only interops correctly through the CJS
 * transform `vite.config.ts` and `vitest.integration.config.ts` both apply
 * via `ssr.noExternal: ['@tummycrypt/tinyland-auth']` (see their own
 * comments) — a transform this repo's plain `vitest.config.ts` (this file's
 * own lane) deliberately does not carry, and adding it here is a config
 * change wider than this one test. Calling `hashPassword()` under this
 * config throws `bcrypt.hash is not a function` at call time (confirmed by
 * running it). `getHashRounds()` is pure regex over the hash string — no
 * bcrypt call — so it is safe to use on both sides; the "other side" is a
 * live read of the installed package's `DEFAULT_CONFIG.rounds`, the same
 * "read the installed artifact directly" precedent `fence.test.ts` already
 * uses for the version pins (`fence.test.ts:176-177`).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHashRounds } from '@tummycrypt/tinyland-auth';
import { describe, expect, it } from 'vitest';
import { _DUMMY_PASSWORD_HASH } from './session';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const passwordModuleSource = readFileSync(
	path.join(repoRoot, 'node_modules/@tummycrypt/tinyland-auth/dist/core/security/password.js'),
	'utf8',
);

/** Reads `DEFAULT_CONFIG.rounds` out of the installed module's own source. */
function installedDefaultRounds(): number {
	const match = passwordModuleSource.match(/DEFAULT_CONFIG\s*=\s*\{\s*rounds:\s*(\d+)/);
	if (!match) {
		throw new Error(
			'could not read DEFAULT_CONFIG.rounds from the installed @tummycrypt/tinyland-auth package — ' +
				'its internal shape changed; re-derive this regex against dist/core/security/password.js',
		);
	}
	return Number(match[1]);
}

describe('_DUMMY_PASSWORD_HASH — cost factor pinned to the installed package default (PR #198 review ED-1)', () => {
	it('costs exactly what the installed hashPassword() default costs — the same cost authenticate() charges a real member', () => {
		expect(getHashRounds(_DUMMY_PASSWORD_HASH)).toBe(installedDefaultRounds());
	});

	it('is a well-formed bcrypt hash (not a truncated or placeholder literal)', () => {
		expect(_DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
	});
});
