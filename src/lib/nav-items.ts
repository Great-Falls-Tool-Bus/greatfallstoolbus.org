// Single source of truth for nav — shared by the desktop <nav>, the mobile
// drawer, and the footer groups in +layout.svelte.
//
// Single-product history (L72 Q3-A, 2026-08-21): every legacy marketing-tree
// nav item (Mission, Tools, Cells, Safety, Donate, Wants, Keyholders,
// Bibliography, Shout-outs, Get access/Contact, Discuss) is deleted along with
// its route. `greatfallstoolbus.org` is now the member-tree entry surface
// (ADR 0014 §1); the public information site moves to `gftb-site`.
//
// `navItems` is intentionally empty pending real member-tree navigation
// (apply/review/home/membership/contribution/login as those slices land).
// `/apply` itself is deliberately NOT added here: it ships `noindex` and
// "not linked from navigation" by its own launch-gate design
// (src/routes/apply/+page.svelte) while intake stays closed; the entry page
// links to it directly instead of promoting it to the nav bar.
export interface NavItem {
	label: string;
	href: string;
	/** Base-relative path patterns that light this item as the active section. */
	match: string[];
	/** Rendered in the primary AppBar bar + mobile drawer top. Kept to ≤6 items
	 *  so the bar reads as navigation, not a sitemap. */
	primary?: boolean;
	/** When not `primary`, which footer group this item is demoted into.
	 *  Rendered by the footer in +layout.svelte. */
	footerGroup?: 'About' | 'Get involved';
}

export const navItems: NavItem[] = [];

/** Primary AppBar bar + mobile drawer top — derived, never hand-duplicated. */
export const primaryNavItems: NavItem[] = navItems.filter((item) => item.primary);

/** Footer-demoted items, grouped in `navItems` order within each group. Groups
 *  with zero items are dropped so the footer never renders an empty heading. */
export const footerNavGroups: Array<{ heading: string; items: NavItem[] }> = (['About', 'Get involved'] as const)
	.map((heading) => ({
		heading,
		items: navItems.filter((item) => item.footerGroup === heading),
	}))
	.filter((group) => group.items.length > 0);

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
