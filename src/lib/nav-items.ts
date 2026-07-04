export interface NavItem {
	label: string;
	href: string;
	/** Base-relative path patterns that light this item as the active section. */
	match: string[];
	/** Rendered in the primary AppBar bar + mobile drawer top. Kept to ≤6 items
	 *  (lane B nav-regroup) so the bar reads as navigation, not a sitemap. */
	primary?: boolean;
	/** When not `primary`, which footer group this item is demoted into.
	 *  Rendered by the footer in +layout.svelte. */
	footerGroup?: 'About' | 'Get involved';
}

/**
 * Primary navigation — the single source of truth shared by the desktop
 * <nav>, the mobile drawer, and the footer groups in +layout.svelte (DRY,
 * mirroring MassageIthaca's src/lib/nav-items.ts). The logo links home, so
 * there is no "Home" item. hrefs are base-relative; the layout prepends
 * `base`.
 */
// Ordered as a narrative: who we are (Mission) → what's on the bus (Tools,
// Cells) → how to use it (Access, Safety) → how to give (Donate, Wants) →
// where it's going + credibility (Plans, Bibliography, Shout-outs) → reach us
// (Contact). `navItems` stays the single flat array (DRY); `primary` and
// `footerGroup` mark where each item renders (see `primaryNavItems` and
// `footerNavGroups` below). Primary bar: Tools, Cells, Access, Safety, Donate,
// Contact — the browse → use → give → reach arc a Lewiston neighbor actually
// needs (≤6 items, lane B nav-regroup). Mission, Wants, Plans, Bibliography,
// and Shout-outs demote to footer groups; /stewards remains a footer-only
// link hard-coded in +layout.svelte (predates this array).
export const navItems: NavItem[] = [
	{ label: 'Mission', href: '/mission', match: ['/mission'], footerGroup: 'About' },
	{ label: 'Tools', href: '/tools', match: ['/tools'], primary: true },
	{ label: 'Cells', href: '/cells', match: ['/cells', '/cell-sheets'], primary: true },
	{ label: 'Access', href: '/access', match: ['/access'], primary: true },
	{ label: 'Safety', href: '/safety', match: ['/safety'], primary: true },
	{ label: 'Donate', href: '/donate', match: ['/donate'], primary: true },
	{ label: 'Wants', href: '/wants', match: ['/wants'], footerGroup: 'Get involved' },
	{ label: 'Plans', href: '/plans', match: ['/plans'], footerGroup: 'About' },
	{ label: 'Bibliography', href: '/bibliography', match: ['/bibliography'], footerGroup: 'About' },
	{ label: 'Shout-outs', href: '/shout-outs', match: ['/shout-outs'], footerGroup: 'About' },
	{ label: 'Contact', href: '/contact', match: ['/contact'], primary: true },
];

/** Primary AppBar bar + mobile drawer top — derived, never hand-duplicated. */
export const primaryNavItems: NavItem[] = navItems.filter((item) => item.primary);

/** Footer-demoted items, grouped in `navItems` order within each group. */
export const footerNavGroups: Array<{ heading: string; items: NavItem[] }> = (['About', 'Get involved'] as const).map(
	(heading) => ({
		heading,
		items: navItems.filter((item) => item.footerGroup === heading),
	}),
);

/**
 * True when `pathname` (already base-stripped, "/" for root) is at or under
 * any of `patterns`. Exact for "/", prefix for everything else.
 */
export const isActivePath = (pathname: string, patterns: string[]): boolean => {
	for (const pattern of patterns) {
		if (pattern === '/') {
			if (pathname === '/') return true;
		} else if (pathname === pattern || pathname.startsWith(pattern + '/')) {
			return true;
		}
	}
	return false;
};
