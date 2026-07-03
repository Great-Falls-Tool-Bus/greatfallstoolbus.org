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
export const CELL_SLUGS = ['sewing'] as const;

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
}).pipe(
	Schema.filter(
		(fm) => fm.docUrl === undefined || fm.docLabel !== undefined || 'docLabel is required when docUrl is set',
	),
);

export type ToolFrontmatter = Schema.Schema.Type<typeof ToolFrontmatter>;
