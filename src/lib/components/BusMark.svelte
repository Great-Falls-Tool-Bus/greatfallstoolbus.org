<script lang="ts">
	// Great Falls Tool Bus mark. Interim logo (Wikimedia Commons, CC0). A bus
	// body with windows and wheels cut as negative space. Monochrome via
	// currentColor so it inherits the warm primary. Real logo is designer-gated
	// (TIN-2419); this replaces the scaffold saturn glyph.
	//
	// `decorative` drops the img role + label when a visible Wordmark already
	// names the brand, avoiding a duplicate accessible name on the same link.
	let { class: extraClass = '', decorative = false }: { class?: string; decorative?: boolean } = $props();
</script>

<svg
	class={`inline-block align-[-0.125em] ${extraClass}`}
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 210 235"
	role={decorative ? 'presentation' : 'img'}
	aria-label={decorative ? undefined : 'Great Falls Tool Bus'}
	aria-hidden={decorative ? 'true' : undefined}
	focusable="false"
	width="1em"
	height="1em"
	fill="currentColor"
	fill-rule="evenodd"
	clip-rule="evenodd"
>
	<path
		d="M208.617 200.301l-10.0555 0 0 33.2306 -38.2585 0 0 -33.2306 -110.973 0 0 33.2306 -37.8905 0 0 -33.2306 -10.0556 0 0 -157.51c0,-14.5308 8.461,-25.0766 25.5061,-31.6367 16.4926,-6.4377 42.5497,-9.687 78.1107,-9.687 35.5609,0 61.6181,3.2493 78.1106,9.687 17.0451,6.5601 25.5061,17.1059 25.5061,31.6367l0 157.51zm-10.9137 -94.6656l0 -62.8441 -86.7556 0 0 62.8441 86.7556 0zm0.5518 71.8577c0,-3.7403 -1.2875,-6.8672 -3.8626,-9.4422 -2.5751,-2.5751 -5.7635,-3.8627 -9.4422,-3.8627 -3.6171,0 -6.744,1.2876 -9.3807,3.8627 -2.6359,2.575 -3.9234,5.7019 -3.9234,9.4422 0,3.6171 1.2875,6.6825 3.9234,9.2575 2.6367,2.5751 5.7636,3.8627 9.3807,3.8627 3.6787,0 6.8671,-1.2876 9.4422,-3.8627 2.5751,-2.575 3.8626,-5.6404 3.8626,-9.2575zm-99.2023 -71.8577l0 -62.8441 -86.7556 0 0 62.8441 86.7556 0zm61.2502 68.0559l0 -7.9092 -110.973 0 0 7.9092 110.973 0zm0 16.0023l0 -7.9092 -110.973 0 0 7.9092 110.973 0zm-121.949 -12.2005c0,-3.7403 -1.2876,-6.8672 -3.8627,-9.4422 -2.5751,-2.5751 -5.7019,-3.8627 -9.4415,-3.8627 -3.6787,0 -6.8671,1.2876 -9.4422,3.8627 -2.5751,2.575 -3.8011,5.7019 -3.8011,9.4422 0,3.6171 1.226,6.6825 3.8011,9.2575 2.5751,2.5751 5.7635,3.8627 9.4422,3.8627 3.7396,0 6.8664,-1.2876 9.4415,-3.8627 2.5751,-2.575 3.8627,-5.6404 3.8627,-9.2575z"
	/>
</svg>
