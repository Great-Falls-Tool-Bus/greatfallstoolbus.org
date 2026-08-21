// Frontmatter contract for the .svx draft-staging tree at
// src/content/discuss-drafts/**. Shared by the generator
// (scripts/discuss-to-svx.mjs) and its standalone validator
// (scripts/validate-discuss-drafts.mts) so the schema can never drift
// between the two — the same pattern src/lib/data/tool-schema.ts uses for
// src/content/tools/**.
//
// WHAT THIS TREE IS: a git-tracked staging ground for the "keyholders@ ->
// discuss@" repost pipeline (Lane B). Every file here is `published: false`
// until an OPERATOR has manually sent the body to discuss@latoolb.us from
// their own mail client and the post has landed in the public HyperKitty
// archive. Nothing under this directory is read by any route, glob import,
// or build-time content loader — see $lib/data/cells.ts for the one glob
// this repo actually wires to a live page (scoped to content/tools/**only).
// A draft file existing here has NO effect on the deployed site.
//
// RECONCILIATION (future step, not implemented by this schema or the
// generator): once a draft's body has actually been posted, a human (or a
// follow-up PR) flips `published: true` and adds the real `archiveUrl` — the
// public HyperKitty deep link the post landed at. The schema's own filter
// below enforces that pairing so a draft can never claim `published: true`
// without a real destination.
import { Schema } from 'effect';

/** The one legal source for a draft: the private keyholders@ archive. */
export const SOURCE_LIST = 'keyholders@latoolb.us';
/** The one legal destination for a draft: the public discuss@ archive. */
export const TARGET_LIST = 'discuss@latoolb.us';

const IsoTimestamp = Schema.NonEmptyString.pipe(
	Schema.filter((s) => !Number.isNaN(Date.parse(s)) || 'must be a parseable ISO-8601 timestamp'),
);

export const DiscussDraftFrontmatter = Schema.Struct({
	/** The subject the operator should use when they post this to discuss@. */
	subject: Schema.NonEmptyString,
	/** Always the private archive — the only list this pipeline reads from. */
	sourceList: Schema.Literal(SOURCE_LIST),
	/**
	 * Opaque provenance identifier for the source message (e.g. a HyperKitty
	 * internal email id or message-id hash). Never a sender address — the
	 * generator and validator both gate on that separately
	 * ($lib/naming-consent.ts assertNoBareEmailAddress).
	 */
	sourceMessageId: Schema.NonEmptyString,
	/** ISO-8601 timestamp the original message was sent, UTC. */
	sourceDate: IsoTimestamp,
	/** Always the public archive — the only list a draft may ever be posted to. */
	targetList: Schema.Literal(TARGET_LIST),
	/** False until an operator has actually posted the body to discuss@. */
	published: Schema.Boolean,
	/** ISO-8601 timestamp this draft was staged (not when it was sent). */
	preparedAt: IsoTimestamp,
	/**
	 * Must be true: asserts the body carries the operator's redaction
	 * proposal VERBATIM (the generator never redacts on its own behalf).
	 */
	redactionsApplied: Schema.Literal(true),
	/**
	 * Must be true: asserts $lib/naming-consent.ts's gates ran clean against
	 * this draft's subject and body before it was staged.
	 */
	consentVerified: Schema.Literal(true),
	/**
	 * The public HyperKitty deep link the post landed at, filled in only
	 * during reconciliation. Required once `published` flips to true.
	 */
	archiveUrl: Schema.optional(
		Schema.NonEmptyString.pipe(
			Schema.filter(
				(url) =>
					url.startsWith(`https://lists.latoolb.us/hyperkitty/list/${TARGET_LIST}/thread/`) ||
					`archiveUrl must be a public ${TARGET_LIST} thread deep link`,
			),
		),
	),
}).pipe(
	Schema.filter(
		(fm) => fm.published === false || fm.archiveUrl !== undefined || 'archiveUrl is required once published is true',
	),
);

export type DiscussDraftFrontmatter = Schema.Schema.Type<typeof DiscussDraftFrontmatter>;
