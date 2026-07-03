// Tool-cell inventory truth, shared by /tools (the browsable inventory),
// /cell-sheets (the printable one-pagers), and /wants (the honest gap list).
// Inventory doctrine: every entry resolves to a real model number with a
// manufacturer manual or datasheet link — no invented product names, ever.
// All five order-reference items resolved + operator-confirmed 2026-07-02
// (method owned by the tailoring manifest lane; citation table in
// Jesssullivan/transfemme-tailoring README).
//
// The per-tool truth now lives as one .svx file per tool under
// src/content/tools/<cell>/<slug>.svx (frontmatter = inventory metadata,
// body = optional free-form prose for future per-tool pages). This module
// globs that tree at build time so all three routes are driven by ONE tree
// and can never drift apart. Validate with `just tools-validate`.
import { decodeOrThrow } from '$lib/effect/schema';
import { ToolFrontmatter } from '$lib/data/tool-schema';

export interface CellTool {
	slug: string;
	name: string;
	status: 'in-kit' | 'restoration';
	blurb: string;
	docUrl?: string;
	docLabel?: string;
}

export interface ToolCell {
	slug: string;
	name: string;
	/** Captain of record. null = the cell still needs one (readme.txt want #3). */
	captain: string | null;
	/** How the kit travels, honestly — the donate-page criteria, applied. */
	travels: string;
	tools: CellTool[];
}

export interface WantedTool {
	slug: string;
	name: string;
	/** Display name of the owning cell, e.g. "Sewing cell". */
	cellName: string;
	blurb: string;
}

/** Cell-level truth (captain, travel doctrine). Tools come from the .svx tree. */
const CELL_META: Array<Omit<ToolCell, 'tools'>> = [
	{
		slug: 'sewing',
		name: 'Sewing cell',
		captain: null,
		travels:
			'Machine in its case, notions boxed, every bit marked as part of the set. If the kit cannot be repacked and rolling in ten minutes, something is missing — tell a keyholder.',
	},
];

const modules = import.meta.glob('/src/content/tools/**/*.svx', { eager: true }) as Record<
	string,
	{ metadata?: unknown }
>;

const decodeFrontmatter = decodeOrThrow(ToolFrontmatter);

const entries = Object.entries(modules).map(([path, mod]) => {
	const slug =
		path
			.replace(/\.svx$/, '')
			.split('/')
			.pop() ?? path;
	try {
		return { slug, fm: decodeFrontmatter(mod.metadata) };
	} catch (error) {
		throw new Error(`Invalid tool frontmatter in ${path} (run \`just tools-validate\`): ${String(error)}`);
	}
});

for (const { slug, fm } of entries) {
	if (!CELL_META.some((cell) => cell.slug === fm.cell)) {
		throw new Error(`Unknown cell '${fm.cell}' in src/content/tools/**/${slug}.svx (run \`just tools-validate\`)`);
	}
}

export const cells: ToolCell[] = CELL_META.map((meta) => ({
	...meta,
	tools: entries
		.filter(({ fm }) => fm.cell === meta.slug && fm.status !== 'wants')
		.sort((a, b) => a.fm.order - b.fm.order)
		.map(({ slug, fm }) => ({
			slug,
			name: fm.name,
			status: fm.status as 'in-kit' | 'restoration',
			blurb: fm.blurb,
			...(fm.docUrl !== undefined ? { docUrl: fm.docUrl } : {}),
			...(fm.docLabel !== undefined ? { docLabel: fm.docLabel } : {}),
		})),
}));

export const wants: WantedTool[] = entries
	.filter(({ fm }) => fm.status === 'wants')
	.sort((a, b) => a.fm.order - b.fm.order)
	.map(({ slug, fm }) => ({
		slug,
		name: fm.name,
		cellName: CELL_META.find((cell) => cell.slug === fm.cell)?.name ?? fm.cell,
		blurb: fm.blurb,
	}));
