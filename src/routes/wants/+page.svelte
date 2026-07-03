<script lang="ts">
	import { base } from '$app/paths';

	const wants = [
		{
			item: 'A nice iron and ironing table',
			cell: 'Sewing cell',
			note: 'A proper tailoring iron and a stable pressing surface are the current priority gap.',
		},
		{
			item: 'Serger (Singer or Babylock class)',
			cell: 'Sewing cell',
			note: 'Overlock capability for finishing seams — the single most-requested missing machine.',
		},
	];
</script>

<svelte:head>
	<title>Wants — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="What the tool bus still needs. Current priority: pressing gear and a serger for the sewing cell."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Wants</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The honest, current list of what the bus still needs. If you have one of these gathering dust, the <a
				class="underline"
				href={`${base}/donate`}>donation criteria</a
			> tell you how to send it off well.
		</p>
	</header>

	<section class="mt-10 space-y-4">
		{#each wants as w (w.item)}
			<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
				<p class="text-surface-500 text-xs tracking-widest uppercase">{w.cell}</p>
				<h2 class="mt-1 text-lg font-semibold">{w.item}</h2>
				<p class="text-surface-700-300 mt-2 leading-relaxed">{w.note}</p>
			</div>
		{/each}
	</section>
</main>
