// Data plane for the public discuss@ community-board archive (TIN-2528).
//
// This module fetches thread metadata from the GFTB HyperKitty archive and maps
// it to the `DiscussSnapshot` contract the /discuss route renders. It is a
// SERVER-ONLY module ($lib/server/** is never shipped to the browser) so the
// in-cluster origin and the raw HyperKitty responses never reach a client.
//
// WHERE IT RUNS
//   - Today: BUILD TIME. The /discuss route prerenders on the in-cluster
//     `tinyland-nix` runner, which can reach the HyperKitty web tier over the
//     cluster Service DNS below. The netpol allowance lives in
//     great-falls-tool-bus-infra (list stack: mailman-core web-tier ingress
//     admits the runner + site namespaces).
//   - Post-cutover: REQUEST TIME under adapter-node in the
//     greatfallstoolbus-org-production namespace (same Service DNS, same netpol
//     allowance for that namespace). Do not flip prerender here; that is an
//     operator step.
//
// OFF-CLUSTER (local dev, fork CI): the Service DNS does not resolve, so the
// fetch fails fast and `fetchDiscussSnapshot` returns the caller-supplied
// fallback (default: an EMPTY snapshot — the UI renders its honest empty
// state, never invented content) with a loud console warning. It NEVER throws
// out of `fetchDiscussSnapshot`, so a build off-cluster still succeeds.
//
// PRIVACY (hard invariants, enforced in `assertSnapshotIsPublicSafe`):
//   - discuss@latoolb.us ONLY. The private keyholders@ list must never appear.
//   - display names only; no raw email addresses, including HyperKitty's
//     `name (a) host` obfuscation, may survive into the payload.
//   - excerpts are plain text, quote/signature-stripped, capped at 280 chars.
// Any breach hard-fails the build of the snapshot (throws inside the fetch,
// which is caught and downgraded to the fallback) rather than emitting a
// partial or leaky payload.

// One type source: the UI-facing contract in $lib/data/discuss-snapshot is
// canonical; this module consumes and re-exports it (the mapper always emits
// `excerpt`, which is assignable to the contract's optional field).
import type {
	DiscussSnapshot,
	DiscussThread,
	DiscussThreadDetail,
	DiscussThreadMessage,
	DiscussMessageBlock,
} from '$lib/data/discuss-snapshot';
export type { DiscussSnapshot, DiscussThread, DiscussThreadDetail, DiscussThreadMessage, DiscussMessageBlock };

export type FetchDiscussSnapshotOptions = {
	/**
	 * HyperKitty origin to read from. Defaults to the in-cluster Service DNS.
	 * Override with the DISCUSS_ARCHIVE_ORIGIN env var (see the load wiring) or
	 * by passing this explicitly in tests.
	 */
	origin?: string;
	/** Injected fetch (tests / non-global-fetch runtimes). Defaults to globalThis.fetch. */
	fetch?: typeof fetch;
	/** Returned verbatim if the live fetch fails or produces an unsafe payload. */
	fallback?: DiscussSnapshot;
	/** Deterministic clock hook for tests. Defaults to Date.now(). */
	now?: () => Date;
	/** Per-request timeout in ms. Defaults to 8000. */
	timeoutMs?: number;
};

export class DiscussArchiveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DiscussArchiveError';
	}
}

// The single public list this surface is allowed to source or name.
export const LIST_ADDRESS = 'discuss@latoolb.us';

// Public, human-facing archive base. Deep links are ALWAYS reconstructed from
// this base plus ids we control — never echoed from the API's own `url` fields,
// which carry the internal request host.
export const PUBLIC_ARCHIVE_BASE = 'https://lists.latoolb.us/hyperkitty';
export const PUBLIC_ARCHIVE_URL = `${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/`;

/**
 * Public, human-facing archive deep link for one thread — built from the public
 * base plus an id we control, never echoed from an API `url` field (those carry
 * the internal request host). This is the single "View on the mailing-list
 * archive" secondary link the on-site reader offers.
 */
export function publicThreadUrl(threadId: string): string {
	return `${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/thread/${encodeURIComponent(threadId)}/`;
}

// In-cluster read origin (Service mailman-web: ClusterIP 8080 -> web tier). This
// name resolves ONLY inside the honey cluster; it is inert and non-sensitive off
// cluster. Overridable via DISCUSS_ARCHIVE_ORIGIN.
export const DEFAULT_INCLUSTER_ORIGIN = 'http://mailman-web.latoolb-us-production.svc.cluster.local:8080';

const HYPERKITTY_PREFIX = '/hyperkitty';
const MAX_THREADS = 50;
const EXCERPT_MAX = 280;
const DEFAULT_TIMEOUT_MS = 8000;

// HyperKitty renders a sender's address (when it carries no display name) into
// the `name`/`sender_name` field, obfuscating `@` as ` (a) ` (older builds:
// ` (at) `). Treat all three forms as an address for privacy purposes.
const OBFUSCATED_AT = /\s\((?:a|at)\)\s/i;
const RAW_AT = /@/;
const ADDRESS_LIKE = /^[^\s@]+(?:@|\s\((?:a|at)\)\s)[^\s@]+\.[^\s@]+$/i;

// The PRIVATE keyholders list id in any address-shaped form: raw
// (`keyholders@`), neutralized (`keyholders@` + the ellipsis sentinel),
// HyperKitty-obfuscated (`keyholders (a) ...` / `keyholders (at) ...`), or
// prose-spelled (`keyholders at latoolb...`). The bare word "keyholders" in
// message prose is public-safe (members legitimately discuss the keyholder
// model) and must NOT trip the privacy gates; a bare-word match made a real
// public thread render as unavailable.
const KEYHOLDERS_ADDRESS = /keyholders\s*(?:@|\((?:a|at)\))|keyholders\s+at\s+latoolb/i;

// --- Pure helpers (unit-tested; no network) ---------------------------------

/** Strip a leading list subject prefix such as "[Discuss] ". */
export function stripSubjectPrefix(subject: string): string {
	return subject.replace(/^\s*\[[^\]]*\]\s*/, '').trim() || subject.trim();
}

/** True if a string is (or embeds, via the HyperKitty obfuscation) an address. */
export function looksLikeEmail(value: string): boolean {
	return ADDRESS_LIKE.test(value.trim()) || OBFUSCATED_AT.test(value) || RAW_AT.test(value);
}

/**
 * Reduce a sender identity to a SAFE display name. A real display name passes
 * through (trimmed). If the only thing HyperKitty gives us is an address, we
 * never emit it: we fall back to the address' local part (title-cased) so the
 * UI shows something human without leaking a contactable address, and
 * "Anonymous" if even that is empty.
 */
export function safeDisplayName(raw: string | null | undefined): string {
	const value = (raw ?? '').replace(/\s+/g, ' ').trim();
	if (!value) return 'Anonymous';
	if (!looksLikeEmail(value)) return value;
	const local = value
		.split(OBFUSCATED_AT)[0]
		.split('@')[0]
		.replace(/[._-]+/g, ' ')
		.trim();
	if (!local) return 'Anonymous';
	return local
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/**
 * Turn an email body into a plain-text excerpt: drop HTML tags, quoted reply
 * lines, the signature block (everything after a `-- ` delimiter) and bracketed
 * URLs; collapse whitespace; cap at 280 chars on a word boundary with an
 * ellipsis.
 */
export function sanitizeExcerpt(raw: string | null | undefined): string {
	if (!raw) return '';
	let text = String(raw);
	text = text.replace(/<[^>]+>/g, ' '); // HTML tags and <url> angle-bracket links
	const lines = text.split(/\r?\n/);
	const kept: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^--\s*$/.test(trimmed)) break; // signature delimiter -> stop
		if (/^>/.test(trimmed)) continue; // quoted reply line
		if (/^On .*wrote:$/.test(trimmed)) continue; // attribution line
		kept.push(trimmed);
	}
	let out = kept
		.join(' ')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (out.length > EXCERPT_MAX) {
		const clipped = out.slice(0, EXCERPT_MAX - 1);
		const lastSpace = clipped.lastIndexOf(' ');
		out = `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
	}
	return out;
}

// The sentinel an inline address is reduced to: local part kept, domain elided
// to a single ellipsis so the address is unusable but the sentence still reads.
// The privacy gate treats `@…` as allowed (unlike a raw `@`).
const NEUTRALIZED_MARK = '…';
// Inline raw address, e.g. "bob@example.com".
const INLINE_RAW_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Inline HyperKitty-obfuscated address, e.g. "bob (a) example.com".
const INLINE_OBFUSCATED_ADDRESS = /([A-Za-z0-9._%+-]+)\s\((?:a|at)\)\s[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi;

/**
 * Neutralize any address that appears inline in a message body: reduce
 * `foo@bar.com` (and the obfuscated `foo (a) bar.com`) to `foo@…` so it is no
 * longer a contactable address, while leaving the surrounding prose intact. The
 * one exception is the public list address discuss@latoolb.us, which is allowed
 * to pass through verbatim (it is already public and readers may need it).
 */
export function neutralizeInlineAddresses(text: string): string {
	// Obfuscated first — collapse "local (a) domain" to "local@…" so no " (a) "
	// marker survives for the privacy gate to (correctly) hard-fail on.
	let out = text.replace(INLINE_OBFUSCATED_ADDRESS, (_match, local: string) => `${local}@${NEUTRALIZED_MARK}`);
	// Then raw addresses. The public list address is exempt; every other address
	// keeps only its local part.
	out = out.replace(INLINE_RAW_ADDRESS, (match) =>
		match.toLowerCase() === LIST_ADDRESS ? match : `${match.split('@')[0]}@${NEUTRALIZED_MARK}`,
	);
	return out;
}

/**
 * Full-body plain-text sanitizer for the on-site reader — the richer sibling of
 * `sanitizeExcerpt`. Unlike the excerpt it PRESERVES structure a reader needs:
 * paragraph breaks survive, and quoted (`>`) reply blocks are kept as structured
 * quotation LEVELS (depth = leading `>` count) rather than dropped, so reply
 * context reads. It still strips HTML tags and angle-bracket `<url>` citations,
 * cuts the signature block (everything after a `-- ` delimiter), collapses
 * hard-wrapped lines within a paragraph, and neutralizes inline addresses. The
 * output is an ordered list of `{ quoteLevel, text }` blocks the reader renders
 * with indentation + muted ink (never a side-stripe border).
 */
export function sanitizeBody(raw: string | null | undefined): DiscussMessageBlock[] {
	if (!raw) return [];
	// Drop HTML tags and angle-bracket <url> citations up front (same class the
	// excerpt strips), then work line-by-line so structure survives.
	const lines = String(raw)
		.replace(/<[^>]+>/g, ' ')
		.split(/\r?\n/);

	// First pass: strip signature, measure each line's quotation depth.
	const measured: Array<{ level: number; text: string }> = [];
	const quoteMarker = /^(\s*>\s?)/;
	for (const rawLine of lines) {
		if (/^--\s*$/.test(rawLine.trimEnd())) break; // signature delimiter -> stop
		let rest = rawLine;
		let level = 0;
		let hit: RegExpMatchArray | null;
		while ((hit = rest.match(quoteMarker))) {
			level += 1;
			rest = rest.slice(hit[0].length);
		}
		measured.push({ level, text: rest.trim() });
	}

	// Second pass: group consecutive same-level lines into paragraphs. A blank
	// line ends the current paragraph; a level change starts a new block. Wrapped
	// lines inside a paragraph rejoin with a space (mailing-list hard-wraps read
	// as prose). Addresses are neutralized once, on the assembled paragraph.
	const blocks: DiscussMessageBlock[] = [];
	let curLevel = -1;
	let buffer: string[] = [];
	const flush = () => {
		if (buffer.length) {
			const text = neutralizeInlineAddresses(buffer.join(' ').replace(/\s+/g, ' ').trim());
			if (text) blocks.push({ quoteLevel: curLevel, text });
		}
		buffer = [];
	};
	for (const line of measured) {
		if (line.text === '') {
			flush(); // blank line -> paragraph break
			continue;
		}
		if (line.level !== curLevel) {
			flush();
			curLevel = line.level;
		}
		buffer.push(line.text);
	}
	flush();
	return blocks;
}

/** Normalize any parseable timestamp to a stable ISO-8601 UTC string. */
export function toIso(value: string): string {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) throw new DiscussArchiveError(`unparseable timestamp: ${value}`);
	return d.toISOString();
}

/**
 * PRIVACY GATE. Scans the SERIALIZED snapshot for anything that must never ship:
 * the keyholders list, any raw or obfuscated address other than the allowed
 * public list address, and any other list id. Throws on any hit — the caller
 * turns that into a fixture fallback, so a leak is fail-closed, never partial.
 */
export function assertSnapshotIsPublicSafe(snapshot: DiscussSnapshot): void {
	if (snapshot.list !== LIST_ADDRESS) {
		throw new DiscussArchiveError(`snapshot.list must be ${LIST_ADDRESS}, got ${snapshot.list}`);
	}
	const serialized = JSON.stringify(snapshot);

	if (KEYHOLDERS_ADDRESS.test(serialized)) {
		throw new DiscussArchiveError('private keyholders list address present in snapshot');
	}
	if (OBFUSCATED_AT.test(serialized)) {
		throw new DiscussArchiveError('obfuscated email address ("(a)"/"(at)") present in snapshot');
	}
	// Remove every allowed occurrence of the public list address, then no "@"
	// may remain anywhere in the payload.
	const withoutListAddress = serialized.split(LIST_ADDRESS).join('');
	if (RAW_AT.test(withoutListAddress)) {
		throw new DiscussArchiveError('a raw email address other than the public list address is present in snapshot');
	}
	// Any @latoolb.us local-part other than the list must have been caught above;
	// belt-and-braces guard against a differently-cased list id leaking through.
	if (/@latoolb\.us/i.test(withoutListAddress)) {
		throw new DiscussArchiveError('a non-public @latoolb.us address is present in snapshot');
	}
	for (const thread of snapshot.threads) {
		if (!thread.url.startsWith(`${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/thread/`)) {
			throw new DiscussArchiveError(`thread url not anchored to the public discuss archive: ${thread.url}`);
		}
		if ((thread.excerpt?.length ?? 0) > EXCERPT_MAX) {
			throw new DiscussArchiveError(`excerpt exceeds ${EXCERPT_MAX} chars`);
		}
	}
}

/** Validate the structural contract before the payload is trusted. */
export function assertValidSnapshotShape(snapshot: DiscussSnapshot): void {
	const isIso = (s: string) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /\dT\d/.test(s);
	if (!isIso(snapshot.generatedAt)) throw new DiscussArchiveError('generatedAt is not ISO-8601');
	if (snapshot.archiveUrl !== PUBLIC_ARCHIVE_URL) throw new DiscussArchiveError('archiveUrl mismatch');
	if (snapshot.threadCount !== snapshot.threads.length) throw new DiscussArchiveError('threadCount != threads.length');
	if (snapshot.threads.length > MAX_THREADS) throw new DiscussArchiveError(`threads exceed cap ${MAX_THREADS}`);
	for (const t of snapshot.threads) {
		for (const [k, v] of Object.entries({ threadId: t.threadId, subject: t.subject, starterName: t.starterName })) {
			if (typeof v !== 'string' || v.length === 0) throw new DiscussArchiveError(`thread.${k} empty`);
		}
		if (!isIso(t.startedAt) || !isIso(t.lastActiveAt)) throw new DiscussArchiveError('thread timestamps not ISO-8601');
		if (!Number.isInteger(t.repliesCount) || t.repliesCount < 0) throw new DiscussArchiveError('repliesCount invalid');
		if (!Number.isInteger(t.participantsCount) || t.participantsCount < 0) {
			throw new DiscussArchiveError('participantsCount invalid');
		}
	}
}

/**
 * PRIVACY GATE for the thread reader — the DiscussThreadDetail sibling of
 * `assertSnapshotIsPublicSafe`. Scans the SERIALIZED detail and throws (which
 * the reader's load turns into a calm unavailable state) on: any keyholders
 * ADDRESS trace (never the bare word in prose; members legitimately discuss
 * the keyholder model), any surviving obfuscated address, any raw `@` other
 * than the public list address, or any non-public `@latoolb.us`. The only `@`
 * allowed besides the list address is the `@…` sentinel a neutralized inline
 * address leaves.
 */
export function assertThreadDetailIsPublicSafe(detail: DiscussThreadDetail): void {
	const serialized = JSON.stringify(detail);
	if (KEYHOLDERS_ADDRESS.test(serialized)) {
		throw new DiscussArchiveError('private keyholders list address present in thread detail');
	}
	if (OBFUSCATED_AT.test(serialized)) {
		throw new DiscussArchiveError('obfuscated email address ("(a)"/"(at)") present in thread detail');
	}
	// Remove the allowed public list address and the neutralized `@…` sentinels,
	// then no raw "@" may remain anywhere in the payload.
	const residual = serialized.split(LIST_ADDRESS).join('').split(`@${NEUTRALIZED_MARK}`).join('');
	if (RAW_AT.test(residual)) {
		throw new DiscussArchiveError('a raw email address other than the public list address is present in thread detail');
	}
	if (/@latoolb\.us/i.test(residual)) {
		throw new DiscussArchiveError('a non-public @latoolb.us address is present in thread detail');
	}
}

/** Validate the structural contract of a thread detail before it is trusted. */
export function assertValidThreadDetailShape(detail: DiscussThreadDetail): void {
	const isIso = (s: string) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /\dT\d/.test(s);
	for (const [k, v] of Object.entries({ threadId: detail.threadId, subject: detail.subject })) {
		if (typeof v !== 'string' || v.length === 0) throw new DiscussArchiveError(`thread detail ${k} empty`);
	}
	if (!isIso(detail.startedAt) || !isIso(detail.lastActiveAt)) {
		throw new DiscussArchiveError('thread detail timestamps not ISO-8601');
	}
	if (!Number.isInteger(detail.participantsCount) || detail.participantsCount < 0) {
		throw new DiscussArchiveError('participantsCount invalid');
	}
	if (!Array.isArray(detail.messages) || detail.messages.length === 0) {
		throw new DiscussArchiveError('thread detail has no messages');
	}
	for (const msg of detail.messages) {
		if (typeof msg.id !== 'string' || msg.id.length === 0) throw new DiscussArchiveError('message id empty');
		if (typeof msg.senderName !== 'string' || msg.senderName.length === 0) {
			throw new DiscussArchiveError('message senderName empty');
		}
		if (!isIso(msg.sentAt)) throw new DiscussArchiveError('message sentAt not ISO-8601');
		if (!Array.isArray(msg.body)) throw new DiscussArchiveError('message body not an array');
		for (const block of msg.body) {
			if (!Number.isInteger(block.quoteLevel) || block.quoteLevel < 0) {
				throw new DiscussArchiveError('block quoteLevel invalid');
			}
			if (typeof block.text !== 'string') throw new DiscussArchiveError('block text not a string');
		}
	}
}

// --- HyperKitty response shapes (only the fields we read) -------------------

type HkThreadListItem = {
	thread_id: string;
	subject: string;
	date_active: string;
	replies_count: number;
	starting_email: string;
};

type HkThreadDetail = {
	thread_id: string;
	subject: string;
	date_active: string;
	replies_count: number;
	participants_count: number;
	starting_email: string;
};

type HkEmail = {
	sender_name?: string | null;
	date: string;
	content?: string | null;
};

// A thread's `emails/` sub-resource lists each message WITHOUT its body (verified
// live: 1.3.12 returns a bare array whose items carry `message_id_hash`/`date`/
// `sender_name` but no `content`), so bodies are read per-message from the email
// detail endpoint below.
type HkThreadEmailItem = {
	url: string;
	message_id_hash: string;
	sender_name?: string | null;
	date: string;
};

// The email DETAIL endpoint (`/email/<hash>/`) adds the `content` body.
type HkEmailDetail = {
	message_id_hash: string;
	sender_name?: string | null;
	date: string;
	content?: string | null;
};

/** DRF may return a bare array or a `{ results: [] }` envelope; accept both. */
function unwrapList<T>(body: unknown): T[] {
	if (Array.isArray(body)) return body as T[];
	if (body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)) {
		return (body as { results: T[] }).results;
	}
	throw new DiscussArchiveError('unexpected HyperKitty list response shape');
}

/** Last non-empty path segment of an id-bearing HyperKitty URL. */
export function idFromUrl(url: string): string {
	const path = url.split('?')[0].replace(/\/+$/, '');
	const id = path.slice(path.lastIndexOf('/') + 1);
	if (!id) throw new DiscussArchiveError(`could not extract id from url: ${url}`);
	return id;
}

/** Build the single canonical thread object from the three HyperKitty reads. */
export function mapThread(detail: HkThreadDetail, starter: HkEmail): DiscussThread {
	const threadId = detail.thread_id;
	return {
		threadId,
		subject: stripSubjectPrefix(detail.subject),
		startedAt: toIso(starter.date),
		lastActiveAt: toIso(detail.date_active),
		repliesCount: Math.max(0, Number(detail.replies_count) || 0),
		participantsCount: Math.max(0, Number(detail.participants_count) || 0),
		starterName: safeDisplayName(starter.sender_name),
		url: `${PUBLIC_ARCHIVE_BASE}/list/${LIST_ADDRESS}/thread/${threadId}/`,
		excerpt: sanitizeExcerpt(starter.content),
	};
}

/**
 * Build the canonical thread-reader payload from the thread detail plus the full
 * (content-bearing) email reads. Messages are ordered oldest-first (the natural
 * reading order) sorting on `date` — we never trust the API's native ordering.
 * `startedAt` is the earliest message; `lastActiveAt` is the thread's
 * `date_active`. Every sender name goes through `safeDisplayName` (HyperKitty
 * hands us raw addresses in `sender_name` — verified live) and every body through
 * `sanitizeBody`; the result is shape- and privacy-validated before it is
 * trusted, so a leak or a malformed payload throws rather than shipping.
 */
export function mapThreadDetail(detail: HkThreadDetail, emails: HkEmailDetail[]): DiscussThreadDetail {
	const messages: DiscussThreadMessage[] = emails
		.map((email) => ({
			id: email.message_id_hash,
			senderName: safeDisplayName(email.sender_name),
			sentAt: toIso(email.date),
			body: sanitizeBody(email.content),
		}))
		.sort((a, b) => {
			const delta = Date.parse(a.sentAt) - Date.parse(b.sentAt);
			return delta !== 0 ? delta : a.id.localeCompare(b.id);
		});
	if (messages.length === 0) throw new DiscussArchiveError('thread has no messages');

	const threadDetail: DiscussThreadDetail = {
		threadId: detail.thread_id,
		subject: stripSubjectPrefix(detail.subject),
		startedAt: messages[0].sentAt,
		lastActiveAt: detail.date_active ? toIso(detail.date_active) : messages[messages.length - 1].sentAt,
		participantsCount: Math.max(0, Number(detail.participants_count) || 0),
		messages,
	};
	assertValidThreadDetailShape(threadDetail);
	assertThreadDetailIsPublicSafe(threadDetail);
	return threadDetail;
}

/** Deterministic ordering: most-recently-active first, ties broken by id. */
export function sortThreads(threads: DiscussThread[]): DiscussThread[] {
	return [...threads].sort((a, b) => {
		const delta = Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
		return delta !== 0 ? delta : a.threadId.localeCompare(b.threadId);
	});
}

/** Assemble + validate a snapshot from mapped threads (no network). */
export function buildSnapshot(threads: DiscussThread[], generatedAt: string): DiscussSnapshot {
	const ordered = sortThreads(threads).slice(0, MAX_THREADS);
	const snapshot: DiscussSnapshot = {
		generatedAt,
		list: LIST_ADDRESS,
		archiveUrl: PUBLIC_ARCHIVE_URL,
		threadCount: ordered.length,
		threads: ordered,
	};
	assertValidSnapshotShape(snapshot);
	assertSnapshotIsPublicSafe(snapshot);
	return snapshot;
}

// --- Network orchestration --------------------------------------------------

function emptySnapshot(generatedAt: string): DiscussSnapshot {
	return { generatedAt, list: LIST_ADDRESS, archiveUrl: PUBLIC_ARCHIVE_URL, threadCount: 0, threads: [] };
}

function resolveOrigin(explicit?: string): string {
	const fromEnv = typeof process !== 'undefined' ? process.env?.DISCUSS_ARCHIVE_ORIGIN : undefined;
	return (explicit ?? fromEnv ?? DEFAULT_INCLUSTER_ORIGIN).replace(/\/+$/, '');
}

/**
 * Django's HyperKitty rejects a request whose Host header is not in its
 * ALLOWED_HOSTS with a bare HTTP 400. Verified live (2026-07):
 *   ALLOWED_HOSTS = ['localhost', 'mailman-web', 'lists.latoolb.us',
 *                    '10.245.116.58', '127.0.0.1']
 * That list carries the SHORT service name `mailman-web` but NOT the full
 * in-cluster Service FQDN `mailman-web.latoolb-us-production.svc.cluster.local`
 * that DNS forces us to dial from the builder — so the default in-cluster read
 * 400s (Host=svc-FQDN → 400, Host=mailman-web → 200), silently degrading every
 * build to the empty fallback. When (and only when) the origin is a
 * `*.svc.cluster.local` address we therefore send its first DNS label as an
 * explicit Host header (undici allows overriding it). An overridden
 * DISCUSS_ARCHIVE_ORIGIN (a localhost port-forward, `lists.latoolb.us`, an IP)
 * is left alone — its own host is already allow-listed.
 */
export function clusterHostHeader(origin: string): string | undefined {
	let hostname: string;
	try {
		hostname = new URL(origin).hostname;
	} catch {
		return undefined;
	}
	if (!hostname.endsWith('.svc.cluster.local')) return undefined;
	return hostname.split('.')[0] || undefined;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, timeoutMs: number, hostHeader?: string): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(url, {
			signal: controller.signal,
			headers: { Accept: 'application/json', ...(hostHeader ? { host: hostHeader } : {}) },
		});
		if (!res.ok) throw new DiscussArchiveError(`HTTP ${res.status} for ${url}`);
		return (await res.json()) as T;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Fetch, map, sanitize and validate the live discuss@ snapshot. NEVER throws:
 * on any transport, shape, or privacy failure it logs a loud warning and returns
 * `options.fallback` (the route's committed fixture) or a valid empty snapshot.
 */
export async function fetchDiscussSnapshot(options: FetchDiscussSnapshotOptions = {}): Promise<DiscussSnapshot> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const now = options.now ?? (() => new Date());
	const generatedAt = now().toISOString();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fallback = options.fallback ?? emptySnapshot(generatedAt);

	if (typeof fetchImpl !== 'function') {
		console.warn('[discuss-archive] no fetch available; serving fixture fallback');
		return fallback;
	}

	const origin = resolveOrigin(options.origin);
	const apiBase = `${origin}${HYPERKITTY_PREFIX}/api/list/${LIST_ADDRESS}`;
	const hostHeader = clusterHostHeader(origin);

	try {
		const listBody = await getJson<unknown>(fetchImpl, `${apiBase}/threads/?format=json`, timeoutMs, hostHeader);
		const items = unwrapList<HkThreadListItem>(listBody);

		// Sort + cap on the cheap list payload BEFORE hydrating, so we only make
		// detail/starter reads for the threads we keep.
		const capped = [...items]
			.sort((a, b) => {
				const delta = Date.parse(b.date_active) - Date.parse(a.date_active);
				return delta !== 0 ? delta : a.thread_id.localeCompare(b.thread_id);
			})
			.slice(0, MAX_THREADS);

		const threads: DiscussThread[] = [];
		for (const item of capped) {
			const detail = await getJson<HkThreadDetail>(
				fetchImpl,
				`${apiBase}/thread/${encodeURIComponent(item.thread_id)}/?format=json`,
				timeoutMs,
				hostHeader,
			);
			const starterId = idFromUrl(item.starting_email);
			const starter = await getJson<HkEmail>(
				fetchImpl,
				`${apiBase}/email/${encodeURIComponent(starterId)}/?format=json`,
				timeoutMs,
				hostHeader,
			);
			threads.push(mapThread(detail, starter));
		}

		const snapshot = buildSnapshot(threads, generatedAt);
		console.info(`[discuss-archive] built snapshot from ${origin}: ${snapshot.threadCount} thread(s)`);
		return snapshot;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`[discuss-archive] live fetch from ${origin} failed (${reason}); serving empty-state fallback. ` +
				'This is expected off-cluster (local dev / fork CI).',
		);
		return fallback;
	}
}

export type FetchDiscussThreadOptions = {
	/** HyperKitty origin. Defaults to the in-cluster Service DNS; override via the
	 *  DISCUSS_ARCHIVE_ORIGIN env var (see the reader load) or explicitly in tests. */
	origin?: string;
	/** Injected fetch (tests / non-global-fetch runtimes). Defaults to globalThis.fetch. */
	fetch?: typeof fetch;
	/** Per-request timeout in ms. Defaults to 8000. */
	timeoutMs?: number;
};

/**
 * Fetch, map, sanitize and privacy-gate ONE thread for the on-site reader. It
 * reads the thread detail, its `emails/` sub-resource (the ordered message list),
 * and each message's body from the email-detail endpoint, all scoped to the
 * public discuss@ list, all carrying the in-cluster Host header (see
 * `clusterHostHeader`) so the build-time read is not 400'd.
 *
 * Unlike `fetchDiscussSnapshot`, this THROWS (DiscussArchiveError) on ANY
 * transport, shape, or privacy failure — the reader's `+page.server.ts` catches
 * it and renders a calm "not available right now" state rather than a hard 500 or
 * invented content. A build off-cluster never reaches here for a real page: the
 * route's `entries` generator yields no entries when the snapshot comes back
 * empty, so no thread pages are prerendered.
 */
export async function fetchDiscussThread(
	threadId: string,
	options: FetchDiscussThreadOptions = {},
): Promise<DiscussThreadDetail> {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (typeof fetchImpl !== 'function') throw new DiscussArchiveError('no fetch available for thread read');

	const id = String(threadId ?? '').trim();
	if (!id) throw new DiscussArchiveError('empty thread id');

	const origin = resolveOrigin(options.origin);
	const apiBase = `${origin}${HYPERKITTY_PREFIX}/api/list/${LIST_ADDRESS}`;
	const hostHeader = clusterHostHeader(origin);
	const encoded = encodeURIComponent(id);

	const detail = await getJson<HkThreadDetail>(
		fetchImpl,
		`${apiBase}/thread/${encoded}/?format=json`,
		timeoutMs,
		hostHeader,
	);
	const emailsBody = await getJson<unknown>(
		fetchImpl,
		`${apiBase}/thread/${encoded}/emails/?format=json`,
		timeoutMs,
		hostHeader,
	);
	const items = unwrapList<HkThreadEmailItem>(emailsBody);

	const emails: HkEmailDetail[] = [];
	for (const item of items) {
		const hash = item.message_id_hash || idFromUrl(item.url);
		emails.push(
			await getJson<HkEmailDetail>(
				fetchImpl,
				`${apiBase}/email/${encodeURIComponent(hash)}/?format=json`,
				timeoutMs,
				hostHeader,
			),
		);
	}

	return mapThreadDetail(detail, emails);
}
