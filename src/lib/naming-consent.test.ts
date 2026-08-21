import { describe, expect, it } from 'vitest';
import { assertNamingConsent, assertNoBareEmailAddress, NamingConsentError } from './naming-consent';

describe('assertNamingConsent', () => {
	it('passes clean prose, including the allowed "J." form', () => {
		expect(() => assertNamingConsent('Alex and J. are drafting the lease. Ripley offered to help too.')).not.toThrow();
	});

	it('rejects the private-only identity in any case', () => {
		for (const variant of ['Walter said hi', 'WALTER is on the list', 'ask walter about it']) {
			expect(() => assertNamingConsent(variant)).toThrow(NamingConsentError);
		}
	});

	it("rejects the bus host's unredacted first name", () => {
		for (const variant of ['ask Josh', 'JOSH said', "josh's plot"]) {
			expect(() => assertNamingConsent(variant)).toThrow(NamingConsentError);
		}
	});

	it('does not false-positive on a longer name sharing a prefix', () => {
		expect(() => assertNamingConsent('Joshua stopped by the bus.')).not.toThrow();
	});

	it('includes the given context in the thrown message', () => {
		expect(() => assertNamingConsent('Walter', 'draft.svx body')).toThrow(/draft\.svx body/);
	});
});

describe('assertNoBareEmailAddress', () => {
	it('passes text with no address-shaped substring', () => {
		expect(() => assertNoBareEmailAddress('Reach out on the list or at the teahouse.')).not.toThrow();
	});

	it('allows addresses explicitly passed in the allowlist', () => {
		expect(() =>
			assertNoBareEmailAddress('Post to discuss@latoolb.us any time.', ['discuss@latoolb.us']),
		).not.toThrow();
	});

	it('is case-insensitive when matching the allowlist', () => {
		expect(() => assertNoBareEmailAddress('Post to DISCUSS@latoolb.us.', ['discuss@latoolb.us'])).not.toThrow();
	});

	it('rejects an address not on the allowlist', () => {
		expect(() => assertNoBareEmailAddress('reach me at jess@sulliwood.org', ['discuss@latoolb.us'])).toThrow(
			NamingConsentError,
		);
	});

	it('rejects an address with an empty allowlist', () => {
		expect(() => assertNoBareEmailAddress('reach me at jess@sulliwood.org')).toThrow(NamingConsentError);
	});

	it('never echoes the raw address in the error message', () => {
		try {
			assertNoBareEmailAddress('reach me at jess@sulliwood.org');
			throw new Error('expected assertNoBareEmailAddress to throw');
		} catch (error) {
			expect(String(error)).not.toContain('jess@sulliwood.org');
		}
	});
});
