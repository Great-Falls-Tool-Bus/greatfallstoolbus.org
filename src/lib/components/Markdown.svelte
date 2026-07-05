<script lang="ts">
	// Renders operator-doc markdown through the dependency-free house renderer
	// ($lib/docs/markdown.ts) into the existing `.prose` editorial block in
	// src/app.css. The renderer HTML-escapes every text run and emits only a
	// fixed tag set, so `{@html}` here is safe (no raw doc HTML is trusted), and
	// angle-placeholders / brace tokens in the source render as literal text.
	import { renderMarkdown, type MarkdownOptions } from '$lib/docs/markdown';

	interface Props {
		/** Raw markdown source (the tracked docs/**\/*.md file). */
		source: string;
		/** Resolve relative links to canonical URLs (see makeLinkResolver). */
		resolveLink?: MarkdownOptions['resolveLink'];
	}

	let { source, resolveLink }: Props = $props();

	const html = $derived(renderMarkdown(source, { resolveLink }));
</script>

<div class="prose max-w-none">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>
