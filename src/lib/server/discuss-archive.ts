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
import type { DiscussSnapshot, DiscussThread } from '$lib/data/discuss-snapshot';
export type { DiscussSnapshot, DiscussThread };

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

	if (/keyholders/i.test(serialized)) {
		throw new DiscussArchiveError('forbidden token "keyholders" present in snapshot');
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

async function getJson<T>(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(url, {
			signal: controller.signal,
			headers: { Accept: 'application/json' },
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

	try {
		const listBody = await getJson<unknown>(fetchImpl, `${apiBase}/threads/?format=json`, timeoutMs);
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
			);
			const starterId = idFromUrl(item.starting_email);
			const starter = await getJson<HkEmail>(
				fetchImpl,
				`${apiBase}/email/${encodeURIComponent(starterId)}/?format=json`,
				timeoutMs,
			);
			threads.push(mapThread(detail, starter));
		}

		const snapshot = buildSnapshot(threads, generatedAt);
		console.info(`[discuss-archive] built snapshot from ${origin}: ${snapshot.threadCount} thread(s)`);
		return snapshot;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`[discuss-archive] live fetch from ${origin} failed (${reason}); serving fixture fallback. ` +
				'This is expected off-cluster (local dev / fork CI).',
		);
		return fallback;
	}
}
