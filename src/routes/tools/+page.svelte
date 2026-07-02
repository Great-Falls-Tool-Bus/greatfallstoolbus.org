<script lang="ts">
	// Inventory truth lives in $lib/data/cells.ts, shared with the printable
	// /cell-sheets route so the web page and the pinned-to-a-board sheet can
	// never drift apart.
	import { cells } from '$lib/data/cells';
</script>

<svelte:head>
	<title>Tools on the bus — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="The tool bus inventory: what we have, kitted for transport, bits marked, with model numbers and manuals as they are resolved."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Tools on the bus</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			Every tool on the bus is kitted for transport, its bits are marked as part of a set, and its documentation
			resolves to a real model number with a manufacturer manual or datasheet — or it is honestly listed below as
			not-yet-resolved. Photos and per-tool pages are coming as the inventory pipeline lands.
		</p>
	</header>

	{#each cells as cell (cell.slug)}
		<section class="mt-10" aria-label={cell.name}>
			<h2 class="text-2xl font-semibold">{cell.name}</h2>
			<div class="mt-6 space-y-3">
				{#each cell.tools as tool (tool.item)}
					<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
						<h3 class="font-semibold">{tool.item}</h3>
						<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
							{tool.status}
							{#if tool.doc}
								<a class="underline" href={tool.doc} rel="external noopener">{tool.docLabel}</a>
							{/if}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	<footer class="text-surface-500 pt-12 text-sm">
		Missing something? See the <a class="underline" href="/wants">wants list</a> or
		<a class="underline" href="/donate">donate a tool</a>. Want this on paper? Every cell has a
		<a class="underline" href="/cell-sheets">printable cell sheet</a>.
	</footer>
</main>
