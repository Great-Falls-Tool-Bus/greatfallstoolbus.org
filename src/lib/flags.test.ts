import { describe, expect, it } from 'vitest';
import { parseFlag } from './flags';

// The flag parser is the fail-closed gate for the public discuss@ archive
// surface (TIN-2528): anything that is not an explicit truthy spelling must read
// as OFF, so an unset / typo'd / empty env var can never accidentally publish
// the outbound archive link before the operator go-live checklist has run.
describe('parseFlag', () => {
	it('reads explicit truthy spellings as true', () => {
		for (const raw of ['true', 'TRUE', ' True ', '1', 'yes', 'on']) {
			expect(parseFlag(raw)).toBe(true);
		}
	});

	it('passes real booleans through', () => {
		expect(parseFlag(true)).toBe(true);
		expect(parseFlag(false)).toBe(false);
	});

	it('fails closed for unset, empty, and non-truthy strings', () => {
		for (const raw of [undefined, null, '', ' ', 'false', '0', 'no', 'off', 'maybe']) {
			expect(parseFlag(raw)).toBe(false);
		}
	});
});
