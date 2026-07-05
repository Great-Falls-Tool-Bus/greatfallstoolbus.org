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
 * PUBLIC_ARCHIVE_LIVE is the reserved PUBLIC go-live switch for the
 * `discuss@latoolb.us` HyperKitty archive surface (TIN-2528). DEFAULT FALSE /
 * fail-closed.
 *
 * LIVE means the archive is open to the whole internet. The archive host
 * `lists.latoolb.us` is operator-gated: it sits behind an Anubis proof-of-work
 * edge and a hard privacy pre-flight, and it is NOT public until an operator has
 * walked the go-live checklist and flipped this flag. This flag alone must never
 * be implied by preview testing (see `publicArchivePreview`).
 */
export const publicArchiveLive: boolean = parseFlag(import.meta.env.PUBLIC_ARCHIVE_LIVE);

/**
 * PUBLIC_ARCHIVE_PREVIEW surfaces the same archive feature for GATED / PREVIEW
 * testing, WITHOUT flipping the public go-live switch. DEFAULT FALSE /
 * fail-closed.
 *
 * PREVIEW is safe to enable in a deploy that is itself Access-gated: the whole
 * current Cloudflare deploy (apex / www / pages.dev) sits behind Cloudflare
 * Access, so only the authenticated operator audience can see it. Enabling this
 * lets that audience exercise the full archive flow (nav entry, archive section,
 * outbound `lists.latoolb.us` link) before the public go-live. It does NOT imply
 * the public archive is open; that remains `publicArchiveLive` only.
 */
export const publicArchivePreview: boolean = parseFlag(import.meta.env.PUBLIC_ARCHIVE_PREVIEW);

/**
 * The archive feature is visible when EITHER gate is on: the public go-live
 * (`publicArchiveLive`) or gated preview testing (`publicArchivePreview`). This
 * is the single predicate the /discuss page and the "Discuss" nav entry read.
 * Fail-closed: both default false, so the feature is hidden until one is set.
 */
export const archiveVisible: boolean = publicArchiveLive || publicArchivePreview;
