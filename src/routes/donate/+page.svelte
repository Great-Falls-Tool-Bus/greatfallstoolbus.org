<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';

	const checklist = [
		{
			q: 'Can it travel?',
			body: 'The bus moves. Tools that pack into a cart, case, or chest ride best. If your tool needs one, donating (or building) the kit alongside it is half the gift.',
		},
		{
			q: 'Are the bits marked?',
			body: 'Chisels, collets, blades, jigs, chargers — mark every piece so it visibly belongs to its set. Engraver, paint pen, or tag: anything durable counts.',
		},
		{
			q: 'Can it be repaired, used, and maintained?',
			body: 'Note the model number. If you know where the manual or datasheet lives, link it. Tell us who to reach out to (you? a forum? a local shop?) when it needs care.',
		},
	];
</script>

<svelte:head>
	<title>Donate a tool — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="We suggest tool donations — particularly complex, large, or heavy tools with many little bits and bobs. Transportable, marked, repairable."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Donate a tool"
		lead="We especially welcome the tools that are hard to own alone: complex, large, heavy, or blessed with many little bits and bobs. Before donating, walk your tool through three questions:"
	/>

	<section class="mt-10 space-y-4">
		{#each checklist as item (item.q)}
			<Card title={item.q} body={item.body} headingLevel="h2" />
		{/each}
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8">
		<h2 class="text-2xl font-semibold">About supporting the project</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The Great Falls Tool Bus is an unincorporated community project, and we keep the money side simple: <strong
				>we accept tool donations only</strong
			> until a real entity exists. If you want to help another way, reach out and we'll talk person-to-person — nothing here
			is a tax-deductible charitable solicitation.
		</p>
	</section>
</main>
