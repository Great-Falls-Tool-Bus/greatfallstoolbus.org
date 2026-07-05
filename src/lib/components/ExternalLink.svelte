<script lang="ts">
	// ── HOUSE CANON IDIOM ──────────────────────────────────────────────────────
	// The outbound-link affordance. Consolidates the hand-inlined
	// `<a target="_blank" rel="...">` anchors scattered across the layout footer,
	// /mission, and /shout-outs into one component, and unifies their rel/target
	// /a11y with the SourceLink + Card.external conventions (the Lane-D DRY item,
	// folded into this Wave-3 pass). Quiet-Devtool mark: a small monospace [↗]
	// that reads as "this leaves the site", not decoration. The mark is
	// aria-hidden; a visually-hidden "(opens in a new tab)" carries the meaning to
	// assistive tech. In print the mark is dropped and the URL is expanded after
	// the text (see the @media print block in src/app.css).
	import type { Snippet } from 'svelte';

	interface Props {
		href: string;
		/** Untrusted outbound target → rel gains 'external'. Default true. */
		external?: boolean;
		/** Render the [↗] leaves-site mark. Default true. */
		mark?: boolean;
		class?: string;
		/** Overrides the accessible name (else the link text is used). */
		label?: string;
		children: Snippet;
	}

	let { href, external = true, mark = true, class: klass = '', label, children }: Props = $props();

	const rel = $derived(external ? 'external noopener noreferrer' : 'noopener noreferrer');
</script>

<a {href} target="_blank" {rel} class="external-link {klass}" aria-label={label}
	>{@render children()}{#if mark}<span class="external-link__mark" aria-hidden="true">[↗]</span><span class="sr-only">
			(opens in a new tab)</span
		>{/if}</a
>
