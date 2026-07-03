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
export const navItems: NavItem[] = [
	{ label: 'Tools', href: '/tools', match: ['/tools'] },
	{ label: 'Donate', href: '/donate', match: ['/donate'] },
	{ label: 'Wants', href: '/wants', match: ['/wants'] },
	{ label: 'Cells', href: '/cells', match: ['/cells', '/cell-sheets'] },
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
