<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import InfoTip from '$lib/components/InfoTip.svelte';
	import { Megaphone } from '@lucide/svelte';

	const people = [
		{
			name: 'Ripley',
			role: 'Founding supporter',
			note: 'Whose backing turned the tool bus from an idea into a thing with wheels.',
		},
		{
			name: 'J.',
			role: 'Alderman, Lewiston',
			note: 'Hosts the bus on his property: the home base a keyholder shares with you on request.',
		},
		{
			name: 'Alex',
			role: 'Founder',
			note: 'Started it. The tagline on the front page is the founding doctrine, in Alex’s own words.',
		},
		{
			name: 'Jess Sullivan',
			role: 'Webmaster & mail admin',
			note: 'Runs this site and the keyholders mail infrastructure.',
		},
	];
</script>

<svelte:head>
	<title>Shout-outs | Great Falls Tool Bus</title>
	<meta name="description" content="The people and communities making the Great Falls Tool Bus real." />
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Shout-outs"
		lead="A tool bus is mostly people. These are the people whose consented public roles helped make it real."
		icon={Megaphone}
	/>

	<section class="mt-10 space-y-4" aria-label="People">
		<div class="flex items-center gap-2">
			<p class="text-surface-500 text-xs tracking-widest uppercase">Roles on the bus</p>
			<InfoTip
				label="What do these roles mean?"
				text="Roles are how a shared shop stays safe and running: a captain runs a cell, keyholders steward who can borrow, and the webmaster keeps the site and mail going. Titles like alderman or founder name what someone brought to the bus."
			/>
		</div>
		{#each people as p (p.name)}
			<Card eyebrow={p.role} title={p.name} body={p.note} headingLevel="h2">
				{#snippet lead()}<Avatar name={p.name} />{/snippet}
			</Card>
		{/each}
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="About Jess">
		<h2 class="text-2xl font-semibold">About the shop chops behind the site</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Jess has spent a decade inside community shops: managing fabrication laboratories, serving in membership and
			3D-printing leadership roles, teaching traveling digital-fabrication classes, and helping regional makerspaces
			coordinate COVID-19 PPE manufacture. She writes at
			<a class="underline" href="https://transscendsurvival.org" rel="external noopener">transscendsurvival.org</a>
			(mirrored at
			<a class="underline" href="https://jesssullivan.github.io" rel="external noopener">jesssullivan.github.io</a>).
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">Belong on this list? Tell a keyholder.</footer>
</main>
