<script lang="ts">
	import { base } from '$app/paths';
	// Inventory truth is the .svx tool tree at src/content/tools/**, globbed
	// at build time by $lib/data/cells.ts and shared with the printable
	// /cell-sheets route and the /wants gap list, so the web page, the
	// pinned-to-a-board sheet, and the wants list can never drift apart.
	// Inventory doctrine + the transfemme-tailoring citation-table pointer
	// live in the cells.ts header. Validate the tree with `just tools-validate`.
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
				{#each cell.tools as tool (tool.slug)}
					<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
						<h3 class="font-semibold">{tool.name}</h3>
						<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
							{tool.blurb}
							{#if tool.docUrl}
								<a class="underline" href={tool.docUrl} rel="external noopener">{tool.docLabel}</a>
							{/if}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	<footer class="text-surface-500 pt-12 text-sm">
		Missing something? See the <a class="underline" href={`${base}/wants`}>wants list</a> or
		<a class="underline" href={`${base}/donate`}>donate a tool</a>. Want this on paper? Every cell has a
		<a class="underline" href={`${base}/cell-sheets`}>printable cell sheet</a>.
	</footer>
</main>
