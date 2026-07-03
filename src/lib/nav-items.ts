export interface NavItem {
	label: string;
	href: string;
	/** Base-relative path patterns that light this item as the active section. */
	match: string[];
}

/**
 * Primary navigation — the single source of truth shared by the desktop
 * <nav> and the mobile drawer in +layout.svelte (DRY, mirroring
 * MassageIthaca's src/lib/nav-items.ts). The logo links home, so there is
 * no "Home" item. hrefs are base-relative; the layout prepends `base`.
 */
// Ordered as a narrative: who we are (Mission) → what's on the bus (Tools,
// Cells) → how to use it (Access, Safety) → how to give (Donate, Wants) →
// where it's going + credibility (Plans, Bibliography, Shout-outs) → reach us
// (Contact). NOTE (lane B): /stewards is intentionally NOT in the primary bar
// to avoid overstuffing — it is a footer-nav candidate (the footer lives in
// +layout.svelte, owned by lane A). Bibliography and Shout-outs are also
// footer-demotion candidates if the operator wants a leaner primary bar; both
// are flagged in the PR for operator/lane-A review.
export const navItems: NavItem[] = [
	{ label: 'Mission', href: '/mission', match: ['/mission'] },
	{ label: 'Tools', href: '/tools', match: ['/tools'] },
	{ label: 'Cells', href: '/cells', match: ['/cells', '/cell-sheets'] },
	{ label: 'Access', href: '/access', match: ['/access'] },
	{ label: 'Safety', href: '/safety', match: ['/safety'] },
	{ label: 'Donate', href: '/donate', match: ['/donate'] },
	{ label: 'Wants', href: '/wants', match: ['/wants'] },
	{ label: 'Plans', href: '/plans', match: ['/plans'] },
	{ label: 'Bibliography', href: '/bibliography', match: ['/bibliography'] },
	{ label: 'Shout-outs', href: '/shout-outs', match: ['/shout-outs'] },
	{ label: 'Contact', href: '/contact', match: ['/contact'] },
];

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
