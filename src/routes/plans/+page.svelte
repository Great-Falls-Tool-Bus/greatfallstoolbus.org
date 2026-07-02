<script lang="ts">
	const now = [
		{
			title: 'Domains registered, site live',
			body: 'greatfallstoolbus.org is registered and serving the page you are reading. What is written here is the current truth — when reality changes, the site changes.',
		},
		{
			title: 'Tool kits forming',
			body: 'Donated tools are being kitted for transport — carts, cases, chests, marked bits. The sewing cell is first out of the gate.',
		},
		{
			title: 'Ways to reach us, in the works',
			body: 'A keyholders mailing list and a contact form are being stood up. Until they open, access works the human way: you reach out, a keyholder answers.',
		},
	];

	const nearTerm = [
		{
			title: 'Keyholders mailing list',
			body: 'A mailing list with a public archive, so lending conversations and decisions stay readable by anyone who cares to look.',
		},
		{
			title: 'Contact form',
			body: 'A bot-guarded form on this site, so reaching the bus does not require already knowing someone.',
		},
		{
			title: 'Printable cell sheets',
			body: 'A one-page printable sheet per tool cell: what is in the kit, how it travels, and who its captain is.',
		},
		{
			title: 'More cells',
			body: 'New cells open as tools and captains arrive — a cell needs both before it rolls.',
		},
	];
</script>

<svelte:head>
	<title>Plans — Great Falls Tool Bus</title>
	<meta
		name="description"
		content="Where the Great Falls Tool Bus is going, honestly: what exists now, what is coming this season, and the shop-someday dream — labeled as a dream."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-6 py-16 md:py-24">
	<header class="space-y-4">
		<h1 class="text-4xl leading-tight font-bold">Plans</h1>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			Where this is going, honestly. What exists today, what we are building next, and the dream — clearly labeled as a
			dream. No dates promised; when something ships, it moves up this page.
		</p>
	</header>

	<section class="mt-10" aria-label="Where we are now">
		<h2 class="text-2xl font-semibold">Where we are now</h2>
		<div class="mt-6 space-y-4">
			{#each now as item (item.title)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.title}</h3>
					<p class="text-surface-700-300 mt-2 leading-relaxed">{item.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="mt-12" aria-label="Near term">
		<h2 class="text-2xl font-semibold">Near term — this season</h2>
		<div class="mt-6 space-y-4">
			{#each nearTerm as item (item.title)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.title}</h3>
					<p class="text-surface-700-300 mt-2 leading-relaxed">{item.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="The dream">
		<h2 class="text-2xl font-semibold">The dream — labeled as a dream</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			The tool bus did not invent anything. Tool libraries have been lending drills and ladders to neighbors for more
			than forty years, and hackerspaces and makerspaces have spent decades refining the design patterns — kits,
			captains, keyholders, honest signage — that keep a shared shop working. We borrow shamelessly from both
			traditions.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Lewiston-Auburn grew up around the Great Falls of the Androscoggin — mills, millwrights, and people who fixed
			their own machines. A shared tool library on wheels feels like a fitting next chapter for a place built on making
			things, and the bus is how that chapter starts small.
		</p>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			Someday we would love a permanent shop: a real lab with benches, dust collection, and room to teach. That is the
			dream, not a plan — no dates, no building, no entity yet. This is a bus; the shop comes later. In the very long
			run, that lab ambition connects to our webmaster Jess&rsquo;s tinyland.dev explorations — an aspiration she
			tinkers toward, not an existing business.
		</p>
	</section>

	<section class="border-surface-200-800 mt-12 border-t pt-8" aria-label="How to help">
		<h2 class="text-2xl font-semibold">How to help right now</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 leading-relaxed">
			<a class="underline" href="/donate">Donate a tool</a> — that is the whole ask. Until an entity exists, tool donations
			are the only kind the project accepts, and nothing on this site is a charitable solicitation. Everything else that helps
			— time, know-how, a captain for a new cell — starts with reaching out to a keyholder.
		</p>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		The Great Falls Tool Bus is an unincorporated community project in Lewiston-Auburn, Maine.
	</footer>
</main>
