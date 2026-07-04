<script lang="ts">
	// Manifest-driven responsive <picture> (Wave-2.5 media pipeline).
	//
	// Resolves `src` against static/image-manifest.json via the
	// responsive-image helper. When the optimize pipeline has emitted
	// derivatives, renders typed AVIF/WebP <source> sets; the <img> always
	// falls back to the original asset. When the manifest lacks an entry
	// (zero-photo builds ship a committed empty manifest), it degrades to a
	// plain <img> so nothing breaks.
	//
	// CLS: when the manifest knows the intrinsic size, width/height
	// attributes plus an explicit aspect-ratio reserve the box before the
	// bytes arrive.
	//
	// Typed `interface Props` + `$props()` with literal defaults + `$derived`,
	// per the SEOHead/Card house-canon rune shape.
	import { intrinsicSize, responsiveSources } from '$lib/responsive-image';

	interface Props {
		/** Public asset path, e.g. "/photos/bus-front.jpg". */
		src: string;
		alt: string;
		/** `sizes` attribute for the responsive sources. */
		sizes?: string;
		loading?: 'lazy' | 'eager';
		/** Hint paired with `loading`; eager images decode sync by default. */
		decoding?: 'async' | 'sync' | 'auto';
		/** Classes applied to the <img> element. */
		class?: string;
	}

	let { src, alt, sizes = '100vw', loading = 'lazy', decoding = 'async', class: imgClass = '' }: Props = $props();

	const sources = $derived(responsiveSources(src));
	const size = $derived(intrinsicSize(src));
	const aspectStyle = $derived(size ? `aspect-ratio: ${size.width} / ${size.height};` : undefined);
</script>

{#if sources.hasSources}
	<picture>
		{#if sources.avif}
			<source type="image/avif" srcset={sources.avif} {sizes} />
		{/if}
		{#if sources.webp}
			<source type="image/webp" srcset={sources.webp} {sizes} />
		{/if}
		<img
			src={sources.fallback}
			{alt}
			{loading}
			{decoding}
			width={size?.width}
			height={size?.height}
			style={aspectStyle}
			class={imgClass}
		/>
	</picture>
{:else}
	<img
		src={sources.fallback}
		{alt}
		{loading}
		{decoding}
		width={size?.width}
		height={size?.height}
		style={aspectStyle}
		class={imgClass}
	/>
{/if}
