/**
 * S13 review E1 — a DB-free, CI-visible unit row asserting the action itself
 * checks the operator allowlist, independent of the load.
 *
 * WHY THIS FILE EXISTS. `agreement-publish.integration.test.ts` already
 * proves "a keyholder not on the allowlist -> 403 not_operator" against a
 * real tenant — but that lane is `just test-integration`, which no CI job
 * invokes (Authority row 12; the PR body's CI-visibility disclosure). The
 * review found that a mutation deleting ONLY the action-side guard at
 * `+page.server.ts` (leaving the byte-identical load-side guard, so
 * `isAllowlistedOperator` stays imported and used — no unused-import
 * signal) left `just check` fully green: 48 files, 501 passed | 2 skipped,
 * eslint clean, svelte-check 0 errors — byte-identical to the unmutated
 * report. This file is the closing fix: every DB-adjacent call the action
 * makes (`withTenant`, `requireKeyholder`, `reauthenticate`,
 * `previewNextAgreementVersionId`, `publishAgreementVersion`) is mocked to
 * SUCCEED, so the ONLY thing standing between the request and a receipt is
 * whichever allowlist check(s) the action itself still performs. This row
 * does not prove the allowlist PARSER is correct (`operator-allowlist.test.ts`
 * does that) or that the real end-to-end path works (the integration lane
 * does that) — it proves the ACTION calls the guard, which is exactly the
 * property the mutant showed nothing in the unit lane covered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/db/tenant', () => ({
	// The action's ONLY use of withTenant is to open a unit of work and run
	// the callback — no real transaction object is needed since every call
	// the callback makes (requireKeyholder, reauthenticate, publish*) is
	// itself mocked below.
	withTenant: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({}),
}));

vi.mock('$lib/server/application/claim', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/application/claim')>();
	return {
		...actual,
		// Pretend the keyholder grant check ALWAYS passes — isolating the
		// allowlist as the only remaining guard the action can rely on.
		requireKeyholder: vi.fn(async () => 'tenant-1'),
	};
});

vi.mock('$lib/server/auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/auth')>();
	return {
		...actual,
		// Real AuthError/SESSION_COOKIE pass through via ...actual — the
		// action's catch block does `error instanceof AuthError`, which must
		// keep working, and `event.cookies.set(SESSION_COOKIE, ...)` needs the
		// real constant. Only the password verification + rotation is faked.
		reauthenticate: vi.fn(async () => ({
			id: 'rotated-session-id',
			userId: 'kh-1',
			createdAt: new Date(),
		})),
	};
});

vi.mock('$lib/server/membership/agreement', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/membership/agreement')>();
	return {
		...actual,
		previewNextAgreementVersionId: vi.fn(async () => 1),
		publishAgreementVersion: vi.fn(async () => ({
			tenantId: 'tenant-1',
			id: 1,
			body: 'mock body',
			bodySha256: 'mock-sha256',
			effectiveFrom: new Date('2026-08-30T00:00:00.000Z'),
			createdAt: new Date('2026-08-30T00:00:00.000Z'),
		})),
	};
});

// isAllowlistedOperator is DELIBERATELY left real/unmocked: it is the one
// function under test. `GFTB_OPERATOR_PERSON_IDS` below genuinely does or
// does not contain the actor's id, and the real parser decides.

function event(fields: Record<string, string>, personId: string): RequestEvent {
	const body = new URLSearchParams(fields);
	return {
		request: new Request('http://localhost/agreement/publish', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body,
		}),
		locals: { authSession: { userId: personId, id: 'presented-session-id', createdAt: new Date() } },
		getClientAddress: () => '203.0.113.9',
		cookies: { set: () => undefined },
	} as unknown as RequestEvent;
}

const BASE_ENV = { GFTB_TENANT_ID: 'tenant-1', DATABASE_URL: 'postgres://unused' };
const FORM = { body: 'text', confirm: 'on', password: 'x', expectedNextVersionId: '1' };

afterEach(() => {
	vi.clearAllMocks();
});

describe('E1 — the ACTION itself checks the allowlist, independent of the load (DB-free, CI-visible)', () => {
	it('a non-allowlisted keyholder is refused even though requireKeyholder and reauthenticate both "succeed"', async () => {
		const { _createPublishAction } = await import('./+page.server');
		const action = _createPublishAction({
			env: { ...BASE_ENV, GFTB_OPERATOR_PERSON_IDS: 'someone-else-entirely' },
		});
		const result = await action(event(FORM, 'kh-1'));
		// The exact property the M1b mutant (delete the action-side guard,
		// leave the load-side one) makes true instead: `{published: true,
		// version: 1}`. Every other guard in this test is mocked to succeed,
		// so THIS assertion is what must go red under that mutation.
		expect(result).toMatchObject({ status: 403, data: { code: 'not_operator' } });
		expect(result).not.toHaveProperty('published');
	});

	it('GFTB_OPERATOR_PERSON_IDS entirely unset also refuses, under the identical mocks', async () => {
		const { _createPublishAction } = await import('./+page.server');
		const action = _createPublishAction({ env: { ...BASE_ENV } });
		const result = await action(event(FORM, 'kh-1'));
		expect(result).toMatchObject({ status: 403, data: { code: 'not_operator' } });
		expect(result).not.toHaveProperty('published');
	});

	it('control: an allowlisted keyholder publishes under the identical mocks — proves the guard is not simply always-refusing', async () => {
		const { _createPublishAction } = await import('./+page.server');
		const action = _createPublishAction({
			env: { ...BASE_ENV, GFTB_OPERATOR_PERSON_IDS: 'kh-1' },
		});
		const result = await action(event(FORM, 'kh-1'));
		expect(result).toMatchObject({ published: true, version: 1 });
	});
});
