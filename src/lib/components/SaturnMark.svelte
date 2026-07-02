<script lang="ts">
	// 7D saturn identity — small inline SVG glyph that echoes the favicon's
	// rect-saturn motif. One ring crosses the planet diagonally; warm primary
	// fill matches the omux palette. Sized via the parent (1em by default).
	let { class: extraClass = '' }: { class?: string } = $props();
</script>

<svg
	class={`inline-block align-[-0.125em] ${extraClass}`}
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	role="img"
	aria-label="Tinyland mark"
	width="1em"
	height="1em"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
>
	<!-- Planet -->
	<circle cx="12" cy="12" r="5" />
	<!-- Ring (rotated ellipse) -->
	<g transform="rotate(-22 12 12)">
		<ellipse cx="12" cy="12" rx="10.5" ry="3" stroke="currentColor" />
	</g>
</svg>
