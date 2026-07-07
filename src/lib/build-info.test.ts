import { describe, expect, it } from 'vitest';
import { normalizeSha, buildSha, buildShaShort } from './build-info';

// build-info wires the footer "built from <sha>" provenance. The sha reaches the
// client through import.meta.env.PUBLIC_BUILD_SHA, set ONLY by the container image
// recipes. The normalizer must fail-quiet — anything that is not a real hex sha
// (unset, the literal 'unknown', or noise) must read as '' so the footer renders
// no line rather than a bogus commit link on local / adapter-static builds.
describe('normalizeSha', () => {
	it('accepts a full 40-char hex sha and lowercases it', () => {
		const sha = '378508B4AA23185D19B6D250CE97F3A071B98807';
		expect(normalizeSha(sha)).toBe(sha.toLowerCase());
	});

	it('accepts a padded / short hex sha', () => {
		expect(normalizeSha(' 378508b ')).toBe('378508b');
	});

	it('fails quiet for unset, unknown, and non-hex noise', () => {
		for (const raw of [undefined, null, '', ' ', 'unknown', 'dev', 'not-a-sha', '123456', 'zzzzzzz']) {
			expect(normalizeSha(raw)).toBe('');
		}
	});
});

// In the test / local environment PUBLIC_BUILD_SHA is unset, so provenance must
// degrade to empty — the footer line is then hidden, never broken.
describe('build provenance defaults', () => {
	it('degrades to empty when PUBLIC_BUILD_SHA is unset', () => {
		expect(buildSha).toBe('');
		expect(buildShaShort).toBe('');
	});
});
