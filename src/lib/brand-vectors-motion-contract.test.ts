import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Brand-vectors default-motion contract (TinyVectors idle drift).
//
// Through v0.3.6 the tinyvectors physics loop never read each blob's
// driftAngle/driftSpeed cruise field: with no pointer, scroll, or
// devicemotion input (i.e. every idle desktop), the only motion was a
// zero-mean jitter random walk the engine's damping erased in ~1.4s, so the
// background read as frozen-with-a-shiver. v0.3.7 wires that cruise in —
// idle drift/bounce is the package default on ALL environments, with no
// permission grant or sensor required, while devicemotion still only
// ENHANCES motion (PR #224's permission-gesture pill stays the iOS-only
// opt-in) and prefers-reduced-motion still freezes the frame entirely.
//
// This test pins the two seams that deliver that default so a refactor
// cannot silently regress to the jiggle era:
// - the Bzlmod dependency pin must stay at or above 0.3.7 (the first release
//   with the idle drift cruise) and its public :pkg must stay graph-linked;
// - the layout call site must not opt out of the animated default or the
//   reduced-motion default.
// scripts/check-inhouse-package-parity.mjs separately enforces that no npm
// shadow source exists and that the link participates in every product action.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const IDLE_DRIFT_FLOOR = [0, 3, 7] as const;

function parsePinnedTinyvectorsVersion(): { pin: string; version: number[] } {
	const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
	const match = moduleBazel.match(
		/bazel_dep\(name = "tummycrypt_tinyvectors", version = "(\d+)\.(\d+)\.(\d+)"\)/,
	);
	expect(match, 'a tummycrypt_tinyvectors Bzlmod pin').not.toBeNull();
	return { pin: match![0], version: match!.slice(1).map(Number) };
}

describe('tinyvectors default-motion contract', () => {
	it('pins @tummycrypt/tinyvectors at or above 0.3.7 (idle drift cruise is the default)', () => {
		const { version } = parsePinnedTinyvectorsVersion();
		const floor = IDLE_DRIFT_FLOOR.reduce<number>((s, n) => s * 1000 + n, 0);
		const pinned = version.reduce((s, n) => s * 1000 + n, 0);
		expect(pinned).toBeGreaterThanOrEqual(floor);
	});

	it('keeps the pinned module integrity-locked and linked through its public :pkg target', () => {
		const { version } = parsePinnedTinyvectorsVersion();
		const versionText = version.join('.');
		const moduleLock = readFileSync(path.join(repoRoot, 'MODULE.bazel.lock'), 'utf8');
		const build = readFileSync(path.join(repoRoot, 'BUILD.bazel'), 'utf8');
		expect(moduleLock).toContain(`/tummycrypt_tinyvectors/${versionText}/source.json`);
		expect(build).toContain('src = "@tummycrypt_tinyvectors//:pkg"');
	});

	it('layout call site keeps the animated + reduced-motion defaults and the devicemotion enhancement', () => {
		const layout = readFileSync(path.join(repoRoot, 'src', 'routes', '+layout.svelte'), 'utf8');
		const block = layout.match(/<TinyVectors[\s\S]*?\/>/);
		expect(block, 'a <TinyVectors ... /> block in +layout.svelte').not.toBeNull();
		// animated defaults to true and respectReducedMotion defaults to true:
		// the call site must not override either (idle drift on desktop,
		// full freeze under prefers-reduced-motion).
		expect(block![0]).not.toMatch(/animated=\{false\}/);
		expect(block![0]).not.toMatch(/respectReducedMotion=\{false\}/);
		// Devicemotion stays the enhancement layer exactly as #224 wired it.
		expect(block![0]).toMatch(/enableDeviceMotion=\{true\}/);
	});
});
