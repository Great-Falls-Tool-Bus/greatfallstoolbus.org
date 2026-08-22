// Pure decision logic for the naming-consent identity gate's CI-scope
// policy (v2 round 3 fix, review on PR #190 at `827f20a`). Factored out of
// scripts/validate-discuss-drafts.mts so the policy itself — as opposed to
// the git plumbing that feeds it — is unit-testable without a real git
// checkout or filesystem.
//
// THE GAP THIS CLOSES: the identity gate (src/lib/naming-consent.ts)
// requires a local key that never enters any git tree, so it structurally
// cannot run in CI. The previous behavior was to skip the identity check
// entirely whenever the key was absent, printing a warning but still
// exiting 0. Review traced a real hole in that: a hand-written draft
// containing a protected identity, added from a machine without the key,
// would validate `OK` and CI would read green — as if the consent gate had
// run, when it never touched that content at all.
//
// THE FIX: key-absent mode is only safe to treat as "nothing to check" when
// nothing under src/content/discuss-drafts/** actually changed relative to
// a base ref (i.e. this run isn't introducing or modifying staged content).
// If the key is absent AND the staging tree changed, that's exactly the
// case that must be caught, so it fails instead of skipping. This makes
// "every file that ever entered src/content/discuss-drafts/** was verified
// by a keyed run at some point" an inductive invariant, not an assumption:
// the only way a changed file can pass CI is a keyed run (locally, or a
// future CI-secret-provisioned run) actually checking it.
export interface CiScopeDecision {
	action: 'run-full' | 'skip-loud' | 'fail';
	reason: string;
}

export interface CiScopeInput {
	/** Whether ~/.gftb/naming-consent.key is present in this environment. */
	identityGateAvailable: boolean;
	/**
	 * Paths under src/content/discuss-drafts/** that differ from the base
	 * ref (committed changes) or from HEAD (uncommitted local changes).
	 * Empty means "nothing changed here, relative to what's already known
	 * to have been verified."
	 */
	changedDraftPaths: readonly string[];
	/**
	 * False if the diff itself couldn't be computed at all (e.g. no base
	 * ref could be resolved). Fails closed rather than treating "couldn't
	 * check" the same as "checked, nothing changed" — those are not the
	 * same claim.
	 */
	baseRefResolved: boolean;
}

export function decideIdentityGateScope(input: CiScopeInput): CiScopeDecision {
	if (input.identityGateAvailable) {
		return { action: 'run-full', reason: 'naming-consent key is present — the full identity gate runs.' };
	}
	if (!input.baseRefResolved) {
		return {
			action: 'fail',
			reason:
				'the naming-consent key is absent AND this environment could not determine whether ' +
				'src/content/discuss-drafts/** changed relative to a base ref. Failing closed rather ' +
				'than assuming nothing changed — those are not the same claim. The identity gate ' +
				"requires a keyed machine (the operator's); run `just discuss-drafts-validate` there.",
		};
	}
	if (input.changedDraftPaths.length > 0) {
		return {
			action: 'fail',
			reason:
				`src/content/discuss-drafts/** has ${input.changedDraftPaths.length} changed path(s) ` +
				`(${input.changedDraftPaths.join(', ')}) and the naming-consent key is absent, so the ` +
				'identity gate cannot verify this change. The identity gate requires a keyed machine ' +
				"(the operator's) — run `just discuss-drafts-validate` there (or provision the key to " +
				'CI) before this can pass. A green check here would otherwise read as "the consent ' +
				'gate ran" when it did not — see docs/runbooks/discuss-to-svx-pipeline.md, "CI scope".',
		};
	}
	return {
		action: 'skip-loud',
		reason:
			'the naming-consent key is absent, but src/content/discuss-drafts/** is unchanged ' +
			'relative to the base ref — this content was already verified by a keyed run when it ' +
			'was added or last changed. Safe to skip the identity check here.',
	};
}
