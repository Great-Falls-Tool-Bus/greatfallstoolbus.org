<script lang="ts">
	import { base } from '$app/paths';
	// The wants list is driven by the same .svx tool tree as /tools and
	// /cell-sheets: entries with frontmatter status 'wants' land here (and
	// only here), so one tree carries the whole honest inventory — what is
	// on the bus and what is still missing.
	import { wants } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
</script>

<svelte:head>
	<title>Wants — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="What the tool bus still needs. Current priority: pressing gear and a serger for the sewing cell."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader title="Wants">
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			The honest, current list of what the bus still needs. If you have one of these gathering dust, the <a
				class="underline"
				href={`${base}/donate`}>donation criteria</a
			> tell you how to send it off well.
		</p>
	</PageHeader>

	<section class="mt-10 space-y-4">
		{#each wants as w (w.slug)}
			<Card eyebrow={w.cellName} title={w.name} body={w.blurb} headingLevel="h2" />
		{/each}
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="How wants get filled">
		<h2 class="text-2xl font-semibold">How a want gets filled</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			A want comes off this list the same way anything joins a kit: someone donates a tool that passes the <a
				class="underline"
				href={`${base}/donate`}>donation criteria</a
			>
			— transportable, marked, repairable — and a cell captain checks it in. See
			<a class="underline" href={`${base}/donate`}>donate a tool</a> for what makes a good fit, or reach out if you are not
			sure.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		This list only grows shorter with donations — nothing here is invented or aspirational padding.
	</footer>
</main>
