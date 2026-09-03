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
// RECONCILIATION (scripts/discuss-reconcile.mts, `just discuss-reconcile`):
// once a draft's body has actually been posted by the operator, that tool
// flips `published: true`, injects the real `archiveUrl` — the public
// HyperKitty deep link the post landed at — and removes the pending-notice
// comment. The schema's own filter below enforces the pairing so a draft can
// never claim `published: true` without a real destination.
//
// NO `redactionsApplied` / `consentVerified` FRONTMATTER KEY, DELIBERATELY.
// An earlier version of this schema pinned both to a schema-enforced
// `Schema.Literal(true)`, and the generator wrote both unconditionally on
// every draft regardless of what the input actually contained — an
// unconditional `true` verifies nothing and reads as a machine-checked
// guarantee it isn't. Editorial redaction is a human judgment call made
// entirely outside this pipeline (see scripts/discuss-to-svx.mjs's header
// and docs/runbooks/discuss-to-svx-pipeline.md step 2: "This pipeline does
// not redact anything"). What this pipeline DOES mechanically verify — the
// naming-consent hash gate and the bare-email/bare-phone checks — runs as a
// hard failure in `buildDraft()` (generation time) and again in
// `validate-discuss-drafts.mts` (CI time); a draft that exists in this tree
// has already passed those. That is a real but narrow guarantee, not the
// same claim as "this content is fully redacted" or "consent is verified"
// — so no frontmatter field asserts either. Verifying full redaction stays
// a manual operator review, before `published` ever flips to `true`.
import { Schema } from 'effect';

/** The one legal source for a draft: the private keyholders@ archive. */
export const SOURCE_LIST = 'keyholders@latoolb.us';
/** The one legal destination for a draft: the public discuss@ archive. */
export const TARGET_LIST = 'discuss@latoolb.us';
/**
 * The one legal `archiveUrl` prefix: a public discuss@ thread deep link, the
 * same anonymous-200 read-path family the lifecycle spec's public-nav gate
 * probed (docs/spec/discuss-board-lifecycle-2026-09-01.md). Exported so the
 * reconcile tool (scripts/discuss-reconcile.mts) and this schema's own filter
 * share one literal and can never drift.
 */
export const PUBLIC_THREAD_URL_PREFIX = `https://lists.latoolb.us/hyperkitty/list/${TARGET_LIST}/thread/`;

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
	 * The public HyperKitty deep link the post landed at, filled in only
	 * during reconciliation. Required once `published` flips to true.
	 */
	archiveUrl: Schema.optional(
		Schema.NonEmptyString.pipe(
			Schema.filter(
				(url) =>
					url.startsWith(PUBLIC_THREAD_URL_PREFIX) || `archiveUrl must be a public ${TARGET_LIST} thread deep link`,
			),
		),
	),
}).pipe(
	Schema.filter(
		(fm) => fm.published === false || fm.archiveUrl !== undefined || 'archiveUrl is required once published is true',
	),
);

export type DiscussDraftFrontmatter = Schema.Schema.Type<typeof DiscussDraftFrontmatter>;
