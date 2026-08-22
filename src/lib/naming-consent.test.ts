// Fixtures here are SYNTHETIC ONLY — "Alex Example", "Ripley", "J.",
// "person@example.invalid", "Zzyzxqplon" — never a real protected identity
// or address. See naming-consent.ts's module header for why: a denylist of
// private identifiers is itself a disclosure, and that includes test
// fixtures in a public repo.
//
// EVERY test below passes its own synthetic key + hash list explicitly.
// None of them touch the real ~/.gftb/naming-consent.key or the real
// committed src/lib/naming-consent.hashes.json — those don't exist in CI
// (that's the whole point of the design; see isIdentityGateAvailable), so a
// test that implicitly depended on them would be non-portable by
// construction. The hash pairs here are computed with the exact same
// algorithm scripts/generate-naming-consent-hashes.mjs uses (HMAC-SHA256,
// normalized token, hex digest) so the mechanism proof is real, not a
// stand-in.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	assertNamingConsent,
	assertNoBareEmailAddress,
	assertNoBarePhoneNumber,
	containsProtectedIdentity,
	isIdentityGateAvailable,
	MAX_TOKEN_LENGTH,
	MIN_TOKEN_LENGTH,
	NamingConsentError,
	normalizeForConsent,
	validateHashList,
} from './naming-consent';

const TEST_KEY = Buffer.from('test-only-key-does-not-protect-anything-in-real-repo-data', 'utf8');

function hmac(token: string): string {
	return createHmac('sha256', TEST_KEY).update(normalizeForConsent(token), 'utf8').digest('hex');
}

describe('normalizeForConsent', () => {
	it('lowercases and strips whitespace and punctuation', () => {
		expect(normalizeForConsent('  Alex-Example, Esq.  ')).toBe('alexexampleesq');
	});

	it('collapses a line-wrapped word into one contiguous token', () => {
		expect(normalizeForConsent('Alex\nExample')).toBe('alexexample');
		expect(normalizeForConsent('Alex-\nExample')).toBe('alexexample');
	});

	it('is idempotent on already-normalized text', () => {
		expect(normalizeForConsent('alexexample')).toBe('alexexample');
	});

	it('folds precomposed and decomposed diacritics to the bare base letter', () => {
		expect(normalizeForConsent('Éxample')).toBe('example'); // precomposed É (NFC)
		expect(normalizeForConsent('Éxample')).toBe('example'); // decomposed E + combining acute
		expect(normalizeForConsent('Àlêx Èxämplé')).toBe('alexexample');
	});

	it('folds the covered Cyrillic/Greek homoglyphs to their Latin lookalike', () => {
		// Cyrillic а (U+0430), е (U+0435), о (U+043E) in place of Latin a/e/o
		expect(normalizeForConsent('аlеx')).toBe('alex');
		// Greek ο (omicron, U+03BF) and ρ (rho, U+03C1)
		expect(normalizeForConsent('rοpρe')).toBe('roppe');
	});
});

describe('containsProtectedIdentity (mechanism proof, synthetic key + test-only hash list)', () => {
	const SECRET = 'Zzyzxqplon'; // 10 chars normalized — well within [MIN_TOKEN_LENGTH, MAX_TOKEN_LENGTH]
	const hashes = new Set([hmac(SECRET)]);
	const ctx = { key: TEST_KEY, hashes };

	it('matches the synthetic secret verbatim', () => {
		expect(containsProtectedIdentity('Zzyzxqplon showed up today', ctx)).toBe(true);
	});

	it('matches case-insensitively', () => {
		expect(containsProtectedIdentity('ZZYZXQPLON showed up today', ctx)).toBe(true);
	});

	it('matches across a line-wrap split', () => {
		expect(containsProtectedIdentity('Zzyzxq\nplon showed up today', ctx)).toBe(true);
	});

	it('matches inside a slug-shaped string', () => {
		expect(containsProtectedIdentity('ask-zzyzxqplon-about-it', ctx)).toBe(true);
	});

	it('matches a diacritic form', () => {
		expect(containsProtectedIdentity('Zzyzxqplón showed up', ctx)).toBe(true);
	});

	it('matches a covered homoglyph form (Cyrillic о, U+043E, substituted for the Latin o)', () => {
		// "Zzyzxqplоnn" — Cyrillic о in place of the Latin 'o' in "Zzyzxqplon"
		expect(
			containsProtectedIdentity('Zzyzxqplоon around', { key: TEST_KEY, hashes: new Set([hmac('Zzyzxqploon')]) }),
		).toBe(true);
	});

	it('does NOT match an uncovered homoglyph — documents the residual honestly (not a full UTS #39 skeleton)', () => {
		// U+0442 CYRILLIC SMALL TE is not in the small explicit CONFUSABLES map
		// in naming-consent.ts (only а/е/о/р/с/х/у/і/ј/ѕ/к/м and Greek ο/ρ are
		// covered). Substituting it for a Latin letter in an otherwise-matching
		// string must NOT fold to the protected token — proving the map really
		// is the small, explicit, documented set it claims to be, not secretly
		// broader.
		const withUncoveredHomoglyph = 'Zzyzxqplon'.replace('n', 'т'); // -> "Zzyzxqplo" + Cyrillic te
		expect(containsProtectedIdentity(withUncoveredHomoglyph, ctx)).toBe(false);
	});

	it('does not match unrelated text', () => {
		expect(containsProtectedIdentity('perfectly ordinary text about buses and tools', ctx)).toBe(false);
	});

	it('does not match a near-miss of the same length', () => {
		expect(containsProtectedIdentity('qqqqqqqqqq is here', ctx)).toBe(false);
	});

	it('with an empty hash list, matches nothing (pure-function behavior — the loader enforces non-empty separately)', () => {
		expect(containsProtectedIdentity('Zzyzxqplon showed up today', { key: TEST_KEY, hashes: new Set() })).toBe(false);
	});

	it('respects the window range: a token shorter than MIN_TOKEN_LENGTH cannot match', () => {
		const shortToken = 'abc'; // 3 chars, below MIN_TOKEN_LENGTH (4)
		expect(shortToken.length).toBeLessThan(MIN_TOKEN_LENGTH);
		const shortCtx = { key: TEST_KEY, hashes: new Set([hmac(shortToken)]) };
		expect(containsProtectedIdentity('abc is not enrollable this way', shortCtx)).toBe(false);
	});

	it('respects the window range: a token longer than MAX_TOKEN_LENGTH cannot match', () => {
		const longToken = 'a'.repeat(MAX_TOKEN_LENGTH + 1);
		const longCtx = { key: TEST_KEY, hashes: new Set([hmac(longToken)]) };
		expect(containsProtectedIdentity(`text containing ${longToken} inline`, longCtx)).toBe(false);
	});
});

describe('assertNamingConsent', () => {
	const SECRET = 'Zzyzxqplon';
	const ctx = { key: TEST_KEY, hashes: new Set([hmac(SECRET)]) };

	it('passes ordinary prose with synthetic public names', () => {
		expect(() =>
			assertNamingConsent('Alex and J. are planning the holiday potluck. Ripley offered to help too.', 'text', ctx),
		).not.toThrow();
	});

	it('includes the given context in the thrown message, never the matched text', () => {
		expect(() => assertNamingConsent('Zzyzxqplon showed up today', 'draft.svx body', ctx)).toThrow(NamingConsentError);
		try {
			assertNamingConsent('Zzyzxqplon showed up today', 'draft.svx body', ctx);
			throw new Error('expected assertNamingConsent to throw');
		} catch (error) {
			expect(String(error)).toContain('draft.svx body');
			expect(String(error)).not.toContain('Zzyzxqplon');
		}
	});

	it('with an empty test-only hash list, does not throw on unrelated text', () => {
		expect(() =>
			assertNamingConsent('perfectly ordinary text', 'text', { key: TEST_KEY, hashes: new Set() }),
		).not.toThrow();
	});
});

describe('validateHashList (fail-closed loader validation)', () => {
	it('accepts a well-formed non-empty array of 64-hex-char digests', () => {
		const valid = [hmac('a'), hmac('b')];
		const result = validateHashList(valid, 'test source');
		expect(result.size).toBe(2);
	});

	it('rejects an empty array', () => {
		expect(() => validateHashList([], 'test source')).toThrow(/empty or malformed/);
	});

	it('rejects a non-array', () => {
		expect(() => validateHashList({}, 'test source')).toThrow(/empty or malformed/);
		expect(() => validateHashList(null, 'test source')).toThrow(/empty or malformed/);
		expect(() => validateHashList('not an array', 'test source')).toThrow(/empty or malformed/);
	});

	it('rejects an array containing a non-hex or wrong-length entry', () => {
		expect(() => validateHashList(['not-hex'], 'test source')).toThrow(/empty or malformed/);
		expect(() => validateHashList([hmac('a'), 'short'], 'test source')).toThrow(/empty or malformed/);
	});

	it('includes the given source label in the error message', () => {
		expect(() => validateHashList([], '/some/path/hashes.json')).toThrow(/\/some\/path\/hashes\.json/);
	});
});

describe('isIdentityGateAvailable', () => {
	it('returns a boolean without throwing (value is environment-dependent — CI has no key, dev may)', () => {
		expect(typeof isIdentityGateAvailable()).toBe('boolean');
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
		expect(() => assertNoBareEmailAddress('reach me at person@example.invalid', ['discuss@latoolb.us'])).toThrow(
			NamingConsentError,
		);
	});

	it('rejects an address with an empty allowlist', () => {
		expect(() => assertNoBareEmailAddress('reach me at person@example.invalid')).toThrow(NamingConsentError);
	});

	it('never echoes the raw address in the error message', () => {
		try {
			assertNoBareEmailAddress('reach me at person@example.invalid');
			throw new Error('expected assertNoBareEmailAddress to throw');
		} catch (error) {
			expect(String(error)).not.toContain('person@example.invalid');
		}
	});
});

describe('assertNoBarePhoneNumber', () => {
	it('passes text with no phone-shaped substring', () => {
		expect(() => assertNoBarePhoneNumber('Reach out on the list or at the teahouse.')).not.toThrow();
	});

	it('rejects a NANP-shaped phone number', () => {
		for (const variant of ['555-123-4567', '(555) 123-4567', '+1 555.123.4567', '5551234567']) {
			expect(() => assertNoBarePhoneNumber(variant)).toThrow(NamingConsentError);
		}
	});

	it('never echoes the full number in the error message', () => {
		try {
			assertNoBarePhoneNumber('call 555-123-4567');
			throw new Error('expected assertNoBarePhoneNumber to throw');
		} catch (error) {
			expect(String(error)).not.toContain('555-123-4567');
		}
	});
});
