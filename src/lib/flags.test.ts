import { describe, expect, it } from 'vitest';
import { parseFlag, publicArchiveLive, publicArchivePreview, archiveVisible } from './flags';

// The flag parser is the fail-closed gate for the public discuss@ archive
// surface (TIN-2528): anything that is not an explicit truthy spelling must read
// as OFF, so an unset / typo'd / empty env var can never accidentally publish
// the outbound archive link before the operator go-live checklist has run.
describe('parseFlag', () => {
	it('reads explicit truthy spellings as true', () => {
		for (const raw of ['true', 'TRUE', ' True ', '1', 'yes', 'on']) {
			expect(parseFlag(raw)).toBe(true);
		}
	});

	it('passes real booleans through', () => {
		expect(parseFlag(true)).toBe(true);
		expect(parseFlag(false)).toBe(false);
	});

	it('fails closed for unset, empty, and non-truthy strings', () => {
		for (const raw of [undefined, null, '', ' ', 'false', '0', 'no', 'off', 'maybe']) {
			expect(parseFlag(raw)).toBe(false);
		}
	});
});

// The discuss@ archive is a two-gate model (TIN-2528): a reserved PUBLIC go-live
// switch (publicArchiveLive) and a separate gated PREVIEW switch
// (publicArchivePreview) that is safe to flip inside an Access-gated deploy.
// archiveVisible is their OR and is the single predicate the /discuss page and
// nav read. BOTH gates MUST stay fail-closed by default so nothing surfaces
// until an operator sets one explicitly at build time.
describe('discuss@ archive gates', () => {
	it('keeps the public go-live switch fail-closed by default', () => {
		expect(publicArchiveLive).toBe(false);
	});

	it('keeps the gated preview switch fail-closed by default', () => {
		expect(publicArchivePreview).toBe(false);
	});

	it('hides the archive when neither gate is set (archiveVisible is the OR)', () => {
		expect(archiveVisible).toBe(false);
		expect(archiveVisible).toBe(publicArchiveLive || publicArchivePreview);
	});
});
