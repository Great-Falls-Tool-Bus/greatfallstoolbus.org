import { describe, expect, it } from 'vitest';
import { TINT_STOPS, tintFor } from './tint';

describe('tintFor', () => {
	it('always returns one of the five omux brand stops', () => {
		for (const name of ['Ripley', 'J.', 'Alex', 'Jess Sullivan', 'Ithaca Generator', '', '   ']) {
			expect(TINT_STOPS).toContain(tintFor(name));
		}
	});

	it('is deterministic: the same name resolves to the same stop', () => {
		expect(tintFor('Jess Sullivan')).toBe(tintFor('Jess Sullivan'));
		expect(tintFor('Alex')).toBe(tintFor('Alex'));
	});

	it('mirrors the exact brand set (order + values) used by the wordmark', () => {
		expect(TINT_STOPS).toEqual(['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c']);
	});

	it('spreads a small roster across more than one stop', () => {
		const names = ['Ripley', 'J.', 'Alex', 'Jess Sullivan', 'Ithaca Generator'];
		const distinct = new Set(names.map(tintFor));
		expect(distinct.size).toBeGreaterThan(1);
	});
});
