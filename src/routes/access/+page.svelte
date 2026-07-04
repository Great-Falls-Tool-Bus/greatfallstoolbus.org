<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';

	// "How access works" — the path from first inquiry to a tool in your hands.
	// This is where the /contact form points (this lane does NOT wire the form).
	// The free-after-orientation, donations-optional model is the operator
	// default (recommended, not confirmed — see OPERATOR-CONFIRM + PR flags).
	const steps = [
		{
			n: '1',
			title: 'Reach out',
			body: 'Tell a keyholder what you want to make or do. The contact page is where that starts; while the bot-guarded form and mailing list come online, a keyholder answers the human way.',
		},
		{
			n: '2',
			title: 'Safety orientation',
			body: 'Before your first borrow of a capability, we walk you through a short safety orientation for it — the real hazards, the protective gear, and how the kit packs and travels. It is quick, and it is required.',
		},
		{
			n: '3',
			title: 'Schedule around the bus',
			body: 'The bus moves, so we find a time and place that works: when the capability you need is on the bus and near you. Keyholders coordinate the where and when.',
		},
		{
			n: '4',
			title: 'Use the tool',
			body: 'Borrow the kit, do the work, and return it kitted and honest — checked against its cell sheet. Access is free; donations are welcome but never required.',
		},
	];
</script>

<svelte:head>
	<title>How access works — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="How to borrow from the Great Falls Tool Bus: reach out, complete a short safety orientation, schedule around the bus, and use the tool. Free and open; donations optional."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="How access works"
		lead="Getting on the bus is simple and human. Four steps take you from a first message to a tool in your hands — and access is free and open once you have done a safety orientation for what you want to use."
	/>

	<section class="mt-10" aria-label="The steps">
		<ol class="space-y-4">
			{#each steps as step (step.n)}
				<li>
					<Card eyebrow={`Step ${step.n}`} title={step.title} body={step.body} headingLevel="h2" />
				</li>
			{/each}
		</ol>
		<!-- OPERATOR-CONFIRM: free-after-safety-orientation access, donations optional — recommended default, not operator-confirmed. -->
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8 prose max-w-none" aria-label="Where to start">
		<h2 class="text-2xl font-semibold">Where to start</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Reach a keyholder while the mailing list and protected form roll out — that is step one, and it is the whole ask.
			Read the <a class="underline" href={`${base}/safety`}>safety &amp; responsible-use guide</a> before your
			orientation, browse the <a class="underline" href={`${base}/tools`}>capability catalog</a> to see what is on the
			bus, and meet the <a class="underline" href={`${base}/stewards`}>stewards</a> who keep it running.
		</p>
	</section>

	<div class="mt-6">
		<!-- Outside the `.prose` section on purpose: the house `.prose a` rule
			(src/app.css) recolors any anchor inside a prose block to primary-on-
			transparent, which would clobber this button's white-on-primary text. -->
		<a
			class="bg-primary-500 hover:bg-primary-600 inline-block rounded-sm px-5 py-2.5 text-sm font-semibold text-white transition-colors"
			href={`${base}/contact`}
		>
			Contact / join page
		</a>
	</div>

	<footer class="text-surface-500 pt-12 text-sm">
		No membership fee, no means test, no gatekeeping — a safety orientation and a little coordination, and the bus is
		yours to borrow.
	</footer>
</main>
