<script lang="ts">
	// Inventory doctrine: every entry eventually resolves to a real model number
	// with a manufacturer manual or datasheet link. Entries still awaiting
	// operator-mediated identification are shown as unresolved — no invented
	// product names, ever. (Resolution method owned by the tailoring manifest
	// lane; see docs/decisions/0001-gftb-mvp-decisions.md.)
	const sewingCell = {
		resolved: [
			{
				item: 'Treadle Singer sewing machine (1800s)',
				status: 'Restoration in progress — honestly framed: not yet a working machine.',
			},
			{ item: 'Singer sewing machine oil', status: 'In kit. Oil only, never grease.' },
			{ item: 'Small cutting surface', status: 'In kit.' },
			{ item: 'Small handheld rotary cutter', status: 'In kit.' },
		],
		unresolved: ['B0D22F8JRC', 'B09V93QPB4', 'B09Y5B66R8', 'B0F9KNZ39G', 'B0F1TD3LYG'],
	};
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

	<section class="mt-10" aria-label="Sewing cell">
		<h2 class="text-2xl font-semibold">Sewing cell</h2>
		<div class="mt-6 space-y-3">
			{#each sewingCell.resolved as tool (tool.item)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-4">
					<h3 class="font-semibold">{tool.item}</h3>
					<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">{tool.status}</p>
				</div>
			{/each}
		</div>

		<div class="border-surface-200-800 mt-6 rounded-lg border border-dashed p-4">
			<h3 class="font-semibold">Awaiting identification ({sewingCell.unresolved.length})</h3>
			<p class="text-surface-700-300 mt-1 text-sm leading-relaxed">
				Five purchased kit items are catalogued only by order reference so far. Each will be resolved to its real model
				number, manual, and datasheet before it gets a name here — we do not guess.
			</p>
			<ul class="text-surface-500 mt-3 flex flex-wrap gap-2 font-mono text-xs">
				{#each sewingCell.unresolved as asin (asin)}
					<li class="border-surface-200-800 rounded border px-2 py-1">{asin}</li>
				{/each}
			</ul>
		</div>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		Missing something? See the <a class="underline" href="/wants">wants list</a> or
		<a class="underline" href="/donate">donate a tool</a>.
	</footer>
</main>
