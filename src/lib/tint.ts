// Deterministic name -> brand accent (Wave-3 WOW polish, avatar-tint).
//
// Maps a person's name to ONE of the five omux warm/OKLCH brand stops that the
// site wordmark already paints with in +layout.svelte
// (`colors={['#cb6738', ...]}`). Reusing that exact hard-coded set keeps tinted
// avatar tiles on-palette with the animated brand mark instead of introducing a
// second, drifting color source. Pure + deterministic: the same name always
// resolves to the same stop, so SSR and the client agree and there is no hydration
// flash. The stop is fed to `.avatar-tile` as the `--tile-accent` custom property,
// which only recolors the faint background wash + border; the initials keep the
// theme's primary-700/300 ink so contrast stays anchored in both modes.

/**
 * The five omux brand accent stops, in the exact order the brand wordmark uses.
 * Kept in sync with the literal array in `src/routes/+layout.svelte`.
 */
export const TINT_STOPS = ['#cb6738', '#d99d6a', '#a14a52', '#6b4f3a', '#3d6b8c'] as const;

export type TintStop = (typeof TINT_STOPS)[number];

/**
 * Deterministically map a name to one brand accent stop via a small djb2 string
 * hash. Stable across runs and platforms; empty/whitespace names fall to the
 * first stop. djb2 (seed 5381, multiplier 33) is used over a plain *31 sum
 * because it spreads the short real roster names more evenly across the five
 * stops instead of clustering most of them on one.
 */
export function tintFor(name: string): TintStop {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		// (hash * 33 + charCode), coerced to a 32-bit int each step so the result
		// is platform-stable and cannot overflow into a float.
		hash = (Math.imul(hash, 33) + name.charCodeAt(i)) | 0;
	}
	const idx = (hash >>> 0) % TINT_STOPS.length;
	return TINT_STOPS[idx];
}
