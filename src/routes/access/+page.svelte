<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import { KeyRound } from '@lucide/svelte';

	// Access model (ratified): keyholders are a curated, owner-approved group;
	// anyone may request access through /contact; non-member requests reach all
	// keyholders. This page explains expectations after a request, not a second
	// submission or location-discovery flow.
	const steps = [
		{
			n: '1',
			title: 'Ask through contact',
			body: 'Tell the keyholders what you want to make or fix. The contact form is the single intake path, and it reaches the private keyholders list.',
		},
		{
			n: '2',
			title: 'A keyholder replies',
			body: 'A keyholder picks up the request, checks what capability you need, and coordinates the practical details privately. That includes the exact location when it is appropriate to share.',
		},
		{
			n: '3',
			title: 'Safety orientation',
			body: 'Before your first borrow of a capability, a keyholder walks you through the real hazards, the protective gear, and how the kit packs and travels.',
		},
		{
			n: '4',
			title: 'Use the tool',
			body: 'Borrow the kit, do the work, and return it checked against its cell sheet. Borrowing is free; donations are welcome but never required.',
		},
	];
</script>

<svelte:head>
	<title>How access works | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="How to borrow from the Great Falls Tool Bus: ask through the contact form, coordinate with a keyholder, complete a short safety orientation, and use the tool."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="How access works"
		lead="Anyone can ask to borrow, and every ask gets a human answer. The contact form is the intake path; this page explains what keyholders coordinate after that request."
		icon={KeyRound}
	/>

	<section class="mt-10" aria-label="The steps">
		<ol class="space-y-4">
			{#each steps as step (step.n)}
				<li>
					<Card eyebrow={`Step ${step.n}`} title={step.title} body={step.body} headingLevel="h2" />
				</li>
			{/each}
		</ol>
		<!-- Access model (ratified): curated, owner-approved keyholders; anyone may request; non-member requests reach all keyholders. -->
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8 prose max-w-none" aria-label="Where to start">
		<div class="flex items-center gap-2">
			<h2 class="text-2xl font-semibold">Where to start</h2>
			<InfoTip
				label="What is a keyholder?"
				text="Keyholders are a small, owner-approved group who steward access to the bus. Anyone may ask to borrow; every request from a non-member reaches all keyholders, and one of them picks it up."
			/>
		</div>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Use the contact form when you are ready. Read the <a class="underline" href={`${base}/safety`}
				>safety &amp; responsible-use guide</a
			>
			before your orientation, browse the <a class="underline" href={`${base}/tools`}>capability catalog</a> to see what
			is on the bus, and meet the <a class="underline" href={`${base}/stewards`}>stewards</a> who keep it running.
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
			Start with contact
		</a>
	</div>

	<footer class="text-surface-500 pt-12 text-sm">
		No membership fee, no means test, no paperwork wall. A safety orientation, a keyholder's reply, and a little
		coordination get you from request to tool.
	</footer>
</main>
