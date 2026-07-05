<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import { KeyRound } from '@lucide/svelte';

	// "How access works": the path from first inquiry to a tool in your hands.
	// This is where the /contact form points (this lane does NOT wire the form).
	// Access model (ratified): keyholders are a curated, owner-approved group;
	// anyone may request access; non-member requests reach all keyholders.
	// No membership fee, no paperwork wall; access is stewarded.
	const steps = [
		{
			n: '1',
			title: 'Reach out',
			body: 'Tell us what you want to make or fix. The contact page is where that starts. Requests from non-members reach every keyholder, and one of them picks yours up: keyholders are a small, owner-approved group, so a real person reads every ask.',
		},
		{
			n: '2',
			title: 'Safety orientation',
			body: 'Before your first borrow of a capability, a keyholder walks you through a short safety orientation for it: the real hazards, the protective gear, and how the kit packs and travels. It is quick, and it is required.',
		},
		{
			n: '3',
			title: 'Get the location and a time',
			body: 'The bus sits at a fixed location in Lewiston-Auburn, shared privately on request. A keyholder gives you the exact spot and settles on a time that works, once the capability you need is ready for you.',
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
		content="How to borrow from the Great Falls Tool Bus: reach out, complete a short safety orientation, get the privately shared location and a time from a keyholder, and use the tool. No membership fee, no paperwork wall; every request gets a keyholder's answer."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="How access works"
		lead="Anyone can ask to borrow, and every request gets a human answer. Four steps take you from a first message to a tool in your hands: no membership fee, no paperwork wall, and a keyholder alongside you the whole way."
		icon={KeyRound}
	/>

	<section class="mt-10" aria-label="The steps">
		<ol class="space-y-6">
			{#each steps as step (step.n)}
				<li>
					<span class="text-surface-500 block text-xs tracking-widest uppercase">Step {step.n}</span>
					<h2 class="mt-1 text-lg font-semibold">{step.title}</h2>
					<p class="text-surface-700-300 mt-2 text-sm leading-relaxed">{step.body}</p>
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
			Reach a keyholder. That is step one, and that is all it takes. Read the <a
				class="underline"
				href={`${base}/safety`}>safety &amp; responsible-use guide</a
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
			Contact / join page
		</a>
	</div>

	<footer class="text-surface-500 pt-12 text-sm">
		No means test. A safety orientation, a keyholder's go-ahead, and a little coordination, and the bus is yours to
		borrow.
	</footer>
</main>
