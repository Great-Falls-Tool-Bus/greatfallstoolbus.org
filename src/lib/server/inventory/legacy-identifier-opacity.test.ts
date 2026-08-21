/**
 * `asset.legacy_identifier` stays opaque (TIN-3814 slice I1).
 *
 * Launch spec §8 (:354–356): "Legacy sewing-cell identifiers whose product
 * mapping has not been confirmed remain opaque. An operator maps them during
 * pilot intake; code, copy, and agents must not infer product names from the
 * identifiers." Slices §1.2 acceptance: "a grep-shaped test asserts no
 * reference to it outside schema, intake (I9), and its tests."
 *
 * I9 (pilot intake) does not exist yet in this repository — that predecessor
 * is vacuous today, the same posture `fence.test.ts` documents for the
 * not-yet-built membership module. This test still runs for real: it proves
 * the column is referenced ONLY where I1 itself declares and tests it, so the
 * day I9 lands, this file is what keeps its intake surface — and nothing
 * else — allowed to touch the column.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const inventoryRoot = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(inventoryRoot, '..', '..', '..');
const SELF = fileURLToPath(import.meta.url);
// Schema declaration and this test's own fixtures are the allowed references.
const ALLOWED_PATHS = new Set([
	path.join(inventoryRoot, 'schema.ts'),
	path.join(inventoryRoot, 'schema.integration.test.ts'),
	SELF,
]);
const REFERENCE = /legacy[\s_-]*identifier/i;

function sourcesUnder(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const full = path.join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) return sourcesUnder(full);
		return stat.isFile() ? [full] : [];
	});
}

describe('asset.legacy_identifier is referenced only by schema and its own tests', () => {
	const files = sourcesUnder(srcRoot);

	it('is not vacuous — schema.ts itself references the column', () => {
		const schemaFile = path.join(inventoryRoot, 'schema.ts');
		expect(schemaFile).toBeDefined();
		expect(readFileSync(schemaFile, 'utf8')).toMatch(REFERENCE);
	});

	it('no file outside the allowlist references legacy_identifier / legacyIdentifier', () => {
		const offenders: string[] = [];
		for (const file of files) {
			if (ALLOWED_PATHS.has(file)) continue;
			if (REFERENCE.test(readFileSync(file, 'utf8'))) {
				offenders.push(path.relative(process.cwd(), file));
			}
		}
		expect(offenders).toEqual([]);
	});

	it('the column itself carries no inferred-name helper in this module (no *ToProductName, *displayName-from-legacy, etc.)', () => {
		const schemaFile = path.join(inventoryRoot, 'schema.ts');
		const text = readFileSync(schemaFile, 'utf8');
		expect(text).not.toMatch(/productName|inferLabel|legacyToDisplay/i);
	});
});
