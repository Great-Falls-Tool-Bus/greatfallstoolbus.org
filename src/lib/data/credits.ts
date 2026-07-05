// Photo credits + license ledger for the site's content imagery.
//
// ── IMAGE LICENSE POLICY (read before adding any photo) ──────────────────────
// Every image committed under static/photos/** MUST be one of:
//   1. CC0 / public-domain-dedicated (cleanest — no attribution obligation),
//   2. genuinely public domain (e.g. a pre-1929 US publication), or
//   3. a photo the contributor took themselves and is willing to license for
//      public use on this site.
// Unsplash images are allowed ONLY via the manual download-and-commit path
// (their Standard License permits it and is attribution-free), never hotlinked.
// A credits entry is still required so the source stays auditable.
//
// NEVER: hotlink an image from another site (breaks the CSP + the "static, no
// third-party requests" posture), pass an AI-generated image off as a real
// photo, or commit copyrighted stock / a "found on the web" image whose license
// you cannot name. When in doubt, leave the tool's `detailsWanted: ['photo']`
// flag in place — an honest gap beats an unlicensed image.
//
// Attribution is not legally required for CC0 / public-domain work, but we
// record author + source for every image anyway: it keeps licensing auditable
// and it is courteous practice. See docs/contributing-photos.md for the
// keyholder walkthrough and docs/attribution.md for the logo marks.

/** One recorded image source. Keyed in CREDITS by its manifest key. */
export interface ImageCredit {
	/** Public asset path, e.g. "/photos/hand-tools-plate-1922.jpg". */
	src: string;
	/** Short human title for the image. */
	title: string;
	/** Author / creator, or "Unknown" when the source names none. */
	author: string;
	/** Canonical source page the asset was downloaded from. */
	source: string;
	/** Direct asset URL that was actually downloaded and committed. */
	assetUrl?: string;
	/** Human-readable license, e.g. "Public domain", "CC0", "Unsplash License". */
	license: string;
	/** License deed / terms URL, when one exists. */
	licenseUrl?: string;
	/** Optional provenance note (year, verification, why it fits). */
	note?: string;
}

/**
 * Credits keyed by manifest key — the static-relative path without the leading
 * slash and without the extension (e.g. "photos/hand-tools-plate-1922"), the
 * same key `$lib/responsive-image` derives from an image `src`. Use
 * `creditFor(src)` to resolve an entry from a public path.
 */
export const CREDITS: Record<string, ImageCredit> = {
	'photos/hand-tools-plate-1922': {
		src: '/photos/hand-tools-plate-1922.jpg',
		title: 'Plate of woodworking hand tools',
		author: 'Louis M. Roehl (1881–), "Manual Training for the Rural Schools"',
		source:
			'https://commons.wikimedia.org/wiki/File:Manual_training_for_the_rural_schools;_a_group_of_farm_and_farm_home_woodworking_problems_(1922)_(14781178044).jpg',
		assetUrl:
			'https://upload.wikimedia.org/wikipedia/commons/f/f8/Manual_training_for_the_rural_schools%3B_a_group_of_farm_and_farm_home_woodworking_problems_%281922%29_%2814781178044%29.jpg',
		license: 'Public domain (no known copyright restrictions)',
		licenseUrl: 'https://www.flickr.com/commons/usage/',
		note: 'Published 1922, public domain in the US. Verified via the Wikimedia Commons imageinfo API (extmetadata LicenseShortName: "No restrictions") on 2026-07-04. A labeled engraving of the hand tools the bus lends; no identifiable people.',
	},
};

/**
 * Normalize a public image path to a CREDITS key and resolve its entry, or
 * `undefined` when the image has no recorded credit. Mirrors the manifest-key
 * normalization in `$lib/responsive-image`.
 */
export function creditFor(src: string | undefined | null): ImageCredit | undefined {
	if (!src) return undefined;
	const key = src.replace(/^\//, '').replace(/\.(webp|avif|png|jpe?g|svg)$/i, '');
	return CREDITS[key];
}
