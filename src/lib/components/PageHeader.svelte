<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// DRY page header: the eyebrow → h1 → lead block that every route hand-inlined
	// (see the pre-uplift +page.svelte headers on /donate, /wants, /plans, …).
	// Extracted so the visual hierarchy is defined once and the theme flows
	// through the surface/primary tokens — sharp radius, serif display, and
	// warm palette are all lane-A theme concerns that reach this component via
	// the same Skeleton color-pair utilities the rest of the site uses.
	//
	// Typed `interface Props` + `$props()` with literal defaults, per the SEOHead
	// (TIN-2225) house-canon rune shape. Rich leads (inline links / <strong>) are
	// passed through the `children` snippet, which renders after the title so a
	// page keeps full control of marked-up copy.
	//
	// Git-onboarding affordance (TIN-2360 view/edit source subsystem): every page
	// that renders PageHeader gets the "View source" / "Edit this page" pair for
	// free via SourceLink, enforced from architectural zero (no per-page opt-in).
	// PageHeader learns its own route from `page` (same base-stripped pathname the
	// layout derives) and hands the route id to SourceLink, which renders nothing
	// for routes absent from the generated source map.
	import type { Snippet } from 'svelte';
	import type { Icon as LucideIcon } from '@lucide/svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import SourceLink from '$lib/components/SourceLink.svelte';

	interface Props {
		/** Small uppercase kicker above the title (optional). */
		eyebrow?: string;
		title: string;
		/** Plain-text lead paragraph. For marked-up leads, use `children`. */
		lead?: string;
		/** Optional decorative icon rendered beside the title (Wave-2.5 icons,
		 *  TIN-2423 PR2b). Pass a named `@lucide/svelte` import, e.g. `Hammer`. */
		icon?: typeof LucideIcon;
		/** Extra header content (rich lead paragraphs, etc.), rendered after the lead. */
		children?: Snippet;
	}

	let { eyebrow = '', title, lead = '', icon: Icon, children }: Props = $props();

	const routeId = $derived(page.url.pathname.slice(base.length) || '/');
</script>

<header class="space-y-4">
	{#if eyebrow}
		<p class="text-surface-500 text-xs tracking-widest uppercase">{eyebrow}</p>
	{/if}
	<h1 class="flex items-center gap-3 text-4xl leading-tight font-bold">
		{#if Icon}
			<Icon class="text-primary-500 h-8 w-8 shrink-0" aria-hidden="true" />
		{/if}
		{title}
	</h1>
	{#if lead}
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">{lead}</p>
	{/if}
	{@render children?.()}
	<SourceLink {routeId} />
</header>
