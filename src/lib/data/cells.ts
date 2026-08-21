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
//
// The status -> route decision (which statuses appear in a cell listing vs.
// /wants vs. nowhere) lives in $lib/data/cell-routing.ts as pure,
// glob-free functions (buildCells / buildWants) so it can be unit tested
// with fixtures — see cell-routing.ts's TIN-3502 allowlist doc-comment and
// cell-routing.test.ts's zero-routes proof.
import { decodeOrThrow } from '$lib/effect/schema';
import { ToolFrontmatter } from '$lib/data/tool-schema';
import {
	buildCells,
	buildWants,
	type CellTool,
	type ToolCell,
	type ToolEntry,
	type WantedTool,
} from '$lib/data/cell-routing';

export type { CellTool, ToolCell, WantedTool };

/** Cell-level truth (captain, travel doctrine). Tools come from the .svx tree. */
const CELL_META: Array<Omit<ToolCell, 'tools'>> = [
	{
		slug: 'sewing',
		name: 'Sewing cell',
		captain: null,
		travels:
			'Machine in its case, notions boxed, every bit marked as part of the set. If the kit cannot be repacked and rolling in ten minutes, something is missing, tell a keyholder.',
	},
	{
		slug: 'network',
		name: 'Network and tracing cell',
		captain: 'Jess',
		travels:
			'Meters and radios in a padded case, cables coiled and tied, every probe and adapter marked as part of the set. If the kit cannot be repacked and rolling in ten minutes, something is missing, tell a keyholder.',
	},
	{
		slug: 'welding',
		name: 'Welding cell',
		captain: 'Ripley',
		travels:
			'Welder and leads on the cart or in the case, work holding and clamps boxed, eye protection with the kit, consumables handled to their own rules. Nothing sharp or live rides loose. If the kit cannot be repacked and secured, something is missing, tell a keyholder.',
	},
];

const modules = import.meta.glob('/src/content/tools/**/*.svx', { eager: true }) as Record<
	string,
	{ metadata?: unknown }
>;

const decodeFrontmatter = decodeOrThrow(ToolFrontmatter);

const entries: ToolEntry[] = Object.entries(modules).map(([path, mod]) => {
	const slug =
		path
			.replace(/\.svx$/, '')
			.split('/')
			.pop() ?? path;
	// Glob keys are absolute-from-root (`/src/content/tools/<cell>/<slug>.svx`);
	// strip the leading slash so `sourcePath` is a repo-relative path the
	// DetailsNeeded edit link (and, when it lands, the #60 source map) can turn
	// into a GitHub edit URL.
	const sourcePath = path.replace(/^\//, '');
	try {
		return { slug, sourcePath, fm: decodeFrontmatter(mod.metadata) };
	} catch (error) {
		throw new Error(`Invalid tool frontmatter in ${path} (run \`just tools-validate\`): ${String(error)}`);
	}
});

for (const { slug, fm } of entries) {
	if (!CELL_META.some((cell) => cell.slug === fm.cell)) {
		throw new Error(`Unknown cell '${fm.cell}' in src/content/tools/**/${slug}.svx (run \`just tools-validate\`)`);
	}
}

export const cells: ToolCell[] = buildCells(entries, CELL_META);
export const wants: WantedTool[] = buildWants(entries, CELL_META);
