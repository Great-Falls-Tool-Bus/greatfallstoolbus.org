// Authoring logic for the /cells/new cell-doc helper: turn a filled-out form
// into a ready-to-commit `.svx` tool file for src/content/tools/**. The pure
// functions here (slug, YAML frontmatter serialization, path, validation) live
// apart from the Svelte page so they are unit-tested against the SAME frontmatter
// contract the build loader enforces ($lib/data/tool-schema). The test compiles
// the generated `.svx` through mdsvex and decodes its frontmatter through
// ToolFrontmatter, so the helper can never emit a doc the site would reject.
//
// House precedent: this mirrors $lib/contact-form.ts (pure, tested) + its
// component consumer, keeping the DOM-free rules in one place.
import { CELL_SLUGS, TOOL_STATUSES } from '$lib/data/tool-schema';

export type CellSlug = (typeof CELL_SLUGS)[number];
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/** Everything the form collects. Optionals are omitted from output when empty. */
export interface CellDocValues {
	/** Display name — the real product, as on an order reference. */
	name: string;
	/** Owning cell slug. */
	cell: CellSlug;
	/** Inventory state. */
	status: ToolStatus;
	/** One honest sentence — the card copy on /tools or /wants. */
	blurb: string;
	/** Stable sort position within the cell (kit-packing order). */
	order: number;
	/** Manufacturer manual / datasheet — https only. */
	docUrl?: string;
	/** Link text for docUrl; required whenever docUrl is present. */
	docLabel?: string;
	/** Wiki "citation needed": in the kit, but a real specific is undocumented. */
	detailsNeeded?: boolean;
	/** What is still missing, in fill order. Only meaningful when detailsNeeded. */
	detailsWanted?: readonly string[];
	/** Optional free-form markdown body (prose under the frontmatter). */
	body?: string;
	/** Filename slug override; defaults to slugify(name). */
	slug?: string;
}

export type CellDocErrors = Partial<
	Record<'name' | 'cell' | 'status' | 'blurb' | 'order' | 'docUrl' | 'docLabel' | 'slug', string>
>;

/** Kebab-case slug from a display name: the filename the site expects. */
export function slugify(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** The slug that will be used: explicit override, else derived from the name. */
export function resolveSlug(values: Pick<CellDocValues, 'name' | 'slug'>): string {
	const explicit = values.slug?.trim();
	return explicit ? slugify(explicit) : slugify(values.name);
}

/** Repo-relative path the generated file belongs at. */
export function cellDocPath(values: CellDocValues): string {
	return `src/content/tools/${values.cell}/${resolveSlug(values) || 'untitled'}.svx`;
}

/** Filename only, e.g. `serger.svx`. */
export function cellDocFilename(values: CellDocValues): string {
	return `${resolveSlug(values) || 'untitled'}.svx`;
}

/** Trim, and treat whitespace-only optionals as absent. */
function clean(value: string | undefined): string {
	return (value ?? '').trim();
}

/** Non-empty detailsWanted entries, trimmed. */
function cleanList(list: readonly string[] | undefined): string[] {
	return (list ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/** Single-quoted YAML scalar. Apostrophes are doubled per the YAML spec. */
function yamlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

/** Inline YAML flow sequence of strings, matching the house `['a', 'b']` style. */
function yamlStringList(list: readonly string[]): string {
	return `[${list.map(yamlString).join(', ')}]`;
}

/**
 * The plain frontmatter object the YAML block represents, with only the fields
 * that should be emitted, in canonical order. Shared source of truth for both
 * the serializer and the schema round-trip test.
 */
export function toFrontmatterObject(values: CellDocValues): Record<string, unknown> {
	const fm: Record<string, unknown> = {
		name: clean(values.name),
		status: values.status,
		cell: values.cell,
		order: values.order,
		blurb: clean(values.blurb),
	};
	const docUrl = clean(values.docUrl);
	if (docUrl) {
		fm.docUrl = docUrl;
		fm.docLabel = clean(values.docLabel);
	}
	if (values.detailsNeeded) {
		fm.detailsNeeded = true;
		const wanted = cleanList(values.detailsWanted);
		if (wanted.length > 0) fm.detailsWanted = wanted;
	}
	return fm;
}

/** The `---`-delimited YAML frontmatter block (no trailing newline). */
export function buildFrontmatter(values: CellDocValues): string {
	const lines = ['---'];
	lines.push(`name: ${yamlString(clean(values.name))}`);
	lines.push(`status: ${yamlString(values.status)}`);
	lines.push(`cell: ${yamlString(values.cell)}`);
	lines.push(`order: ${Number.isFinite(values.order) ? String(values.order) : '0'}`);
	lines.push(`blurb: ${yamlString(clean(values.blurb))}`);

	const docUrl = clean(values.docUrl);
	if (docUrl) {
		lines.push(`docUrl: ${yamlString(docUrl)}`);
		lines.push(`docLabel: ${yamlString(clean(values.docLabel))}`);
	}

	if (values.detailsNeeded) {
		lines.push('detailsNeeded: true');
		const wanted = cleanList(values.detailsWanted);
		if (wanted.length > 0) lines.push(`detailsWanted: ${yamlStringList(wanted)}`);
	}

	lines.push('---');
	return lines.join('\n');
}

/**
 * The complete `.svx` source: frontmatter, then (if the author wrote any) the
 * markdown body, then a single trailing newline. Body-less docs end right after
 * the closing `---`, exactly like the terse real files (e.g. cutting-surface).
 */
export function buildCellDocSvx(values: CellDocValues): string {
	const frontmatter = buildFrontmatter(values);
	const body = (values.body ?? '').trim();
	return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
}

/**
 * Field-level validation mirroring the schema filters in tool-schema.ts, for
 * live in-form hints. Empty = the doc will decode; a returned message = it will
 * not (or a slug/order problem would break the file on commit).
 */
export function validateCellDoc(values: CellDocValues): CellDocErrors {
	const errors: CellDocErrors = {};

	if (!clean(values.name)) errors.name = 'A tool name is required.';
	if (!clean(values.blurb)) errors.blurb = 'Write one honest sentence for the card.';
	if (!CELL_SLUGS.includes(values.cell)) errors.cell = 'Choose an existing cell.';
	if (!TOOL_STATUSES.includes(values.status)) errors.status = 'Choose an inventory status.';
	if (!Number.isFinite(values.order)) errors.order = 'Order must be a number.';

	if (!resolveSlug(values)) {
		errors.slug = 'The name has no letters or numbers to form a filename slug.';
	}

	const docUrl = clean(values.docUrl);
	if (docUrl && !docUrl.startsWith('https://')) {
		errors.docUrl = 'The manual link must be an https:// URL.';
	}
	if (docUrl && !clean(values.docLabel)) {
		errors.docLabel = 'Add link text for the manual (required when a link is set).';
	}

	return errors;
}

/** True when validateCellDoc found no blocking problems. */
export function hasErrors(errors: CellDocErrors): boolean {
	return Object.keys(errors).length > 0;
}

/** Blank starting values for the form. */
export function emptyCellDocValues(): CellDocValues {
	return {
		name: '',
		cell: 'sewing',
		status: 'in-kit',
		blurb: '',
		order: 1,
		docUrl: '',
		docLabel: '',
		detailsNeeded: false,
		detailsWanted: [],
		body: '',
		slug: '',
	};
}
