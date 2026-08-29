/**
 * The vocabulary gate (TIN-3814 slice I1; binding on every inventory slice).
 *
 * Spec `spec/inventory-pilot-executable-slices-2026-08-20.md` §0 (the binding
 * vocabulary rule, restated from Member v0 slices §1.4): "This surface says
 * *application* and *intake*. It never says *enrollment*, *ingest*,
 * *catalog*, or *steward*... A grep for those four words over `src/` is part
 * of every slice's `just check` posture."
 *
 * Scoped to `src/lib/server/inventory/` and its numbered migration — this
 * slice's own file fence — the
 * same way the Member v0 S8 import-boundary test scopes to
 * `src/lib/server/contribution/` and `src/lib/server/membership/` rather than
 * grepping the whole tree (which would also flag the long-standing, unrelated
 * public `/stewards` volunteer-recognition route — a different sense of the
 * word this rule was never aimed at). Future slices (I3, I7, I9, …) extend
 * this same pattern to their own directories as they land.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const inventoryRoot = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const inventoryMigration = path.resolve(
	inventoryRoot,
	'..',
	'..',
	'..',
	'..',
	'drizzle',
	'0011_inventory_schema_foundation.sql',
);
const FORBIDDEN = /\b(enrollment|ingest|catalog|steward)\b/i;

function sourcesUnder(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) return sourcesUnder(full);
		return /\.(ts|js|svelte|sql|md)$/.test(entry) ? [full] : [];
	});
}

describe('inventory vocabulary — application/intake, never the four retired terms', () => {
	// SELF is excluded from the scan: this file is the one place that is
	// SUPPOSED to spell the retired terms out — in its own docstring and in
	// the FORBIDDEN pattern's source — so grepping it against its own rule
	// would be a permanent, meaningless failure rather than a real finding.
	const files = [...sourcesUnder(inventoryRoot), inventoryMigration].filter((f) => f !== SELF);

	it('is not vacuous — the inventory surface exists and has files to check', () => {
		expect(files.length).toBeGreaterThanOrEqual(3);
	});

	it('no inventory source or numbered migration uses a forbidden word', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			const match = text.match(FORBIDDEN);
			if (match) offenders.push(`${path.relative(process.cwd(), file)}: "${match[0]}"`);
		}
		expect(offenders).toEqual([]);
	});
});
