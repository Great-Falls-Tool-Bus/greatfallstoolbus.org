import { describe, expect, it } from 'vitest';
import { decideIdentityGateScope } from './discuss-drafts-ci-scope';

describe('decideIdentityGateScope', () => {
	it('runs the full gate whenever the key is available, regardless of changed paths', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: true,
			changedDraftPaths: ['src/content/discuss-drafts/example.svx'],
			baseRefResolved: true,
		});
		expect(decision.action).toBe('run-full');
	});

	it('runs the full gate when the key is available even if the base ref could not be resolved', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: true,
			changedDraftPaths: [],
			baseRefResolved: false,
		});
		expect(decision.action).toBe('run-full');
	});

	// EDIT-1 core case: key-absent + touched-drafts -> fail
	it('fails when the key is absent and a draft path changed', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: false,
			changedDraftPaths: ['src/content/discuss-drafts/new-draft.svx'],
			baseRefResolved: true,
		});
		expect(decision.action).toBe('fail');
		expect(decision.reason).toContain('new-draft.svx');
		expect(decision.reason).toContain('keyed machine');
	});

	it('fails when the key is absent and multiple draft paths changed, listing all of them', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: false,
			changedDraftPaths: ['a.svx', 'b.svx'],
			baseRefResolved: true,
		});
		expect(decision.action).toBe('fail');
		expect(decision.reason).toContain('a.svx');
		expect(decision.reason).toContain('b.svx');
		expect(decision.reason).toContain('2 changed path(s)');
	});

	// EDIT-1 core case: key-absent + untouched -> pass (skip loud)
	it('skips loudly (not run-full, not fail) when the key is absent and nothing changed', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: false,
			changedDraftPaths: [],
			baseRefResolved: true,
		});
		expect(decision.action).toBe('skip-loud');
	});

	it('fails closed when the key is absent and the base ref could not be resolved at all, even with zero changed paths', () => {
		const decision = decideIdentityGateScope({
			identityGateAvailable: false,
			changedDraftPaths: [],
			baseRefResolved: false,
		});
		expect(decision.action).toBe('fail');
		expect(decision.reason).toContain('could not determine');
	});

	it('every decision carries a non-empty human-readable reason', () => {
		for (const input of [
			{ identityGateAvailable: true, changedDraftPaths: [], baseRefResolved: true },
			{ identityGateAvailable: false, changedDraftPaths: [], baseRefResolved: true },
			{ identityGateAvailable: false, changedDraftPaths: ['x.svx'], baseRefResolved: true },
			{ identityGateAvailable: false, changedDraftPaths: [], baseRefResolved: false },
		] as const) {
			const decision = decideIdentityGateScope(input);
			expect(decision.reason.length).toBeGreaterThan(10);
		}
	});
});
