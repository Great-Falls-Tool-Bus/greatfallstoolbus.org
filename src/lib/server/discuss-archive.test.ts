import { describe, expect, it, vi } from 'vitest';
import {
	DiscussArchiveError,
	LIST_ADDRESS,
	PUBLIC_ARCHIVE_BASE,
	PUBLIC_ARCHIVE_URL,
	assertSnapshotIsPublicSafe,
	assertValidSnapshotShape,
	buildSnapshot,
	fetchDiscussSnapshot,
	idFromUrl,
	looksLikeEmail,
	mapThread,
	safeDisplayName,
	sanitizeExcerpt,
	sortThreads,
	stripSubjectPrefix,
	toIso,
	type DiscussSnapshot,
	type DiscussThread,
} from './discuss-archive';

function thread(overrides: Partial<DiscussThread> = {}): DiscussThread {
	return {
		threadId: 'AAA',
		subject: 'Hello world',
		startedAt: '2026-07-04T17:45:00.000Z',
		lastActiveAt: '2026-07-04T17:45:00.000Z',
		repliesCount: 0,
		participantsCount: 1,
		starterName: 'Jess Sullivan',
		url: `${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/thread/AAA/`,
		excerpt: 'A friendly first post.',
		...overrides,
	};
}

describe('stripSubjectPrefix', () => {
	it('removes a bracketed list prefix', () => {
		expect(stripSubjectPrefix('[Discuss] Hello world!')).toBe('Hello world!');
	});
	it('leaves an unprefixed subject intact', () => {
		expect(stripSubjectPrefix('Hello world!')).toBe('Hello world!');
	});
	it('never returns empty for a bracket-only subject', () => {
		expect(stripSubjectPrefix('[Discuss]')).toBe('[Discuss]');
	});
});

describe('looksLikeEmail / safeDisplayName', () => {
	it('detects raw and HyperKitty-obfuscated addresses', () => {
		expect(looksLikeEmail('a@b.com')).toBe(true);
		expect(looksLikeEmail('jess (a) sulliwood.org')).toBe(true);
		expect(looksLikeEmail('bob (at) example.net')).toBe(true);
		expect(looksLikeEmail('Jess Sullivan')).toBe(false);
	});
	it('passes a real display name through untouched', () => {
		expect(safeDisplayName('Jess Sullivan')).toBe('Jess Sullivan');
	});
	it('reduces an obfuscated address to a safe title-cased local part', () => {
		expect(safeDisplayName('jess (a) sulliwood.org')).toBe('Jess');
		expect(safeDisplayName('jane.q.public@example.com')).toBe('Jane Q Public');
	});
	it('falls back to Anonymous for empty input', () => {
		expect(safeDisplayName('')).toBe('Anonymous');
		expect(safeDisplayName(null)).toBe('Anonymous');
	});
	it('never emits an @ or obfuscation marker', () => {
		for (const raw of ['a@b.com', 'x (a) y.org', '@leading', 'weird (at) host.co.uk']) {
			const out = safeDisplayName(raw);
			expect(out).not.toMatch(/@/);
			expect(out).not.toMatch(/\((?:a|at)\)/);
		}
	});
});

describe('sanitizeExcerpt', () => {
	it('strips signatures, quotes, tags and urls, and collapses whitespace', () => {
		const raw = ':D\n\nBlog <https://example.org/> - Git\n<https://github.com/x>\n';
		expect(sanitizeExcerpt(raw)).toBe(':D Blog - Git');
	});
	it('drops quoted reply lines and attribution', () => {
		const raw = 'On Mon someone wrote:\n> old text\nMy new reply.';
		expect(sanitizeExcerpt(raw)).toBe('My new reply.');
	});
	it('stops at the signature delimiter', () => {
		expect(sanitizeExcerpt('Real body.\n-- \nSecret Signature')).toBe('Real body.');
	});
	it('caps at 280 characters with an ellipsis', () => {
		const out = sanitizeExcerpt('word '.repeat(120));
		expect(out.length).toBeLessThanOrEqual(280);
		expect(out.endsWith('…')).toBe(true);
	});
	it('returns empty string for empty input', () => {
		expect(sanitizeExcerpt('')).toBe('');
		expect(sanitizeExcerpt(null)).toBe('');
	});
});

describe('toIso / idFromUrl', () => {
	it('normalizes a Z timestamp to millisecond ISO', () => {
		expect(toIso('2026-07-05T23:10:30Z')).toBe('2026-07-05T23:10:30.000Z');
	});
	it('throws on an unparseable timestamp', () => {
		expect(() => toIso('not-a-date')).toThrow(DiscussArchiveError);
	});
	it('extracts the trailing id from a HyperKitty url', () => {
		expect(idFromUrl('http://x/hyperkitty/api/list/discuss@latoolb.us/email/ABC123/?format=json')).toBe('ABC123');
	});
});

describe('mapThread', () => {
	it('maps HyperKitty detail + starter into the contract shape', () => {
		const mapped = mapThread(
			{
				thread_id: 'TID9',
				subject: '[Discuss] Hello world!',
				date_active: '2026-07-05T23:10:30Z',
				replies_count: 2,
				participants_count: 3,
				starting_email: 'ignored',
			} as unknown as Parameters<typeof mapThread>[0],
			{
				sender_name: 'Jess Sullivan',
				date: '2026-07-05T23:00:00Z',
				content: 'Hi all.\n-- \nsig',
			} as unknown as Parameters<typeof mapThread>[1],
		);
		expect(mapped).toEqual({
			threadId: 'TID9',
			subject: 'Hello world!',
			startedAt: '2026-07-05T23:00:00.000Z',
			lastActiveAt: '2026-07-05T23:10:30.000Z',
			repliesCount: 2,
			participantsCount: 3,
			starterName: 'Jess Sullivan',
			url: `${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/thread/TID9/`,
			excerpt: 'Hi all.',
		});
	});
});

describe('sortThreads / buildSnapshot', () => {
	it('orders by lastActiveAt desc, ties broken by threadId', () => {
		const a = thread({ threadId: 'A', lastActiveAt: '2026-07-01T00:00:00.000Z' });
		const b = thread({ threadId: 'B', lastActiveAt: '2026-07-03T00:00:00.000Z' });
		const c = thread({ threadId: 'C', lastActiveAt: '2026-07-03T00:00:00.000Z' });
		expect(sortThreads([a, c, b]).map((t) => t.threadId)).toEqual(['B', 'C', 'A']);
	});
	it('caps at 50 threads', () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			thread({
				threadId: `T${String(i).padStart(2, '0')}`,
				lastActiveAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
			}),
		);
		const snap = buildSnapshot(many, '2026-07-06T00:00:00.000Z');
		expect(snap.threadCount).toBe(50);
		expect(snap.threads.length).toBe(50);
	});
	it('is deterministic for the same input', () => {
		const input = [thread({ threadId: 'A' }), thread({ threadId: 'B', lastActiveAt: '2026-07-05T00:00:00.000Z' })];
		const at = '2026-07-06T00:00:00.000Z';
		expect(JSON.stringify(buildSnapshot(input, at))).toBe(JSON.stringify(buildSnapshot(input, at)));
	});
});

describe('assertValidSnapshotShape', () => {
	const base: DiscussSnapshot = {
		generatedAt: '2026-07-06T00:00:00.000Z',
		list: LIST_ADDRESS,
		archiveUrl: PUBLIC_ARCHIVE_URL,
		threadCount: 1,
		threads: [thread()],
	};
	it('accepts a well-formed snapshot', () => {
		expect(() => assertValidSnapshotShape(base)).not.toThrow();
	});
	it('rejects a threadCount / length mismatch', () => {
		expect(() => assertValidSnapshotShape({ ...base, threadCount: 2 })).toThrow(DiscussArchiveError);
	});
	it('rejects non-integer counts', () => {
		expect(() => assertValidSnapshotShape({ ...base, threads: [thread({ repliesCount: -1 })] })).toThrow();
	});
});

describe('assertSnapshotIsPublicSafe (privacy gate)', () => {
	const safe: DiscussSnapshot = {
		generatedAt: '2026-07-06T00:00:00.000Z',
		list: LIST_ADDRESS,
		archiveUrl: PUBLIC_ARCHIVE_URL,
		threadCount: 1,
		threads: [thread()],
	};
	it('passes a clean discuss-only snapshot', () => {
		expect(() => assertSnapshotIsPublicSafe(safe)).not.toThrow();
	});
	it('hard-fails on the keyholders list token anywhere', () => {
		expect(() => assertSnapshotIsPublicSafe({ ...safe, threads: [thread({ subject: 'about keyholders@' })] })).toThrow(
			/keyholders/,
		);
	});
	it('hard-fails on a raw email address in any field', () => {
		expect(() =>
			assertSnapshotIsPublicSafe({ ...safe, threads: [thread({ excerpt: 'mail me at bob@evil.com' })] }),
		).toThrow(DiscussArchiveError);
	});
	it('hard-fails on a HyperKitty-obfuscated address', () => {
		expect(() =>
			assertSnapshotIsPublicSafe({ ...safe, threads: [thread({ starterName: 'bob (a) evil.org' })] }),
		).toThrow(DiscussArchiveError);
	});
	it('hard-fails when list is not the public discuss address', () => {
		expect(() => assertSnapshotIsPublicSafe({ ...safe, list: 'keyholders@latoolb.us' })).toThrow(DiscussArchiveError);
	});
	it('hard-fails on a thread url not anchored to the public archive', () => {
		expect(() =>
			assertSnapshotIsPublicSafe({ ...safe, threads: [thread({ url: 'https://evil.example/thread/AAA/' })] }),
		).toThrow(DiscussArchiveError);
	});
	it('permits the public list address in url/list/archiveUrl fields', () => {
		// The allowed list address contains an "@" and must NOT trip the gate.
		expect(safe.threads[0].url).toContain(LIST_ADDRESS);
		expect(() => assertSnapshotIsPublicSafe(safe)).not.toThrow();
	});
});

describe('fetchDiscussSnapshot', () => {
	const listBody = [
		{
			thread_id: 'TID1',
			subject: '[Discuss] Hello world!',
			date_active: '2026-07-05T23:10:30Z',
			replies_count: 0,
			starting_email: 'http://svc/hyperkitty/api/list/discuss@latoolb.us/email/TID1/?format=json',
		},
	];
	const detail = {
		thread_id: 'TID1',
		subject: '[Discuss] Hello world!',
		date_active: '2026-07-05T23:10:30Z',
		replies_count: 0,
		participants_count: 1,
		starting_email: 'http://svc/hyperkitty/api/list/discuss@latoolb.us/email/TID1/?format=json',
	};
	const starter = { sender_name: 'jess (a) sulliwood.org', date: '2026-07-05T23:10:30Z', content: ':D\n-- \nsig' };

	function mockFetch(map: Record<string, unknown>): typeof fetch {
		return vi.fn(async (url: string | URL) => {
			const key = String(url);
			const match = Object.keys(map).find((k) => key.includes(k));
			if (!match) return { ok: false, status: 404, json: async () => ({}) } as Response;
			return { ok: true, status: 200, json: async () => map[match] } as Response;
		}) as unknown as typeof fetch;
	}

	it('builds a sanitized snapshot from mocked HyperKitty reads', async () => {
		const snap = await fetchDiscussSnapshot({
			origin: 'http://svc:8080',
			now: () => new Date('2026-07-06T00:00:00.000Z'),
			fetch: mockFetch({ '/threads/': listBody, '/thread/TID1/': detail, '/email/TID1/': starter }),
		});
		expect(snap.list).toBe(LIST_ADDRESS);
		expect(snap.threadCount).toBe(1);
		expect(snap.threads[0].starterName).toBe('Jess'); // obfuscated address never leaks
		expect(snap.threads[0].subject).toBe('Hello world!');
		expect(JSON.stringify(snap)).not.toMatch(/\(a\)/);
	});

	it('returns the fallback fixture (never throws) when the service is unreachable', async () => {
		const fixture: DiscussSnapshot = {
			generatedAt: '2026-07-06T00:00:00.000Z',
			list: LIST_ADDRESS,
			archiveUrl: PUBLIC_ARCHIVE_URL,
			threadCount: 0,
			threads: [],
		};
		const boom = vi.fn(async () => {
			throw new Error('ENOTFOUND');
		}) as unknown as typeof fetch;
		const snap = await fetchDiscussSnapshot({ origin: 'http://svc:8080', fetch: boom, fallback: fixture });
		expect(snap).toBe(fixture);
	});

	it('returns a valid empty snapshot when no fallback is supplied and fetch fails', async () => {
		const boom = vi.fn(async () => {
			throw new Error('down');
		}) as unknown as typeof fetch;
		const snap = await fetchDiscussSnapshot({
			origin: 'http://svc:8080',
			fetch: boom,
			now: () => new Date('2026-07-06T00:00:00.000Z'),
		});
		expect(snap.threadCount).toBe(0);
		expect(() => assertValidSnapshotShape(snap)).not.toThrow();
	});
});
