// Unit tests for scripts/discuss-reconcile.mts — the pure surface only:
// argument parsing, the textual archive-URL family check, and the
// reconcile text transform (including a full mdsvex + schema round-trip of
// its output). The impure wrapper (reconcileDraft) requires
// ~/.gftb/naming-consent.key, which never exists in CI by design (see the
// runbook's "CI scope" section), so it is deliberately not exercised here —
// it is a thin compose of the pure transform, the shared naming-consent
// gates (tested in src/lib/naming-consent.test.ts), and the shared schema.
import { compile } from 'mdsvex';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
	DiscussDraftFrontmatter,
	PUBLIC_THREAD_URL_PREFIX,
	SOURCE_LIST,
	TARGET_LIST,
} from '../src/lib/data/discuss-draft-schema.ts';
import { assertPublicThreadUrl, parseArgs, reconcileDraftText } from './discuss-reconcile.mts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain .mjs generator, deliberately not typed
import { PENDING_COMMENT } from './discuss-to-svx.mjs';

const THREAD_ID = 'SYNTHETICTHREADID1234';
const ARCHIVE_URL = `${PUBLIC_THREAD_URL_PREFIX}${THREAD_ID}/`;

const PROVENANCE = `<!-- provenance: ${SOURCE_LIST} archive, HK id 999 (private list; no email addresses recorded) -->`;
const PREPARED_LINE = "preparedAt: '2026-08-20T23:15:00Z'";

/** A generator-shaped published:false fixture (matches discuss-to-svx.mjs output). */
const FIXTURE = `---
subject: 'Reposting from the keyholders archive: synthetic fixture'
sourceList: '${SOURCE_LIST}'
sourceMessageId: 'HK id 999'
sourceDate: '2026-08-15T19:17:00Z'
targetList: '${TARGET_LIST}'
published: false
${PREPARED_LINE}
---

${PROVENANCE}
${PENDING_COMMENT}

Synthetic body for the reconcile transform test.
`;

describe('parseArgs', () => {
	it('parses slug and archive-url', () => {
		expect(parseArgs(['--slug', 'a-draft', '--archive-url', ARCHIVE_URL])).toEqual({
			slug: 'a-draft',
			archiveUrl: ARCHIVE_URL,
			contentDir: undefined,
		});
	});

	it('accepts a content-dir override', () => {
		const args = parseArgs(['--slug', 'a', '--archive-url', ARCHIVE_URL, '--content-dir', '/tmp/x']);
		expect(args.contentDir).toBe('/tmp/x');
	});

	it('requires both slug and archive-url', () => {
		expect(() => parseArgs(['--archive-url', ARCHIVE_URL])).toThrow(/--slug/);
		expect(() => parseArgs(['--slug', 'a-draft'])).toThrow(/--archive-url/);
	});

	it('rejects unknown arguments and non-kebab slugs', () => {
		expect(() => parseArgs(['--slug', 'a', '--archive-url', ARCHIVE_URL, '--force'])).toThrow(/unknown argument/);
		expect(() => parseArgs(['--slug', 'Not_Kebab', '--archive-url', ARCHIVE_URL])).toThrow(/kebab-case/);
	});
});

describe('assertPublicThreadUrl', () => {
	it('accepts a discuss@ thread deep link, with or without a trailing slash', () => {
		expect(() => assertPublicThreadUrl(ARCHIVE_URL)).not.toThrow();
		expect(() => assertPublicThreadUrl(`${PUBLIC_THREAD_URL_PREFIX}${THREAD_ID}`)).not.toThrow();
	});

	it('rejects everything outside the anonymous-200 thread family', () => {
		// Not a URL at all.
		expect(() => assertPublicThreadUrl('not a url')).toThrow(/parseable/);
		// Wrong scheme.
		expect(() => assertPublicThreadUrl(ARCHIVE_URL.replace('https:', 'http:'))).toThrow(/https/);
		// Wrong host.
		const wrongHost = ARCHIVE_URL.replace('lists.latoolb.us', 'example.com');
		expect(() => assertPublicThreadUrl(wrongHost)).toThrow(/thread deep link/);
		// The private list is never a reconciliation target.
		expect(() => assertPublicThreadUrl(ARCHIVE_URL.replace(TARGET_LIST, SOURCE_LIST))).toThrow(/thread deep link/);
		// The list overview / thread index is not one thread.
		expect(() => assertPublicThreadUrl(PUBLIC_THREAD_URL_PREFIX)).toThrow(/thread index/);
		// Deeper pages under a thread are not the permalink.
		expect(() => assertPublicThreadUrl(`${ARCHIVE_URL}replies/`)).toThrow(/alphanumeric/);
		// No query, fragment, or port.
		expect(() => assertPublicThreadUrl(`${ARCHIVE_URL}?page=2`)).toThrow(/query/);
		expect(() => assertPublicThreadUrl(`${ARCHIVE_URL}#m1`)).toThrow(/fragment/);
		expect(() => assertPublicThreadUrl(ARCHIVE_URL.replace('.us/', '.us:8443/'))).toThrow(/port/);
	});
});

describe('reconcileDraftText', () => {
	it('flips published, injects archiveUrl, and removes the pending notice — nothing else', () => {
		const out = reconcileDraftText(FIXTURE, ARCHIVE_URL);
		let expected = FIXTURE.replace('published: false', 'published: true');
		expected = expected.replace(PREPARED_LINE, `${PREPARED_LINE}\narchiveUrl: '${ARCHIVE_URL}'`);
		expected = expected.replace(`${PENDING_COMMENT}\n`, '');
		expect(out).toBe(expected);
		expect(out).not.toContain(PENDING_COMMENT);
		expect(out).toContain(PROVENANCE);
	});

	it('emits frontmatter the shared schema accepts, with the pairing satisfied', async () => {
		const out = reconcileDraftText(FIXTURE, ARCHIVE_URL);
		const compiled = await compile(out, { extensions: ['.svx'] });
		const fm = Schema.decodeUnknownSync(DiscussDraftFrontmatter)(compiled?.data?.fm);
		expect(fm.published).toBe(true);
		expect(fm.archiveUrl).toBe(ARCHIVE_URL);
	});

	it('is not idempotent by design: its own output is refused', () => {
		const out = reconcileDraftText(FIXTURE, ARCHIVE_URL);
		expect(() => reconcileDraftText(out, ARCHIVE_URL)).toThrow(/already/);
	});

	it('refuses a draft already carrying an archiveUrl even if still published: false', () => {
		const withUrl = FIXTURE.replace('published: false', `published: false\narchiveUrl: '${ARCHIVE_URL}'`);
		expect(() => reconcileDraftText(withUrl, ARCHIVE_URL)).toThrow(/already carries an archiveUrl/);
	});

	it('refuses a draft missing the pending-notice comment', () => {
		const noNotice = FIXTURE.replace(`${PENDING_COMMENT}\n`, '');
		expect(() => reconcileDraftText(noNotice, ARCHIVE_URL)).toThrow(/pending-notice/);
	});

	it('refuses a draft whose body quotes the pending-notice text outside the comment', () => {
		const quoting = `${FIXTURE}\nAs the notice says: ${PENDING_COMMENT.slice('<!-- '.length, -' -->'.length)}\n`;
		expect(() => reconcileDraftText(quoting, ARCHIVE_URL)).toThrow(/survives/);
	});

	it('refuses malformed frontmatter shapes', () => {
		expect(() => reconcileDraftText('no frontmatter here', ARCHIVE_URL)).toThrow(/frontmatter/);
		expect(() => reconcileDraftText('---\nsubject: x\nnever closed', ARCHIVE_URL)).toThrow(/unterminated/);
		const missingFlag = FIXTURE.replace('published: false\n', '');
		expect(() => reconcileDraftText(missingFlag, ARCHIVE_URL)).toThrow(/no `published: false`/);
	});

	it('refuses a bad archive URL before touching the draft text', () => {
		expect(() => reconcileDraftText(FIXTURE, PUBLIC_THREAD_URL_PREFIX)).toThrow(/thread index/);
	});
});
