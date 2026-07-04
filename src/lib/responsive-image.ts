/**
 * Responsive image helper (Wave-2.5 media pipeline).
 *
 * Backfeed of MassageIthaca's proven srcset builder, adapted to this spoke.
 * Consumes the build-generated `static/image-manifest.json` (produced by
 * `scripts/optimize-images.js`) and turns a single image `src` into ordered
 * `srcset` strings per format, so components can ship right-sized derivatives
 * instead of multi-megabyte originals.
 *
 * This is intentionally thin: it does NOT invent sizes or paths. It only
 * reads the derivatives the optimize pipeline already emitted. If an image
 * is missing from the manifest, the raw `src` still works as the fallback,
 * so a zero-photo build (committed empty manifest) degrades gracefully.
 */
import manifest from '../../static/image-manifest.json';

// Width descriptors for the named derivative sizes. These MUST stay in sync
// with the SIZES map in scripts/optimize-images.js. They are the intrinsic
// widths sharp resized each derivative to.
const SIZE_WIDTHS: Record<string, number> = {
	thumbnail: 150,
	small: 400,
	medium: 800,
	large: 1200,
	xlarge: 1920,
};

type FormatVariants = Partial<Record<string, string>>;

export type ManifestEntry = {
	type: 'raster' | 'vector';
	original: string;
	/** Intrinsic pixel width of the source asset (rasters; CLS sizing). */
	width?: number;
	/** Intrinsic pixel height of the source asset (rasters; CLS sizing). */
	height?: number;
	optimized: Partial<Record<'webp' | 'avif', FormatVariants>> & {
		svg?: string;
	};
};

const MANIFEST = manifest as Record<string, ManifestEntry>;

// The smallest derivative width at which responsive delivery is worthwhile.
// If the manifest only carries thumbnail/small variants for an image, the
// original is already lightweight and offering a tiny srcset would risk the
// browser DOWNGRADING a sharper original on hi-DPI displays. So we only opt
// an image into <picture>/srcset when a `medium` (800w) or larger variant
// exists.
const MIN_RESPONSIVE_WIDTH = SIZE_WIDTHS.medium; // 800

/**
 * Normalize a public image path to a manifest key.
 * Manifest keys are the static-relative path without leading slash and
 * without extension, e.g. "/photos/bus-front.jpg" -> "photos/bus-front".
 */
function manifestKey(src: string): string {
	return src.replace(/^\//, '').replace(/\.(webp|avif|png|jpe?g|svg)$/i, '');
}

/**
 * Build an ordered `srcset` string for a given format from the manifest, or
 * undefined if that format has no derivatives worth serving for this image.
 *
 * Derivatives are emitted in ascending width order. When the largest variant
 * is the `xlarge` (1920w) bucket AND a format-matching original is supplied,
 * the original is appended as a final, larger candidate so hi-DPI displays
 * are never capped below the full-size asset. The optimize pipeline only
 * produces an xlarge bucket when the original is at least 1920px wide, so
 * the original is genuinely larger.
 *
 * `formatOriginal` MUST be the same image format as `variants` (only pass a
 * `.webp` original for the webp srcset) so a typed <source> never points at
 * a mismatched encoding. Pass undefined to omit the cap.
 */
function srcsetForFormat(variants: FormatVariants | undefined, formatOriginal: string | undefined): string | undefined {
	if (!variants) return undefined;

	const entries = Object.entries(variants)
		.map(([sizeName, url]) => ({ url, width: SIZE_WIDTHS[sizeName] }))
		.filter((e): e is { url: string; width: number } => typeof e.url === 'string' && typeof e.width === 'number')
		.sort((a, b) => a.width - b.width);

	if (entries.length === 0) return undefined;

	const largest = entries[entries.length - 1].width;

	// Skip srcset entirely for images whose biggest derivative is still small.
	// The original is already lightweight and a tiny srcset could downgrade it.
	if (largest < MIN_RESPONSIVE_WIDTH) return undefined;

	const parts = entries.map((e) => `${e.url} ${e.width}w`);

	// Cap retina with the format-matching original when derivatives top out at
	// xlarge. Only applies when the original asset is itself webp; avif tops
	// out at its 1920w derivative, which is already ample for hi-DPI.
	if (largest === SIZE_WIDTHS.xlarge && formatOriginal) {
		parts.push(`${formatOriginal} ${SIZE_WIDTHS.xlarge * 2}w`);
	}

	return parts.join(', ');
}

export interface ResponsiveSources {
	/** Ordered AVIF srcset, if derivatives exist. */
	avif?: string;
	/** Ordered WebP srcset, if derivatives exist. */
	webp?: string;
	/** Original full-size src, always the safe fallback for the <img>. */
	fallback: string;
	/** Intrinsic width of the original asset, when the manifest knows it. */
	width?: number;
	/** Intrinsic height of the original asset, when the manifest knows it. */
	height?: number;
	/** True when at least one optimized srcset is available. */
	hasSources: boolean;
}

/**
 * Resolve responsive `<picture>` sources for an image `src`.
 *
 * @param src public path (e.g. "photos/bus-front.jpg" or "/photos/bus-front.jpg").
 *   Leading slash optional. Falsy input yields an empty, source-less result so
 *   callers can pass possibly-undefined union fields.
 */
export function responsiveSources(src: string | undefined | null): ResponsiveSources {
	if (!src) return { fallback: '', hasSources: false };

	const fallback = src.startsWith('/') ? src : `/${src}`;
	const entry = MANIFEST[manifestKey(src)];

	if (!entry) {
		return { fallback, hasSources: false };
	}

	// A webp original is the only format-matching original that can safely cap
	// the webp srcset. jpg/png originals never cap a typed <source>.
	const webpOriginal = /\.webp$/i.test(entry.original) ? entry.original : undefined;
	const avif = srcsetForFormat(entry.optimized.avif, undefined);
	const webp = srcsetForFormat(entry.optimized.webp, webpOriginal);

	return {
		avif,
		webp,
		fallback,
		width: entry.width,
		height: entry.height,
		hasSources: Boolean(avif || webp),
	};
}

/**
 * Intrinsic pixel size of an image, when the manifest carries it.
 * Used by Picture.svelte to set width/height + aspect-ratio and kill CLS.
 */
export function intrinsicSize(src: string | undefined | null): { width: number; height: number } | undefined {
	if (!src) return undefined;
	const entry = MANIFEST[manifestKey(src)];
	if (!entry || typeof entry.width !== 'number' || typeof entry.height !== 'number') {
		return undefined;
	}
	return { width: entry.width, height: entry.height };
}
