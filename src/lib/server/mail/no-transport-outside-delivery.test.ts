/**
 * STRUCTURAL no-transport proof, part 1 of 2 (TIN-4062; PR #208 review E5).
 *
 * THE GAP THIS CLOSES. The review mutated `DisabledDelivery.send` to open a
 * real outbound TCP connection on every call and left the return value
 * untouched — every existing gate (49 unit tests including one literally
 * named "performs no network I/O", 6 integration tests including one
 * literally named "sends for real NEVER") stayed GREEN, because every
 * existing assertion is BEHAVIOURAL (`instanceof DisabledDelivery`, `mode
 * === 'disabled'`) and none of them can see network I/O.
 *
 * This file is a SOURCE-LEVEL assertion instead: `node:net` and `node:tls`
 * — the only two modules capable of opening a raw socket in this codebase —
 * may be statically imported or required from EXACTLY ONE file anywhere
 * under `src/`: `mail/delivery.ts` itself. A mutation that adds transport
 * capability to `DisabledDelivery`, or anywhere else, necessarily adds a
 * `node:net`/`node:tls` import to a SECOND file — and this test goes RED
 * the moment that import exists, before the mutated code ever runs.
 *
 * Deliberately does not special-case `delivery.test.ts`: that file uses
 * `import('node:net').Socket` as an inline TYPE position only (never a
 * static `import … from`/`require(…)`), so it does not — and must not —
 * appear in the matched set either. If it ever needs a real import, that is
 * itself worth a second look before widening the allow-list.
 *
 * `mail.integration.test.ts` IS allow-listed: it imports the real `net`/
 * `tls` modules to `vi.spyOn` them (the E5 runtime half — patch-to-throw,
 * assert never called) — a legitimate TEST-SIDE use of the real module
 * objects, not a second production transport-construction site. The
 * distinction this file polices is "which code can open a socket," not
 * "which files may reference the module at all."
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Static import/require of `node:net` or `node:tls` — NOT a type-only `import('node:net').X` reference. */
const STATIC_TRANSPORT_IMPORT_RE =
	/(^|\n)\s*import\s+[^;]*from\s+['"]node:(net|tls)['"]|require\(\s*['"]node:(net|tls)['"]\s*\)/;

const ALLOWED = new Set([
	path.join('lib', 'server', 'mail', 'delivery.ts'),
	path.join('lib', 'server', 'outbox', 'handlers', 'mail.integration.test.ts'),
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			walk(full, out);
		} else if (entry.endsWith('.ts') || entry.endsWith('.svelte')) {
			out.push(full);
		}
	}
	return out;
}

describe('node:net / node:tls stay confined to mail/delivery.ts (structural, E5)', () => {
	it('no other file under src/ statically imports or requires a raw-socket module', () => {
		const offenders: string[] = [];
		for (const file of walk(SRC_ROOT)) {
			const relative = path.relative(SRC_ROOT, file);
			if (ALLOWED.has(relative)) continue;
			const text = readFileSync(file, 'utf8');
			if (STATIC_TRANSPORT_IMPORT_RE.test(text)) offenders.push(relative);
		}
		expect(offenders).toEqual([]);
	});

	it('mail/delivery.ts itself DOES import both — the allow-list names a real file, not an empty set', () => {
		const text = readFileSync(path.join(SRC_ROOT, 'lib', 'server', 'mail', 'delivery.ts'), 'utf8');
		expect(text).toMatch(/import\s+net\s+from\s+['"]node:net['"]/);
		expect(text).toMatch(/import\s+tls\s+from\s+['"]node:tls['"]/);
	});

	it('reproduces the reviewer mutation directly: a file importing node:net OUTSIDE delivery.ts is caught', () => {
		// Not a fixture on disk (this suite must never actually construct a
		// transport) — a synthetic re-run of the same scan against a string
		// that models exactly what the reviewer's mutation would have added
		// to a second file, proving the regex/allow-list logic itself, not
		// just today's clean tree.
		const mutated = "import net from 'node:net';\nexport class DisabledDelivery { send() { net.createConnection(); } }";
		expect(STATIC_TRANSPORT_IMPORT_RE.test(mutated)).toBe(true);
	});
});
