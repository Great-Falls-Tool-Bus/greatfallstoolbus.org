<script lang="ts">
	import { base } from '$app/paths';
	// The tool wants are driven by the same .svx tool tree as /tools and
	// /cell-sheets: entries with frontmatter status 'wants' land here (and
	// only here), so one tree carries the whole inventory: what is
	// on the bus and what is still missing.
	import { wants } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { ClipboardList } from '@lucide/svelte';

	// Not every want is a tool. We won the bus; now it needs people. These
	// hands-and-skills wants live here in-page (they have no place in the
	// tool tree, which resolves to real model numbers), rendered with the
	// same Card idiom so the two lists read as one page.
	const helpWanted = [
		{
			slug: 'bus-setup',
			eyebrow: 'The bus',
			title: 'Help getting the bus situated',
			body: 'We won the bus. Now it needs hands to move it, park it, and outfit the inside. Handy with any of that? A keyholder wants to hear from you.',
		},
		{
			slug: 'graphic-designer',
			eyebrow: 'Design',
			title: 'A graphic designer',
			body: 'A logo, some graphics, a palette that holds up. If you make things look right, we could use your eye.',
		},
		{
			slug: 'site-reviewers',
			eyebrow: 'Words',
			title: 'Site reviewers and writers',
			body: 'Sharp eyes for the prose, and a hand writing the manifesto. Read a page and tell us what is soft, or draft the words we are missing.',
		},
	];
</script>

<svelte:head>
	<title>Wants | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="What the tool bus still needs: tools, plus the hands and skills to run it. Current tool priority: pressing gear and a serger for the sewing cell."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader title="Wants" icon={ClipboardList}>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			What the bus still needs right now: tools, and the hands to run it. If you have a tool gathering dust, the <a
				class="underline"
				href={`${base}/donate`}>donation criteria</a
			> tell you how to send it off well; the rest of this list is people.
		</p>
	</PageHeader>

	<section class="mt-10" aria-label="Tools the kits need">
		<h2 class="text-2xl font-semibold">Tools the kits need</h2>
		<div class="mt-6 space-y-4">
			{#each wants as w (w.slug)}
				<Card eyebrow={w.cellName} title={w.name} body={w.blurb} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="mt-12" aria-label="Hands and skills">
		<h2 class="text-2xl font-semibold">Hands and skills</h2>
		<div class="mt-6 space-y-4">
			{#each helpWanted as h (h.slug)}
				<Card eyebrow={h.eyebrow} title={h.title} body={h.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="How wants get filled">
		<h2 class="text-2xl font-semibold">How a want gets filled</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			A tool-want comes off this list the same way anything joins a kit: someone donates a tool that passes the <a
				class="underline"
				href={`${base}/donate`}>donation criteria</a
			>
			(transportable, marked, repairable) and a cell captain checks it in. A hands-or-skills want comes off the moment you
			<a class="underline" href={`${base}/contact`}>reach out</a> and start.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		This list only grows shorter, with a donated tool or a spare hand.
	</footer>
</main>
