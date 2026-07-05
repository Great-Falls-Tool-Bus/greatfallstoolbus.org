// Build-time feature flags. Read through Vite's `import.meta.env`, which inlines
// the literal at build so a false flag is dead-code-eliminated from the client
// bundle (the gated markup and its outbound URL never ship). `PUBLIC_`-prefixed
// vars reach the client via the `envPrefix` set in vite.config.ts.

/**
 * Parse an env-var flag. Vite hands env values through as strings (or
 * `undefined` when unset), so accept the common truthy spellings and treat
 * everything else — including unset, empty, and "false" — as false. This is the
 * fail-closed default: absence means off.
 */
export function parseFlag(raw: unknown): boolean {
	if (typeof raw === 'boolean') return raw;
	if (typeof raw !== 'string') return false;
	const value = raw.trim().toLowerCase();
	return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

/**
 * PUBLIC_ARCHIVE_LIVE gates the public `discuss@latoolb.us` HyperKitty archive
 * surface (TIN-2528). DEFAULT FALSE / fail-closed.
 *
 * The archive host `lists.latoolb.us` is operator-gated: it sits behind an
 * Anubis proof-of-work edge and a hard privacy pre-flight, and it is NOT live
 * until an operator has walked the go-live checklist and flipped this flag. While
 * it is false, the /discuss page explains the board is coming and renders NO
 * outbound link (which would 404), and the "Discuss" nav entry is withheld.
 */
export const publicArchiveLive: boolean = parseFlag(import.meta.env.PUBLIC_ARCHIVE_LIVE);
