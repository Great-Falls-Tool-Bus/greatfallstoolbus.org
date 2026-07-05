<script lang="ts">
	import { base } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import { ChevronDown, Map } from '@lucide/svelte';

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

	<!-- Group current and near-term status without adding a new dependency:
	     Skeleton 4.15.2 already wraps the Zag accordion machine. -->
	<section class="mt-10" aria-label="Status">
		<Accordion multiple collapsible defaultValue={['now']}>
			<Accordion.Item value="now" class="border-surface-200-800 border-b">
				<h2>
					<Accordion.ItemTrigger
						class="hover:text-primary-600 flex w-full items-center justify-between gap-3 py-4 text-left text-2xl font-semibold transition-colors"
					>
						Where we are now
						<Accordion.ItemIndicator
							class="text-surface-500 shrink-0 transition-transform duration-200 data-[state=open]:rotate-180"
						>
							<ChevronDown class="h-5 w-5" aria-hidden="true" />
						</Accordion.ItemIndicator>
					</Accordion.ItemTrigger>
				</h2>
				<Accordion.ItemContent class="pb-6">
					<dl class="space-y-4">
						{#each now as item (item.title)}
							<div>
								<dt class="font-semibold">{item.title}</dt>
								<dd class="text-surface-700-300 mt-1 text-sm leading-relaxed">{item.body}</dd>
							</div>
						{/each}
					</dl>
				</Accordion.ItemContent>
			</Accordion.Item>

			<Accordion.Item value="next" class="border-surface-200-800 border-b">
				<h2>
					<Accordion.ItemTrigger
						class="hover:text-primary-600 flex w-full items-center justify-between gap-3 py-4 text-left text-2xl font-semibold transition-colors"
					>
						Near term: this season
						<Accordion.ItemIndicator
							class="text-surface-500 shrink-0 transition-transform duration-200 data-[state=open]:rotate-180"
						>
							<ChevronDown class="h-5 w-5" aria-hidden="true" />
						</Accordion.ItemIndicator>
					</Accordion.ItemTrigger>
				</h2>
				<Accordion.ItemContent class="pb-6">
					<dl class="space-y-4">
						{#each nearTerm as item (item.title)}
							<div>
								<dt class="font-semibold">{item.title}</dt>
								<dd class="text-surface-700-300 mt-1 text-sm leading-relaxed">{item.body}</dd>
							</div>
						{/each}
					</dl>
				</Accordion.ItemContent>
			</Accordion.Item>
		</Accordion>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="The dream">
		<h2 class="text-2xl font-semibold">The dream, labeled as a dream</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The tool bus did not invent anything. Tool libraries have been lending drills and ladders to neighbors for more
			than forty years, and hackerspaces and makerspaces have spent decades refining the patterns that keep a shared
			shop working: kits, captains, keyholders, clear signage. We borrow shamelessly from both traditions.
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
			<a class="underline" href={`${base}/donate`}>Donate a tool</a>. That is the whole of it. Until an entity exists,
			tool donations are the only kind the project accepts, and nothing on this site is a charitable solicitation.
			Everything else that helps (time, know-how, a captain for a new cell) starts with reaching out to a keyholder.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		No dates promised. When something ships, it moves up this page.
	</footer>
</main>
