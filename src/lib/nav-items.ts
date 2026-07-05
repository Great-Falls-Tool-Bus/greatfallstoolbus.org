// Icon vocabulary (Wave-2.5 icons, TIN-2423 PR2b): tree-shaken named imports
// from @lucide/svelte, never the barrel. Each nav item's icon is reused as the
// matching route's PageHeader icon, so the vocabulary stays curated instead of
// growing per surface.
import {
	Compass,
	Hammer,
	Boxes,
	KeyRound,
	ShieldCheck,
	Gift,
	ClipboardList,
	Map,
	MapPin,
	BookOpen,
	Megaphone,
	Mail,
	type Icon as LucideIcon,
} from '@lucide/svelte';

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
	/** Optional decorative icon, rendered beside the label in the primary bar
	 *  and mobile drawer (see +layout.svelte). Also handed to the matching
	 *  route's <PageHeader icon> so nav and page header agree. */
	icon?: typeof LucideIcon;
}

/**
 * Primary navigation — the single source of truth shared by the desktop
 * <nav>, the mobile drawer, and the footer groups in +layout.svelte (DRY,
 * mirroring MassageIthaca's src/lib/nav-items.ts). The logo links home, so
 * there is no "Home" item. hrefs are base-relative; the layout prepends
 * `base`.
 */
// Ordered as a narrative: who we are (Mission) → what's on the bus (Tools,
// Cells) → how to use it (Access, Find the bus, Safety) → how to give (Donate,
// Wants) → where it's going + credibility (Plans, Bibliography, Shout-outs) →
// reach us (Contact). `navItems` stays the single flat array (DRY); `primary`
// and `footerGroup` mark where each item renders (see `primaryNavItems` and
// `footerNavGroups` below). Primary bar: Tools, Cells, Access, Find the bus,
// Safety, Donate, Contact — the browse → use → give → reach arc a Lewiston
// neighbor actually needs. Find the bus joins the "use" cluster and lifts the
// bar to 7: "where is it?" was the single biggest gap in the borrow
// walkthrough (docs/ux-research.md line 149), and the answer is request-first
// (the bus sits at a fixed, deliberately-unpublished location shared by a
// keyholder), so the surface earns a top-tier slot rather than a footer
// demotion. Mission, Wants, Plans, Bibliography, and Shout-outs demote to
// footer groups; /stewards remains a footer-only link hard-coded in
// +layout.svelte (predates this array).
export const navItems: NavItem[] = [
	{ label: 'Mission', href: '/mission', match: ['/mission'], footerGroup: 'About', icon: Compass },
	{ label: 'Tools', href: '/tools', match: ['/tools'], primary: true, icon: Hammer },
	{ label: 'Cells', href: '/cells', match: ['/cells', '/cell-sheets'], primary: true, icon: Boxes },
	{ label: 'Access', href: '/access', match: ['/access'], primary: true, icon: KeyRound },
	{ label: 'Find the bus', href: '/find-the-bus', match: ['/find-the-bus'], primary: true, icon: MapPin },
	{ label: 'Safety', href: '/safety', match: ['/safety'], primary: true, icon: ShieldCheck },
	{ label: 'Donate', href: '/donate', match: ['/donate'], primary: true, icon: Gift },
	{ label: 'Wants', href: '/wants', match: ['/wants'], footerGroup: 'Get involved', icon: ClipboardList },
	{ label: 'Plans', href: '/plans', match: ['/plans'], footerGroup: 'About', icon: Map },
	{
		label: 'Bibliography',
		href: '/bibliography',
		match: ['/bibliography'],
		footerGroup: 'About',
		icon: BookOpen,
	},
	{ label: 'Shout-outs', href: '/shout-outs', match: ['/shout-outs'], footerGroup: 'About', icon: Megaphone },
	{ label: 'Contact', href: '/contact', match: ['/contact'], primary: true, icon: Mail },
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
