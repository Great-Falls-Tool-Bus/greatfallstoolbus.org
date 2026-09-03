// On-site archive snapshot contract for the public `discuss@latoolb.us`
// community board. The /discuss route renders an INDEX + excerpts of recent
// threads; /discuss/[thread] renders one full conversation on-site. Revived
// (ruling D15) from the pre-single-product-history tree and re-derived against
// the merged lifecycle spec, which is the privacy/authority SSOT:
// docs/spec/discuss-board-lifecycle-2026-09-01.md.
//
// Spec bindings this contract carries:
//   - "Read the discuss archive | Anyone, anonymously" (spec read/write matrix,
//     ADR 0019 §2.2): the board is a public read surface; nothing here gates a
//     reader, and nothing here may ever surface the private keyholders list
//     (spec §Public-nav gate: leak-scan rule `private-list-archive`).
//   - Excerpts are short plain text (<=280 chars, enforced by the server data
//     plane's privacy gate in $lib/server/discuss-archive), never full bodies.
//   - Deep links go to the public HyperKitty thread/list pages on
//     lists.latoolb.us — the platform never embeds Mailman/Anubis surfaces.
//
// DATA SOURCE: served by SERVER loads (`src/routes/discuss/**/+page.server.ts`)
// backed by $lib/server/discuss-archive. There is no committed fixture content:
// when the archive is unreachable the loads serve an honest EMPTY snapshot
// (spec posture: never invented content), and the UI renders its calm empty
// state.

/** One archived thread — index metadata + a short excerpt, never the body. */
export interface DiscussThread {
	/** Stable HyperKitty thread id (the message-id hash in the deep link). */
	threadId: string;
	/** Thread subject. May be long; the UI breaks words rather than truncating. */
	subject: string;
	/** ISO 8601 timestamp the thread was started. */
	startedAt: string;
	/** ISO 8601 timestamp of the most recent activity. Threads sort on this desc. */
	lastActiveAt: string;
	/** Reply count (excludes the opening message). */
	repliesCount: number;
	/** Distinct participant count. */
	participantsCount: number;
	/** Display name of the thread starter — a name only, never an address. */
	starterName: string;
	/** Deep link into the thread on the public HyperKitty archive (leaves the site). */
	url: string;
	/** Plain-text excerpt, <=280 chars. Optional; the UI omits the line if absent. */
	excerpt?: string;
}

/** The archive snapshot the /discuss index renders from. */
export interface DiscussSnapshot {
	/** ISO 8601 timestamp the snapshot was generated (drives the freshness line). */
	generatedAt: string;
	/** The list address, e.g. `discuss@latoolb.us`. */
	list: string;
	/** Root archive URL — the single "browse the full archive" link. */
	archiveUrl: string;
	/** Total threads represented (may exceed `threads.length` if the index is capped). */
	threadCount: number;
	/** The indexed threads. Rendered sorted by `lastActiveAt` desc. */
	threads: DiscussThread[];
}

// --- On-site thread reader contract ------------------------------------------
// The /discuss index renders excerpts (DiscussThread above); the
// /discuss/[thread] reader renders the FULL conversation on-site so a reader is
// never dumped into unstyled HyperKitty/Postorius. The server data plane
// ($lib/server/discuss-archive) fetches, sanitizes and privacy-gates a thread
// into this exact shape; the reader page renders it and never sees a raw
// address.

/** One quotation-aware paragraph of a message body. */
export interface DiscussMessageBlock {
	/** 0 = the sender's own prose; 1+ = nested reply-quotation depth. The reader
	 *  renders depth via indentation + muted ink — never a side-stripe border. */
	quoteLevel: number;
	/** Sanitized plain-text paragraph: HTML/signature stripped, inline addresses
	 *  neutralized (`foo@bar.com` → `foo@…`), the public list address exempt. */
	text: string;
}

/** One message inside a thread — a sanitized, privacy-safe rendering unit. */
export interface DiscussThreadMessage {
	/** Stable HyperKitty message-id hash. */
	id: string;
	/** Display name of the sender — a name only, never an address. */
	senderName: string;
	/** ISO 8601 timestamp the message was sent. */
	sentAt: string;
	/** Body as ordered, quotation-aware paragraphs. Empty for a body-less message. */
	body: DiscussMessageBlock[];
}

/** A single thread rendered in full on-site — the reader-page contract. */
export interface DiscussThreadDetail {
	/** Stable HyperKitty thread id (matches DiscussThread.threadId). */
	threadId: string;
	/** Thread subject, list prefix stripped. */
	subject: string;
	/** ISO 8601 timestamp of the first message. */
	startedAt: string;
	/** ISO 8601 timestamp of the most recent message. */
	lastActiveAt: string;
	/** Distinct participant count. */
	participantsCount: number;
	/** Messages in chronological (oldest-first) reading order. */
	messages: DiscussThreadMessage[];
}

/** Threads sorted newest-activity-first (most recent `lastActiveAt` on top). */
export const sortByLastActiveDesc = (threads: DiscussThread[]): DiscussThread[] =>
	[...threads].sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

// Cutoffs for the largest whole unit that still reads naturally, paired with
// the seconds each unit spans. Walked coarse→fine so "3 hours ago" wins over
// "180 minutes ago".
const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
	{ unit: 'year', seconds: 60 * 60 * 24 * 365 },
	{ unit: 'month', seconds: 60 * 60 * 24 * 30 },
	{ unit: 'week', seconds: 60 * 60 * 24 * 7 },
	{ unit: 'day', seconds: 60 * 60 * 24 },
	{ unit: 'hour', seconds: 60 * 60 },
	{ unit: 'minute', seconds: 60 },
	{ unit: 'second', seconds: 1 },
];

/**
 * Human relative time via `Intl.RelativeTimeFormat` — no new deps. Returns e.g.
 * "3 hours ago" / "yesterday" / "in 2 days". Falls back to an empty string for
 * an unparseable timestamp so the caller can hide the affordance.
 */
export const relativeTime = (iso: string, now: Date = new Date()): string => {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return '';
	const deltaSeconds = Math.round((then - now.getTime()) / 1000);
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	for (const { unit, seconds } of RELATIVE_UNITS) {
		if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
			return rtf.format(Math.round(deltaSeconds / seconds), unit);
		}
	}
	return '';
};

/**
 * Full, locale-formatted timestamp for the `title`/`datetime` of the freshness
 * line — the precise value behind the quiet relative label. Empty string when
 * unparseable.
 */
export const formatTimestamp = (iso: string): string => {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date);
};

/**
 * One readable meta line per thread — starter, reply/participant counts, and
 * relative last activity — as a single plain string. Kept as one string (not a
 * row of inline elements) so the template stays whitespace-unambiguous, and
 * pluralized honestly for the 1-vs-many cases.
 */
export const threadMeta = (thread: DiscussThread, now: Date = new Date()): string => {
	const replies = `${thread.repliesCount} ${thread.repliesCount === 1 ? 'reply' : 'replies'}`;
	const people = `${thread.participantsCount} ${thread.participantsCount === 1 ? 'participant' : 'participants'}`;
	return `Started by ${thread.starterName} · ${replies} · ${people} · active ${relativeTime(thread.lastActiveAt, now)}`;
};
