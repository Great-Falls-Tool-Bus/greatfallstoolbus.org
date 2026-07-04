<script lang="ts">
	// Tool cells index. A cell is the unit of the bus: a kit plus a captain who
	// knows it. Inventory truth is shared with /tools and /cell-sheets via
	// $lib/data/cells.ts so this page can never drift from the kit.
	import { base } from '$app/paths';
	import { cells } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
</script>

<svelte:head>
	<title>Tool cells | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="A tool cell is a kit plus a captain who knows it. The sewing cell is the first; yours could be next. Every cell gets a printable sheet that lives in the kit."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader title="Tool cells">
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			A tool cell is the unit the bus is organized around: <strong>a kit plus a captain who knows it</strong>. The kit
			travels as a set, bits marked, manuals linked, packed to roll. The captain is one person who knows what is in the
			kit, how it packs, and who to ask when something needs care.
		</p>
		<p class="text-surface-700 dark:text-surface-300 leading-relaxed">
			Every cell gets a printable sheet that lives in the kit: the inventory as a checklist, the care rules, and who to
			ask. Check the kit against its sheet every time it goes out and comes back. The all-cells printable set is at
			<a class="underline" href={`${base}/cell-sheets`}>/cell-sheets</a>; the browsable inventory is at
			<a class="underline" href={`${base}/tools`}>/tools</a>.
		</p>
	</PageHeader>

	<section class="mt-10 grid gap-3 md:grid-cols-2" aria-label="The cells">
		{#each cells as cell (cell.slug)}
			<Card href={`${base}/cells/${cell.slug}`} eyebrow="Cell" title={cell.name} headingLevel="h2">
				<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">
					{cell.tools.length} tools, kitted and documented.
					{#if cell.captain}
						Captain: {cell.captain}.
					{:else}
						Captain: still needed. It could be you.
					{/if}
				</p>
				<p class="text-primary-600 mt-3 text-sm font-semibold">Printable cell sheet →</p>
			</Card>
		{/each}

		<Card dashed eyebrow="Your cell here" title="Start the next cell" headingLevel="h2">
			<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">
				Got a serious tool that is hard to own alone, and the patience to be the person who knows it? Bring the kit, be
				the captain. The <a class="underline" href={`${base}/donate`}>donation criteria</a> tell you what makes a good
				bus tool, and the <a class="underline" href={`${base}/wants`}>wants list</a> shows the gaps.
			</p>
		</Card>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		One person per cell who knows the kit: that is the whole job description. Ask a keyholder to get started.
	</footer>
</main>
