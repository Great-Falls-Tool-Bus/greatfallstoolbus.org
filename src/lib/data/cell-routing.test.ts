import { describe, expect, it } from 'vitest';
import { buildCells, buildWants, type ToolCell, type ToolEntry } from './cell-routing';
import type { ToolFrontmatter } from './tool-schema';

// TIN-3502: cells.ts:113 used to be a denylist (`fm.status !== 'wants'`), so
// any status the schema ever allowed through that wasn't literally 'wants'
// would silently route to a cell listing. buildCells/buildWants (now in
// $lib/data/cell-routing.ts) filter on an explicit allowlist instead
// (LISTED_TOOL_STATUSES). These tests exercise that allowlist directly with
// fixture entries, independent of the real src/content/tools tree
// (cell-routing.ts has no import.meta.glob) and independent of the
// ToolFrontmatter schema gate in tool-schema.ts — i.e. even if a fourth
// status ever slipped past that schema, the routing logic must still drop
// it everywhere.

const CELL_META: Array<Omit<ToolCell, 'tools'>> = [
	{ slug: 'sewing', name: 'Sewing cell', captain: null, travels: 'travels.' },
];

function fixtureEntry(status: string, overrides: Partial<ToolEntry['fm']> = {}): ToolEntry {
	return {
		slug: 'fixture-tool',
		sourcePath: 'src/content/tools/sewing/fixture-tool.svx',
		fm: {
			name: 'Fixture tool',
			cell: 'sewing',
			blurb: 'A fixture, not a real tool.',
			order: 1,
			...overrides,
			status: status as ToolFrontmatter['status'],
		},
	};
}

describe('cell status routing allowlist (TIN-3502)', () => {
	it('routes the currently-ratified in-kit and restoration statuses to the cell listing', () => {
		const entries = [fixtureEntry('in-kit'), fixtureEntry('restoration', { order: 2 })];

		const cells = buildCells(entries, CELL_META);

		expect(cells[0]?.tools.map((tool) => tool.status)).toEqual(['in-kit', 'restoration']);
	});

	it('routes wants to /wants only, never to a cell listing', () => {
		const entries = [fixtureEntry('wants')];

		expect(buildCells(entries, CELL_META)[0]?.tools).toHaveLength(0);
		expect(buildWants(entries, CELL_META)).toHaveLength(1);
	});

	it('a fictitious fourth status produces ZERO routes: not the cell listing, not /wants', () => {
		const entries = [fixtureEntry('discontinued')];

		const cells = buildCells(entries, CELL_META);
		const wants = buildWants(entries, CELL_META);

		expect(cells[0]?.tools).toHaveLength(0);
		expect(wants).toHaveLength(0);
	});

	it('a fictitious status never crowds out real entries in the same cell', () => {
		const entries = [
			fixtureEntry('in-kit', { order: 1 }),
			fixtureEntry('discontinued', { order: 2 }),
			fixtureEntry('wants', { order: 3 }),
		];

		const cells = buildCells(entries, CELL_META);
		const wants = buildWants(entries, CELL_META);

		expect(cells[0]?.tools.map((tool) => tool.status)).toEqual(['in-kit']);
		expect(wants).toHaveLength(1);
	});
});
