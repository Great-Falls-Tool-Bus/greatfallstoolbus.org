// Build provenance, read at build time through Vite's `import.meta.env` — the
// same inlining path as the PUBLIC_ feature flags (see flags.ts and the
// `envPrefix` in vite.config.ts). `PUBLIC_BUILD_SHA`, when supplied through a
// typed GF-I07/GF-I09 provenance carrier, binds the artifact to its source
// commit. The current v4 client authenticates the revision but does not yet
// expose that carrier to Vite, so the footer degrades to nothing. This
// application owns no image-publisher recipe or fallback source for the value.
// Fail-quiet: absence renders no line, never a broken link.

/**
 * Normalize a raw build-sha env value to a trustworthy commit hash, or '' when
 * absent/untrustworthy. Vite passes unset vars through as `undefined`, and the
 * build fallbacks can hand across the literal `'unknown'`; treat those — and any
 * non-hex noise — as absent so the footer never renders a bogus provenance link.
 * Returns the lowercased hex sha (7 to 64 chars), else ''.
 */
export function normalizeSha(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	const value = raw.trim().toLowerCase();
	if (!/^[0-9a-f]{7,64}$/.test(value)) return '';
	return value;
}

/** Full commit sha this artifact was built from, or '' when unknown / local. */
export const buildSha: string = normalizeSha(import.meta.env.PUBLIC_BUILD_SHA);

/** 7-char short sha for display, or '' when unknown / local. */
export const buildShaShort: string = buildSha ? buildSha.slice(0, 7) : '';
