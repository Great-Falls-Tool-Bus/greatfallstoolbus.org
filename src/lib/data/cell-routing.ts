// Pure cell-routing logic for TIN-3502: which tool-frontmatter statuses
// route to a cell's tool listing (/tools, /cells/*, /cell-sheets) vs.
// /wants vs. nowhere. Deliberately split out of $lib/data/cells.ts, which
// eagerly globs + parses the real src/content/tools/**/*.svx tree at module
// load (`import.meta.glob`) — a step vitest's config does not run mdsvex
// preprocessing for, so importing cells.ts from a test blows up on the raw
// frontmatter text. Nothing in this module touches the filesystem or the
// glob, so cell-routing.test.ts can exercise the routing decision directly
// with fixtures. See cells.ts for the real data source and
// cell-routing.test.ts for the zero-routes proof.
import type { ToolFrontmatter } from './tool-schema';

export interface CellTool {
	slug: string;
	name: string;
	status: 'in-kit' | 'restoration';
	blurb: string;
	docUrl?: string;
	docLabel?: string;
	/** Wiki "citation needed": in the kit, but a real specific is undocumented. */
	detailsNeeded?: boolean;
	/** What is still missing, in fill order (e.g. ['model number', 'photo']). */
	detailsWanted?: readonly string[];
	/**
	 * Repo-relative path of the .svx source for this tool, e.g.
	 * `src/content/tools/network/g2-lora-base-station.svx`. The DetailsNeeded
	 * chip turns this into a GitHub edit URL so an owner can fill in the gap.
	 */
	sourcePath: string;
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

export type ToolEntry = { slug: string; sourcePath: string; fm: ToolFrontmatter };
type CellMeta = Omit<ToolCell, 'tools'>;

/**
 * TIN-3502: the set of statuses that route to a cell's tool listing. This is
 * an explicit ALLOWLIST, not the `fm.status !== 'wants'` denylist it
 * replaces (formerly cells.ts:113) — a status has to be named here on
 * purpose to ever reach a listing. Anything not named here, including
 * 'wants' (which routes to /wants via buildWants below) and any status not
 * yet ratified into TOOL_STATUSES (./tool-schema.ts), is dropped from every
 * route. New statuses need TIN-3498 ratification before landing in
 * TOOL_STATUSES *and* here — see cell-routing.test.ts for the zero-routes proof.
 */
const LISTED_TOOL_STATUSES: ReadonlySet<ToolFrontmatter['status']> = new Set(['in-kit', 'restoration']);

/** /tools, /cells/*, /cell-sheets truth. */
export function buildCells(entries: readonly ToolEntry[], cellMeta: readonly CellMeta[]): ToolCell[] {
	return cellMeta.map((meta) => ({
		...meta,
		tools: entries
			.filter(({ fm }) => fm.cell === meta.slug && LISTED_TOOL_STATUSES.has(fm.status))
			.sort((a, b) => a.fm.order - b.fm.order)
			.map(({ slug, sourcePath, fm }) => ({
				slug,
				name: fm.name,
				status: fm.status as 'in-kit' | 'restoration',
				blurb: fm.blurb,
				sourcePath,
				...(fm.docUrl !== undefined ? { docUrl: fm.docUrl } : {}),
				...(fm.docLabel !== undefined ? { docLabel: fm.docLabel } : {}),
				...(fm.detailsNeeded !== undefined ? { detailsNeeded: fm.detailsNeeded } : {}),
				...(fm.detailsWanted !== undefined ? { detailsWanted: fm.detailsWanted } : {}),
			})),
	}));
}

/** /wants truth. */
export function buildWants(entries: readonly ToolEntry[], cellMeta: readonly CellMeta[]): WantedTool[] {
	return entries
		.filter(({ fm }) => fm.status === 'wants')
		.sort((a, b) => a.fm.order - b.fm.order)
		.map(({ slug, fm }) => ({
			slug,
			name: fm.name,
			cellName: cellMeta.find((cell) => cell.slug === fm.cell)?.name ?? fm.cell,
			blurb: fm.blurb,
		}));
}
