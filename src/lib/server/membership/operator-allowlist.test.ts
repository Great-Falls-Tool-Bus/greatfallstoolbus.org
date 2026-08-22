/**
 * S13 unit rows for the operator allowlist: fail-closed on unset/empty, exact
 * membership, no accidental substring/whitespace matches.
 */

import { describe, expect, it } from 'vitest';
import { isAllowlistedOperator, parseOperatorAllowlist } from './operator-allowlist';

describe('parseOperatorAllowlist', () => {
	it('unset env value parses to null — fail-closed, not "allow all"', () => {
		expect(parseOperatorAllowlist(undefined)).toBeNull();
	});

	it('empty string parses to null', () => {
		expect(parseOperatorAllowlist('')).toBeNull();
	});

	it('whitespace-only string parses to null', () => {
		expect(parseOperatorAllowlist('   ')).toBeNull();
	});

	it('a trailing comma does not smuggle in an empty-string id', () => {
		const allowlist = parseOperatorAllowlist('alice,');
		expect(allowlist).not.toBeNull();
		expect(allowlist).toEqual(new Set(['alice']));
	});

	it('a comma-only value (no real ids) parses to null', () => {
		expect(parseOperatorAllowlist(',,,')).toBeNull();
	});

	it('trims whitespace around each id', () => {
		expect(parseOperatorAllowlist(' alice , bob ')).toEqual(new Set(['alice', 'bob']));
	});

	it('parses multiple ids', () => {
		expect(parseOperatorAllowlist('alice,bob,carol')).toEqual(new Set(['alice', 'bob', 'carol']));
	});
});

describe('isAllowlistedOperator', () => {
	it('returns false when the env var is entirely unset', () => {
		expect(isAllowlistedOperator('alice', {})).toBe(false);
	});

	it('returns false when the env var is set but empty', () => {
		expect(isAllowlistedOperator('alice', { GFTB_OPERATOR_PERSON_IDS: '' })).toBe(false);
	});

	it('returns false for a person id not on a non-empty list', () => {
		expect(isAllowlistedOperator('mallory', { GFTB_OPERATOR_PERSON_IDS: 'alice,bob' })).toBe(false);
	});

	it('returns true for a person id on the list', () => {
		expect(isAllowlistedOperator('bob', { GFTB_OPERATOR_PERSON_IDS: 'alice,bob' })).toBe(true);
	});

	it('is exact-match, not substring: "alice" does not match a list of "alice2"', () => {
		expect(isAllowlistedOperator('alice', { GFTB_OPERATOR_PERSON_IDS: 'alice2' })).toBe(false);
	});

	it('is case-sensitive: ids are opaque UUID-shaped strings, not names to fold', () => {
		expect(isAllowlistedOperator('Alice', { GFTB_OPERATOR_PERSON_IDS: 'alice' })).toBe(false);
	});
});
