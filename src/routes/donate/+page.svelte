<script lang="ts">
	import { base } from '$app/paths';
	// Tools are the headline ask, and there are two ways to give one: donate it
	// outright, or lend it and stay the owner (you can take it back). The "what
	// we need now" section pulls from the same wants tree as /wants so this page
	// can never invent a gap that isn't real, and never drift from the honest list.
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
		content="Give a tool to the bus, or lend it and stay the owner. You can take it back. Complex, large, or heavy tools especially. Transportable, marked, repairable."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Donate a tool"
		lead="Tools are what we need most, the ones that are hard to own alone: complex, large, heavy, or blessed with many little bits and bobs. Give one outright, or lend it and stay its owner. Either way it goes to work."
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

	<section class="mt-12" aria-label="Give it, or lend it">
		<h2 class="text-2xl font-semibold">Give it, or lend it: your call</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Donating outright is the simplest path, and for a tool you are done with, the best one. But you do not have to
			give up ownership to put a tool to work. You can make a tool available to the bus and stay its owner: lend it, let
			a cell run it, and take it back whenever you need it. For a big or expensive tool, lending is often the right fit.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Given or lent, a tool goes through the same three questions below and the same keyholder hand-off. Tell us which
			one you mean when you reach out, and we will sort out the details together.
		</p>
	</section>

	<section class="mt-12" aria-label="Before you hand one over">
		<h2 class="text-2xl font-semibold">Before you hand one over, walk it through three questions</h2>
		<dl class="mt-6 space-y-4">
			{#each checklist as item (item.q)}
				<div>
					<dt class="font-semibold">{item.q}</dt>
					<dd class="text-surface-700-300 mt-1 text-sm leading-relaxed">{item.body}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="Arrange the hand-off">
		<h2 class="text-2xl font-semibold">Arrange the hand-off</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Ready to hand off a tool (for good or on loan) or want to talk through whether yours is a fit? Reach a keyholder.
			That is the whole process.
		</p>
		<a
			class="bg-primary-500 hover:bg-primary-600 mt-4 inline-block px-5 py-2.5 text-sm font-semibold text-white transition-colors"
			href={`${base}/contact`}
		>
			Contact a keyholder
		</a>
	</section>
</main>
