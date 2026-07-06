// On-site archive snapshot contract for the public `discuss@latoolb.us`
// community board (TIN-2528). The /discuss route renders an INDEX + excerpts of
// recent threads; full message bodies stay behind the Anubis-gated HyperKitty,
// reachable only by deep-linking out to each thread `url`.
//
// DATA SOURCE: the shape below is served through a SvelteKit universal load
// (`src/routes/discuss/+page.ts`), NOT a runtime DB. Today the load returns the
// hand-authored `discussFixtureSnapshot` inline; a parallel data-plane
// workstream swaps that one function body for a build-time / in-cluster SSR
// fetch from HyperKitty (adapter-node post-cutover) that returns this exact
// `DiscussSnapshot` shape. The UI never changes when that swap lands.

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
	/** Deep link into the thread on HyperKitty (leaves the site). */
	url: string;
	/** Plain-text excerpt, <=280 chars. Optional; the UI omits the line if absent. */
	excerpt?: string;
}

/** The committed archive snapshot the /discuss index renders from. */
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
	/** True on hand-authored fixture data. The UI ignores this field entirely. */
	fixture?: boolean;
}

// --- On-site thread reader contract (TIN-2528) ------------------------------
// The /discuss index renders excerpts (DiscussThread above); the /discuss/[thread]
// reader renders the FULL conversation on-site so a reader is never dumped into
// unstyled HyperKitty/Postorius. The server data plane
// ($lib/server/discuss-archive) fetches, sanitizes and privacy-gates a thread
// into this exact shape; the reader page renders it and never sees a raw address.

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

/**
 * FIXTURE snapshot — hand-authored, plausible community-tool-library threads so
 * the /discuss index ships working before the data plane lands. `fixture: true`
 * marks it; the UI ignores that field. One thread deliberately omits `excerpt`
 * and one carries a long subject, so the render path exercises both tolerances.
 * Authored in mixed order on purpose — `sortByLastActiveDesc` does the work.
 */
export const discussFixtureSnapshot: DiscussSnapshot = {
	generatedAt: '2026-07-05T14:20:00Z',
	list: 'discuss@latoolb.us',
	archiveUrl: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/',
	threadCount: 6,
	fixture: true,
	threads: [
		{
			threadId: 'QK7X2ABLMN4RS6TUVWXYZ234ABCDEF56',
			subject: 'Repair clinic this Saturday — bring broken small engines and we will diagnose them together',
			startedAt: '2026-06-28T13:00:00Z',
			lastActiveAt: '2026-07-04T18:05:00Z',
			repliesCount: 12,
			participantsCount: 7,
			starterName: 'Marcus Bellwether',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/QK7X2ABLMN4RS6TUVWXYZ234ABCDEF56/',
			excerpt:
				'Bring your dead lawnmowers, string trimmers, and generators. We will have carb-cleaning kits and a couple of folks who know two-strokes. No charge — just show up with the machine and the model number.',
		},
		{
			threadId: 'B3D9F1HJKLMN2PQRSTUV4WXYZ56789AB',
			subject: 'Intake question: is a 1970s Craftsman 113-series table saw worth restoring for the woodworking cell?',
			startedAt: '2026-06-30T16:45:00Z',
			lastActiveAt: '2026-07-05T09:12:00Z',
			repliesCount: 8,
			participantsCount: 5,
			starterName: 'Dana Okafor',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/B3D9F1HJKLMN2PQRSTUV4WXYZ56789AB/',
			excerpt:
				'Found one on the curb — cast-iron top, a little surface rust, motor runs. The 113 series has good parts support. Worth kitting for the bus, or is the fence too far gone to trust?',
		},
		{
			threadId: 'C4E0G2IKLMO3QRSUVWX5YZ6789ABCDEF',
			subject: 'Sewing cell meetup — Thursday 6pm at the Lewiston Public Library, all skill levels welcome',
			startedAt: '2026-06-25T19:30:00Z',
			lastActiveAt: '2026-07-02T20:40:00Z',
			repliesCount: 5,
			participantsCount: 6,
			starterName: 'Priya Chandrasekaran',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/C4E0G2IKLMO3QRSUVWX5YZ6789ABCDEF/',
			excerpt:
				'We will have the two Singer 4423 machines out plus the serger. Bring a mending project or just come learn to thread a bobbin. Kids welcome if an adult is with them.',
		},
		{
			threadId: 'D5F1H3JLMNP4RSTVWXY6Z789ABCDEFGH',
			subject: 'Anyone have a spare CAT6 crimper? Setting up the network cell patch-cable bench',
			startedAt: '2026-07-01T11:00:00Z',
			lastActiveAt: '2026-07-03T11:30:00Z',
			repliesCount: 3,
			participantsCount: 3,
			starterName: 'Theo Nakamura',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/D5F1H3JLMNP4RSTVWXY6Z789ABCDEFGH/',
			excerpt:
				'Building out a little bench so people can make their own patch cables. Have a spool of Cat6 and keystones; still short a ratcheting crimper and a cable tester. A loaner would be great.',
		},
		{
			threadId: 'E6G2I4KMNOQ5STUWXYZ7A89BCDEFGHIJ',
			subject: 'Welding cell: safety-orientation slots open for July — sign up before you book the MIG',
			startedAt: '2026-06-20T14:15:00Z',
			lastActiveAt: '2026-07-01T15:00:00Z',
			repliesCount: 9,
			participantsCount: 8,
			starterName: 'Rosa Delgado',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/E6G2I4KMNOQ5STUWXYZ7A89BCDEFGHIJ/',
		},
		{
			threadId: 'F7H3J5LNOPR6TUVXYZA8B9CDEFGHIJKL',
			subject: 'Donated: a whole box of assorted wooden hand planes — help me ID them?',
			startedAt: '2026-07-02T17:50:00Z',
			lastActiveAt: '2026-07-02T22:15:00Z',
			repliesCount: 4,
			participantsCount: 4,
			starterName: 'Sam Whitfield',
			url: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/thread/F7H3J5LNOPR6TUVXYZA8B9CDEFGHIJKL/',
			excerpt:
				'A neighbor cleaning out a barn dropped off maybe a dozen wooden-body planes. A few have makers marks I cannot read. Photos attached — anyone good at dating these before we log them?',
		},
	],
};
