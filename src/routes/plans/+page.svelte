<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import { Map } from '@lucide/svelte';

	const now = [
		{
			title: 'Domains registered, site live',
			body: 'greatfallstoolbus.org is registered and serving the page you are reading.',
		},
		{
			title: 'Tool kits forming',
			body: 'Donated tools are being kitted for transport: carts, cases, chests, marked bits. The sewing cell is first out of the gate, and its printable cell sheet is already live.',
		},
		{
			title: 'Ways to reach us',
			body: 'A private keyholders role list handles access requests, so any keyholder can pick up the work without requester details becoming public archive material. A public discuss board is running in staging.',
		},
	];

	const nearTerm = [
		{
			title: 'Public discuss board',
			body: 'A public board for general questions and coordination. It is running in staging now and opens to everyone once it settles.',
		},
		{
			title: 'Contact form',
			body: 'A bot-guarded form on this site, so reaching the bus does not require already knowing someone.',
		},
		{
			title: 'More cells',
			body: 'New cells open as tools and captains arrive; a cell needs both before it rolls.',
		},
	];
</script>

<svelte:head>
	<title>Plans | Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Where the Great Falls Tool Bus is going: what exists now, what is coming this season, and the shop-someday dream, labeled as a dream."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<PageHeader
		title="Plans"
		lead="Where this is going: what exists today, what we are building next, and the dream, clearly labeled as a dream."
		icon={Map}
	/>

	<section class="mt-10" aria-label="Where we are now">
		<h2 class="text-2xl font-semibold">Where we are now</h2>
		<div class="mt-6 space-y-4">
			{#each now as item (item.title)}
				<Card title={item.title} body={item.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="mt-12" aria-label="Near term">
		<h2 class="text-2xl font-semibold">Near term: this season</h2>
		<div class="mt-6 space-y-4">
			{#each nearTerm as item (item.title)}
				<Card title={item.title} body={item.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="The dream">
		<h2 class="text-2xl font-semibold">The dream, labeled as a dream</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The tool bus did not invent anything. Tool libraries have been lending drills and ladders to neighbors for more
			than forty years, and hackerspaces and makerspaces have spent decades refining the patterns that keep a shared
			shop working: kits, captains, keyholders, clear signage. We borrow shamelessly from both traditions.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Lewiston-Auburn grew up around the Great Falls of the Androscoggin: mills, millwrights, and people who fixed their
			own machines. A shared tool library on wheels feels like a fitting next chapter for a place built on making
			things, and the bus is how that chapter starts small.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Someday we would love a permanent shop: a real lab with benches, dust collection, and room to teach. That is the
			dream, not a plan. No dates, no building, no entity yet. In the very long run, that lab ambition connects to our
			webmaster Jess&rsquo;s tinyland.dev explorations, an aspiration she tinkers toward, not an existing business.
		</p>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="How to help">
		<h2 class="text-2xl font-semibold">How to help right now</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			<a class="underline" href={`${base}/donate`}>Donate a tool</a>. That is the whole ask. Until an entity exists,
			tool donations are the only kind the project accepts, and nothing on this site is a charitable solicitation.
			Everything else that helps (time, know-how, a captain for a new cell) starts with reaching out to a keyholder.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		No dates promised. When something ships, it moves up this page.
	</footer>
</main>
