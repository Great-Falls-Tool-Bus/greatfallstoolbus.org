// Frontmatter contract for the .svx tool-inventory tree at src/content/tools/**.
// Shared by the build-time loader ($lib/data/cells.ts) and the standalone
// validator (scripts/validate-tools.mts) so the schema can never drift between
// the two. Inventory doctrine: every entry resolves to a real model number
// with a manufacturer manual or datasheet link — no invented product names,
// ever (citation table in Jesssullivan/transfemme-tailoring README).
import { Schema } from 'effect';

/** Honest inventory states. 'wants' entries feed /wants, never /tools. */
export const TOOL_STATUSES = ['in-kit', 'restoration', 'wants'] as const;

/** Canonical cell slugs. New cells register here AND in $lib/data/cells.ts CELL_META. */
export const CELL_SLUGS = ['sewing', 'network', 'welding'] as const;

export const ToolFrontmatter = Schema.Struct({
	/** Display name — the real product, as it would appear on an order reference. */
	name: Schema.NonEmptyString,
	/** Inventory state: 'in-kit' | 'restoration' (on /tools) or 'wants' (on /wants). */
	status: Schema.Literal(...TOOL_STATUSES),
	/** Owning cell slug; must match a cell declared in $lib/data/cells.ts. */
	cell: Schema.Literal(...CELL_SLUGS),
	/** One honest sentence — this is the card copy on /tools or /wants. */
	blurb: Schema.NonEmptyString,
	/** Stable sort position within the cell (kit-packing order). */
	order: Schema.Number,
	/** Manufacturer manual / datasheet — https only. */
	docUrl: Schema.optional(
		Schema.NonEmptyString.pipe(Schema.filter((url) => url.startsWith('https://') || 'docUrl must be an https:// URL')),
	),
	/** Link text for docUrl; required whenever docUrl is present. */
	docLabel: Schema.optional(Schema.NonEmptyString),
	/**
	 * Wiki "citation needed" flag: this entry is in the kit but a real
	 * specific (model number, photo, config) is not yet documented. The site
	 * shows a calm "details needed" chip with an edit-source link instead of
	 * inventing the missing fact. Never set this to hide a fact we actually
	 * know; set it to invite the owner to fill in what they know.
	 */
	detailsNeeded: Schema.optional(Schema.Boolean),
	/**
	 * What specifically is still missing, in the order it should be filled
	 * (e.g. ['model number', 'photo']). Only meaningful when detailsNeeded.
	 */
	detailsWanted: Schema.optional(Schema.Array(Schema.NonEmptyString)),
}).pipe(
	Schema.filter(
		(fm) => fm.docUrl === undefined || fm.docLabel !== undefined || 'docLabel is required when docUrl is set',
	),
	Schema.filter(
		(fm) => fm.detailsWanted === undefined || fm.detailsNeeded === true || 'detailsWanted requires detailsNeeded: true',
	),
);

export type ToolFrontmatter = Schema.Schema.Type<typeof ToolFrontmatter>;
