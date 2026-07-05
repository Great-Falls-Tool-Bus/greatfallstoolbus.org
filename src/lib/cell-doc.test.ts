import { describe, expect, it } from 'vitest';
import { compile } from 'mdsvex';
import { Either, Schema } from 'effect';
import { ToolFrontmatter } from '$lib/data/tool-schema';
import {
	buildCellDocSvx,
	buildFrontmatter,
	cellDocFilename,
	cellDocPath,
	emptyCellDocValues,
	hasErrors,
	resolveSlug,
	slugify,
	toFrontmatterObject,
	validateCellDoc,
	type CellDocValues,
} from '$lib/cell-doc';

// The /cells/new helper must never emit a `.svx` the site would reject. The
// round-trip test below compiles the generated source through the SAME mdsvex
// preprocessor the build uses, then decodes its frontmatter through the SAME
// ToolFrontmatter schema $lib/data/cells.ts enforces at load time.
const decodeFrontmatter = Schema.decodeUnknownEither(ToolFrontmatter);

async function compileFrontmatter(svx: string): Promise<unknown> {
	const compiled = await compile(svx, { extensions: ['.svx'] });
	return (compiled as { data?: { fm?: unknown } } | undefined)?.data?.fm;
}

describe('slugify', () => {
	it('kebab-cases a real product name', () => {
		expect(slugify('SINGER Heavy Duty 6600C Sterling')).toBe('singer-heavy-duty-6600c-sterling');
	});

	it('collapses punctuation and runs, and trims edge dashes', () => {
		expect(slugify('  Fluke -- Tone/Probe  (set) ')).toBe('fluke-tone-probe-set');
	});

	it('folds accents down to ascii', () => {
		expect(slugify('Café Lumière')).toBe('cafe-lumiere');
	});

	it('returns empty when there is nothing sluggable', () => {
		expect(slugify('—/—')).toBe('');
	});
});

describe('resolveSlug / paths', () => {
	it('prefers an explicit slug override, re-slugified', () => {
		expect(resolveSlug({ name: 'Whatever', slug: 'My Override' })).toBe('my-override');
	});

	it('falls back to the name', () => {
		expect(resolveSlug({ name: 'Rotary Cutter', slug: '' })).toBe('rotary-cutter');
	});

	it('builds the repo-relative content path and filename', () => {
		const values: CellDocValues = { ...emptyCellDocValues(), name: 'Rotary Cutter', cell: 'sewing' };
		expect(cellDocPath(values)).toBe('src/content/tools/sewing/rotary-cutter.svx');
		expect(cellDocFilename(values)).toBe('rotary-cutter.svx');
	});
});

describe('buildFrontmatter / buildCellDocSvx', () => {
	it('emits the minimal terse doc shape (no body) with a single trailing newline', () => {
		const values: CellDocValues = {
			name: 'Small cutting surface',
			cell: 'sewing',
			status: 'in-kit',
			blurb: 'In kit.',
			order: 8,
		};
		expect(buildCellDocSvx(values)).toBe(
			[
				'---',
				"name: 'Small cutting surface'",
				"status: 'in-kit'",
				"cell: 'sewing'",
				'order: 8',
				"blurb: 'In kit.'",
				'---',
				'',
			].join('\n'),
		);
	});

	it('doubles apostrophes in YAML single-quoted scalars', () => {
		const fm = buildFrontmatter({
			name: "Captain's oiler",
			cell: 'sewing',
			status: 'in-kit',
			blurb: "It's oiled.",
			order: 2,
		});
		expect(fm).toContain("name: 'Captain''s oiler'");
		expect(fm).toContain("blurb: 'It''s oiled.'");
	});

	it('pairs docUrl with docLabel', () => {
		const fm = buildFrontmatter({
			name: 'X',
			cell: 'sewing',
			status: 'in-kit',
			blurb: 'b',
			order: 1,
			docUrl: 'https://example.com/manual.pdf',
			docLabel: 'Instruction manual (PDF)',
		});
		expect(fm).toContain("docUrl: 'https://example.com/manual.pdf'");
		expect(fm).toContain("docLabel: 'Instruction manual (PDF)'");
	});

	it('emits detailsNeeded + detailsWanted, and omits the list when empty', () => {
		const withList = buildFrontmatter({
			name: 'X',
			cell: 'network',
			status: 'in-kit',
			blurb: 'b',
			order: 1,
			detailsNeeded: true,
			detailsWanted: ['photo', 'config notes'],
		});
		expect(withList).toContain('detailsNeeded: true');
		expect(withList).toContain("detailsWanted: ['photo', 'config notes']");

		const noList = buildFrontmatter({
			name: 'X',
			cell: 'network',
			status: 'in-kit',
			blurb: 'b',
			order: 1,
			detailsNeeded: true,
			detailsWanted: ['   '],
		});
		expect(noList).toContain('detailsNeeded: true');
		expect(noList).not.toContain('detailsWanted');
	});

	it('does not emit details fields when detailsNeeded is false', () => {
		const fm = buildFrontmatter({
			name: 'X',
			cell: 'welding',
			status: 'in-kit',
			blurb: 'b',
			order: 1,
			detailsNeeded: false,
			detailsWanted: ['photo'],
		});
		expect(fm).not.toContain('detailsNeeded');
		expect(fm).not.toContain('detailsWanted');
	});

	it('appends a trimmed markdown body after a blank line', () => {
		const svx = buildCellDocSvx({
			name: 'X',
			cell: 'sewing',
			status: 'in-kit',
			blurb: 'b',
			order: 1,
			body: '\n  The working machine on the bus.  \n',
		});
		expect(svx.endsWith('---\n\nThe working machine on the bus.\n')).toBe(true);
	});
});

describe('validateCellDoc', () => {
	const base: CellDocValues = { name: 'Serger', cell: 'sewing', status: 'wants', blurb: 'Overlock.', order: 11 };

	it('passes a complete, honest doc', () => {
		expect(hasErrors(validateCellDoc(base))).toBe(false);
	});

	it('requires a name and a blurb', () => {
		const errors = validateCellDoc({ ...base, name: '  ', blurb: '' });
		expect(errors.name).toBeDefined();
		expect(errors.blurb).toBeDefined();
	});

	it('rejects a non-https manual link and a link without label', () => {
		expect(validateCellDoc({ ...base, docUrl: 'http://x.com', docLabel: 'M' }).docUrl).toBeDefined();
		expect(validateCellDoc({ ...base, docUrl: 'https://x.com' }).docLabel).toBeDefined();
	});

	it('flags a name that yields no slug', () => {
		expect(validateCellDoc({ ...base, name: '///' }).slug).toBeDefined();
	});
});

describe('generated frontmatter round-trips through the real schema', () => {
	const cases: CellDocValues[] = [
		{ name: 'Small cutting surface', cell: 'sewing', status: 'in-kit', blurb: 'In kit.', order: 8 },
		{
			name: 'SINGER Heavy Duty 6600C',
			cell: 'sewing',
			status: 'in-kit',
			blurb: 'The working machine.',
			order: 1,
			docUrl: 'https://example.com/hd6600c.pdf',
			docLabel: 'Instruction manual (PDF)',
			body: 'The working machine on the bus.',
		},
		{
			name: 'G2 base-station LoRa radio',
			cell: 'network',
			status: 'in-kit',
			blurb: 'In kit. A long-range radio.',
			order: 3,
			detailsNeeded: true,
			detailsWanted: ['photo', "operator's config notes"],
		},
		{
			name: 'Serger (Singer or Babylock class)',
			cell: 'sewing',
			status: 'wants',
			blurb: 'Overlock capability.',
			order: 11,
		},
	];

	for (const values of cases) {
		it(`compiles + decodes: ${values.name}`, async () => {
			const svx = buildCellDocSvx(values);
			const fm = await compileFrontmatter(svx);
			const decoded = decodeFrontmatter(fm);
			expect(Either.isRight(decoded), JSON.stringify(fm)).toBe(true);
			if (Either.isRight(decoded)) {
				expect(decoded.right.name).toBe(values.name);
				expect(decoded.right.cell).toBe(values.cell);
				expect(decoded.right.status).toBe(values.status);
				expect(decoded.right.order).toBe(values.order);
			}
		});
	}

	it('the frontmatter object itself decodes cleanly', () => {
		const obj = toFrontmatterObject(cases[2]);
		expect(Either.isRight(decodeFrontmatter(obj))).toBe(true);
	});
});
