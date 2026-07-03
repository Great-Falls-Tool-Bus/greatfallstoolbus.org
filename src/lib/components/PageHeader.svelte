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
	import type { Snippet } from 'svelte';

	interface Props {
		/** Small uppercase kicker above the title (optional). */
		eyebrow?: string;
		title: string;
		/** Plain-text lead paragraph. For marked-up leads, use `children`. */
		lead?: string;
		/** Extra header content (rich lead paragraphs, etc.), rendered after the lead. */
		children?: Snippet;
	}

	let { eyebrow = '', title, lead = '', children }: Props = $props();
</script>

<header class="space-y-4">
	{#if eyebrow}
		<p class="text-surface-500 text-xs tracking-widest uppercase">{eyebrow}</p>
	{/if}
	<h1 class="text-4xl leading-tight font-bold">{title}</h1>
	{#if lead}
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">{lead}</p>
	{/if}
	{@render children?.()}
</header>
