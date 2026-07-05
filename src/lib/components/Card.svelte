<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// DRY surface card: the `border-surface-200-800 bg-surface-50-950/75 border`
	// panel that every route hand-inlined for page links, checklist items,
	// bibliography entries, and cell tiles. Extracted so the panel chrome is
	// defined once. Corners are sharp (no radius utility) to match the
	// homogeneous zero-radius house treatment; the translucent glass fill
	// (bg-surface-50-950/75) is an intentional, featured effect and stays. Color
	// pairs (surface/primary) already flow through the omux palette.
	//
	// Two shapes in one component:
	//   • static panel   → renders a <div>
	//   • whole-card link → pass `href`, renders a hover-lit <a>
	// The title can itself be a link (`titleHref`, e.g. external bibliography
	// citations) while the card stays a <div>. Rich bodies (inline links,
	// <strong>, CTA lines) go through the `children` snippet.
	//
	// Typed `interface Props` + `$props()` with literal defaults + `$derived`
	// class composition, per the SEOHead (TIN-2225) house-canon rune shape.
	import type { Snippet } from 'svelte';

	interface Props {
		/** Small uppercase kicker above the title (optional). */
		eyebrow?: string;
		title?: string;
		/** When set, the title itself is a link (card stays a <div>). */
		titleHref?: string;
		/** Adds rel="external noopener" to `titleHref`. */
		external?: boolean;
		/** Muted meta line between title and body (e.g. citation author/venue). */
		meta?: string;
		/** Plain-text body. For marked-up bodies, use `children`. */
		body?: string;
		/** When set, the whole card is a link and lights on hover. */
		href?: string;
		/** Heading element for the title. 'none' renders a bold link/text (no landmark heading). */
		headingLevel?: 'h2' | 'h3' | 'none';
		/** Tighter padding (p-4) for dense lists like the bibliography. */
		compact?: boolean;
		/** Dashed "empty slot" variant (e.g. start-the-next-cell). */
		dashed?: boolean;
		/** Optional left-column visual rendered beside the text (e.g. an <Avatar/>). */
		lead?: Snippet;
		children?: Snippet;
	}

	let {
		eyebrow = '',
		title = '',
		titleHref = '',
		external = false,
		meta = '',
		body = '',
		href = '',
		headingLevel = 'h3',
		compact = false,
		dashed = false,
		lead,
		children,
	}: Props = $props();

	const cardClass = $derived.by(() => {
		const parts = [
			'border-surface-200-800 border',
			compact ? 'p-4' : 'p-5',
			dashed ? 'bg-surface-50-950/40 border-dashed' : 'bg-surface-50-950/75',
		];
		if (href) parts.push('hover:border-primary-500 block transition-colors');
		return parts.join(' ');
	});

	const titleMt = $derived(eyebrow ? 'mt-1' : '');
	const linkLabel = $derived(title || eyebrow || meta || body || 'Open linked card');
</script>

{#snippet inner()}
	{#if eyebrow}
		<p class="text-surface-500 text-xs tracking-widest uppercase">{eyebrow}</p>
	{/if}
	{#if title}
		{#if titleHref}
			<a
				class="hover:text-primary-600 font-semibold underline-offset-2 hover:underline {titleMt}"
				href={titleHref}
				rel={external ? 'external noopener' : undefined}
				aria-label={title}
			>
				{title}
			</a>
		{:else if headingLevel === 'h2'}
			<h2 class="text-lg font-semibold {titleMt}">{title}</h2>
		{:else if headingLevel === 'h3'}
			<h3 class="text-lg font-semibold {titleMt}">{title}</h3>
		{:else}
			<p class="text-lg font-semibold {titleMt}">{title}</p>
		{/if}
	{/if}
	{#if meta}
		<p class="text-surface-500 mt-1 text-xs">{meta}</p>
	{/if}
	{#if body}
		<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">{body}</p>
	{/if}
	{@render children?.()}
{/snippet}

{#snippet framed()}
	{#if lead}
		<div class="flex items-start gap-3">
			<div class="shrink-0">{@render lead()}</div>
			<div class="min-w-0 flex-1">{@render inner()}</div>
		</div>
	{:else}
		{@render inner()}
	{/if}
{/snippet}

{#if href}
	<a class={cardClass} {href} aria-label={linkLabel}>
		{@render framed()}
	</a>
{:else}
	<div class={cardClass}>
		{@render framed()}
	</div>
{/if}
