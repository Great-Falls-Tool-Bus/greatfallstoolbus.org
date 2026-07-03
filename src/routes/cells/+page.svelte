<script lang="ts">
	// Tool cells index. A cell is the unit of the bus: a kit plus a captain who
	// knows it. Inventory truth is shared with /tools and /cell-sheets via
	// $lib/data/cells.ts so this page can never drift from the kit.
	import { cells } from '$lib/data/cells';
</script>

<svelte:head>
	<title>Tool cells — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="A tool cell is a kit plus a captain who knows it. The sewing cell is the first; yours could be next. Every cell gets a printable sheet that lives in the kit."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Tool cells</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			A tool cell is the unit the bus is organized around: <strong>a kit plus a captain who knows it</strong>. The kit
			travels as a set — bits marked, manuals linked, packed to roll. The captain is one person who knows what is in the
			kit, how it packs, and who to ask when something needs care.
		</p>
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Every cell gets a printable sheet that lives in the kit: the inventory as a checklist, the care rules, and who to
			ask. Check the kit against its sheet every time it goes out and comes back. The all-cells printable set is at
			<a class="underline" href="/cell-sheets">/cell-sheets</a>; the browsable inventory is at
			<a class="underline" href="/tools">/tools</a>.
		</p>
	</header>

	<section class="mt-10 grid gap-3 md:grid-cols-2" aria-label="The cells">
		{#each cells as cell (cell.slug)}
			<a
				class="border-surface-200-800 bg-surface-50-950/75 hover:border-primary-500 block rounded-lg border p-5 transition-colors"
				href={'/cells/' + cell.slug}
			>
				<p class="text-surface-500 text-xs tracking-widest uppercase">Cell</p>
				<h2 class="mt-1 text-lg font-semibold">{cell.name}</h2>
				<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">
					{cell.tools.length} tools, kitted and documented.
					{#if cell.captain}
						Captain: {cell.captain}.
					{:else}
						Captain: still needed — it could be you.
					{/if}
				</p>
				<p class="text-primary-600 mt-3 text-sm font-semibold">Printable cell sheet →</p>
			</a>
		{/each}

		<div class="border-surface-200-800 bg-surface-50-950/40 rounded-lg border border-dashed p-5">
			<p class="text-surface-500 text-xs tracking-widest uppercase">Your cell here</p>
			<h2 class="mt-1 text-lg font-semibold">Start the next cell</h2>
			<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">
				Got a serious tool that is hard to own alone — and the patience to be the person who knows it? Bring the kit, be
				the captain. The <a class="underline" href="/donate">donation criteria</a> tell you what makes a good bus tool,
				and the <a class="underline" href="/wants">wants list</a> shows the gaps.
			</p>
		</div>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		One person per cell who knows the kit — that is the whole job description. Reach out, a keyholder answers.
	</footer>
</main>
