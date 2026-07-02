// Tool-cell inventory truth, shared by /tools (the browsable inventory) and
// /cell-sheets (the printable one-pagers). Inventory doctrine: every entry
// resolves to a real model number with a manufacturer manual or datasheet
// link — no invented product names, ever. All five order-reference items
// resolved + operator-confirmed 2026-07-02 (method owned by the tailoring
// manifest lane; citation table in Jesssullivan/transfemme-tailoring README).

export interface CellTool {
	item: string;
	status: string;
	doc?: string;
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

export const cells: ToolCell[] = [
	{
		slug: 'sewing',
		name: 'Sewing cell',
		captain: null,
		travels:
			'Machine in its case, notions boxed, every bit marked as part of the set. If the kit cannot be repacked and rolling in ten minutes, something is missing — tell a keyholder.',
		tools: [
			{
				item: 'SINGER Heavy Duty 6600C Sterling (computerized)',
				status: 'The working machine — 100 built-in stitches, six one-step buttonholes. Manual linked below.',
				doc: 'https://cdn.poconosewandvac.com/web/products/instruction-manuals/pdfs/singer/hd6600c-hd6605c/hd6600c-hd6605c-instruction-manual.pdf',
				docLabel: 'Instruction manual (PDF)',
			},
			{
				item: 'Treadle Singer sewing machine (1800s)',
				status: 'Restoration in progress — honestly framed: not yet a working machine.',
			},
			{
				item: 'SINGER ProSeries scissors bundle (8.5″ bent + 4.5″ detail + snips)',
				status: 'The kit shears. Bent shears stay dedicated to fabric.',
				doc: 'https://www.singer.com/products/singer-8-5-proseries-scissors',
				docLabel: 'singer.com',
			},
			{
				item: 'FIVEIZERO seam-ripper set (2 large + 2 small + snips)',
				status: 'In kit — the most-used tools in any alteration.',
			},
			{
				item: 'BulingBuling bonded-nylon upholstery thread kit (8 × 210D/3)',
				status: 'In kit. Heavy repairs only — too stiff for fine seams.',
			},
			{
				item: 'Newkita 2″ T-pins (100, E0106)',
				status: 'In kit. For blocking and heavy layers — too thick for shirting.',
			},
			{ item: 'Singer sewing machine oil', status: 'In kit. Oil only, never grease.' },
			{ item: 'Small cutting surface', status: 'In kit.' },
			{ item: 'Small handheld rotary cutter', status: 'In kit.' },
		],
	},
];
