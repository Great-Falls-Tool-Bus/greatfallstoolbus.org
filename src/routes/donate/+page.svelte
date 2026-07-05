<script lang="ts">
	import { base } from '$app/paths';
	// Row (h): tool donations are the headline ask. The "what we need now"
	// section pulls from the same wants tree as /wants so this page can never
	// invent a gap that isn't real, and never drift from the honest list.
	import { wants } from '$lib/data/cells';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { Gift } from '@lucide/svelte';

	const checklist = [
		{
			q: 'Can it travel?',
			body: 'The bus has limited space, and tools still need to travel safely when borrowed or relocated. Tools that pack into a cart, case, or chest work best. If your tool needs one, donating (or building) the kit alongside it is half the gift.',
		},
		{
			q: 'Are the bits marked?',
			body: 'Chisels, collets, blades, jigs, chargers: mark every piece so it visibly belongs to its set. Engraver, paint pen, or tag, anything durable counts.',
		},
		{
			q: 'Can it be repaired, used, and maintained?',
			body: 'Note the model number. If you know where the manual or datasheet lives, link it. Tell us who to reach out to (you? a forum? a local shop?) when it needs care.',
		},
	];
</script>

<svelte:head>
	<title>Donate a tool | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="We suggest tool donations, particularly complex, large, or heavy tools with many little bits and bobs. Transportable, marked, repairable."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Donate a tool"
		lead="Tools are what we need most. We especially welcome the ones that are hard to own alone: complex, large, heavy, or blessed with many little bits and bobs."
		icon={Gift}
	/>

	{#if wants.length > 0}
		<section class="mt-10" aria-label="What the bus needs right now">
			<h2 class="text-2xl font-semibold">What the bus needs right now</h2>
			<div class="mt-6 space-y-3">
				{#each wants as w (w.slug)}
					<Card eyebrow={w.cellName} title={w.name} body={w.blurb} headingLevel="h3" compact />
				{/each}
			</div>
			<p class="text-surface-500 mt-4 text-sm leading-relaxed">
				That is the current gap list; see the full <a class="underline" href={`${base}/wants`}>wants page</a> for more.
			</p>
		</section>
	{/if}

	<section class="mt-12" aria-label="Before you donate">
		<h2 class="text-2xl font-semibold">Before you donate, walk it through three questions</h2>
		<div class="mt-6 space-y-4">
			{#each checklist as item (item.q)}
				<Card title={item.q} body={item.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="Arrange the hand-off">
		<h2 class="text-2xl font-semibold">Arrange the hand-off</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Ready to hand off a tool, or want to talk through whether yours is a fit? Reach a keyholder. That is the whole
			process.
		</p>
		<a
			class="bg-primary-500 hover:bg-primary-600 mt-4 inline-block rounded-sm px-5 py-2.5 text-sm font-semibold text-white transition-colors"
			href={`${base}/contact`}
		>
			Contact a keyholder
		</a>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="About supporting the project">
		<h2 class="text-2xl font-semibold">About supporting the project</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The Great Falls Tool Bus is an unincorporated community project, and we keep the money side simple: <strong
				>tool donations are the headline ask</strong
			>. If you want to help with money instead, that help is framed toward tools too. It goes toward buying the tools
			the bus still needs, not general operations. <a class="underline" href={`${base}/contact`}>Reach out</a> and we'll talk
			person-to-person; nothing here is a tax-deductible charitable solicitation.
		</p>
	</section>
</main>
