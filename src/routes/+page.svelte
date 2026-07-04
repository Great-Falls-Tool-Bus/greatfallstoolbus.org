<script lang="ts">
	import { base } from '$app/paths';
	// Real-data trust strip (lane B mandate): counts come from $lib/data/cells,
	// the exact module /tools, /cells, and /wants already import from, globbed
	// at build time from the src/content/tools/**/*.svx tree. No invented
	// numbers; if the tree changes, these change with it.
	import { cells, wants } from '$lib/data/cells';
	import Card from '$lib/components/Card.svelte';

	const brand = {
		name: 'Great Falls Tool Bus',
		domain: 'greatfallstoolbus.org',
		tagline: 'This is a bus, the shop comes later :)',
		blurb:
			'A shared tool library on wheels for Lewiston-Auburn, Maine. We collect serious tools: the big, heavy, many-little-bits kind. We kit them for transport and lend them to neighbors who ask.',
	};

	const criteria = [
		{
			title: 'Transportable',
			body: 'How can this tool be packed up and moved? Would it benefit from a cart, case, or chest? Every tool on the bus travels well or gets a kit that makes it travel well.',
		},
		{
			title: 'Mark the bits',
			body: 'Parts, consumables, and attachments are marked as part of a set. You should always know this chisel belongs to the tool bus kit it came in.',
		},
		{
			title: 'Repairable & documented',
			body: 'Model numbers recorded, manuals linked, and a named contact for guidance or repairs. If it breaks, we know who to ask and where the datasheet lives.',
		},
	];

	const toolCount = cells.reduce((sum, cell) => sum + cell.tools.length, 0);
	const cellCount = cells.length;
	const wantCount = wants.length;

	const stats = [
		{ value: toolCount, label: toolCount === 1 ? 'tool kitted & documented' : 'tools kitted & documented' },
		{ value: cellCount, label: cellCount === 1 ? 'tool cell' : 'tool cells' },
		{ value: wantCount, label: wantCount === 1 ? 'tool still wanted' : 'tools still wanted' },
	];

	// Primary tier: the 2-3 asks a Lewiston neighbor actually needs (lane B
	// punch list: Tools, Donate a tool, Access/Contact), elevated above the
	// rest so the page stops reading as a flat sitemap.
	const primaryPages = [
		{
			eyebrow: 'Browse the kit',
			title: 'Tools on the bus',
			body: `${toolCount} tools across ${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}, kitted and documented.`,
			href: `${base}/tools`,
		},
		{
			eyebrow: 'Give a tool',
			title: 'Donate a tool',
			body: 'The criteria below, in checklist form.',
			href: `${base}/donate`,
		},
		{
			eyebrow: 'Get access',
			title: 'Access & contact',
			body: 'How access works, and how to reach a keyholder directly.',
			href: `${base}/access`,
		},
	];

	// Everything else: demoted and condensed to a single link row instead of
	// duplicating the primary nav bar as another 8-card grid.
	const morePages = [
		{ title: 'Tool cells', href: `${base}/cells` },
		{ title: 'Wants', href: `${base}/wants` },
		{ title: 'Plans', href: `${base}/plans` },
		{ title: 'Bibliography', href: `${base}/bibliography` },
		{ title: 'Shout-outs', href: `${base}/shout-outs` },
		{ title: 'Contact', href: `${base}/contact` },
	];
</script>

<svelte:head>
	<title>Great Falls Tool Bus: a shared tool library on wheels for Lewiston-Auburn, Maine</title>
	<meta name="description" content={brand.blurb} />
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-16 md:py-24">
	<header class="max-w-3xl space-y-4">
		<p class="text-surface-500 text-xs tracking-widest uppercase">{brand.name} · Lewiston-Auburn, Maine</p>
		<h1 class="font-display text-4xl md:text-5xl">A shared tool library on wheels</h1>
		<p class="text-primary-600 text-xl">{brand.tagline}</p>
		<p class="text-surface-700 dark:text-surface-300 text-lg leading-relaxed">
			{brand.blurb}
		</p>

		<div class="flex flex-wrap items-center gap-3 pt-2">
			<a
				href={`${base}/donate`}
				class="bg-primary-500 rounded-container hover:bg-primary-600 inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white transition-colors"
				>Donate a tool</a
			>
			<a
				href={`${base}/access`}
				class="border-primary-500 text-primary-600 rounded-container hover:bg-primary-500/10 inline-flex items-center justify-center border px-6 py-3 text-sm font-semibold transition-colors"
				>How access works</a
			>
			<a
				href={`${base}/tools`}
				class="text-surface-700 dark:text-surface-300 hover:text-primary-600 inline-flex items-center px-1 py-3 text-sm font-semibold underline-offset-4 hover:underline"
				>Browse the kit &rarr;</a
			>
		</div>

		<div
			class="border-surface-200-800 mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t pt-6"
			aria-label="What's on the bus right now"
		>
			{#each stats as stat (stat.label)}
				<p class="text-sm">
					<span class="font-display text-primary-600 text-2xl">{stat.value}</span>
					<span class="text-surface-700-300 ml-1">{stat.label}</span>
				</p>
			{/each}
		</div>
	</header>

	<section class="mt-12" aria-label="Shared-tool criteria">
		<h2 class="text-2xl font-semibold">What makes a good bus tool</h2>
		<div class="mt-6 grid gap-3 md:grid-cols-3">
			{#each criteria as item (item.title)}
				<div class="border-surface-200-800 bg-surface-50-950/75 rounded-lg border p-5">
					<h3 class="text-lg font-semibold">{item.title}</h3>
					<p class="text-surface-700-300 mt-3 text-sm leading-relaxed">{item.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-12 border-y py-8" aria-label="How access works">
		<h2 class="text-2xl font-semibold">Getting on the bus</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 max-w-3xl leading-relaxed">
			Anyone can ask to borrow: no membership fee, no paperwork wall. Reach out and a keyholder answers. Keyholders
			review each request and share the bus location directly. Start on the
			<a class="underline" href={`${base}/contact`}>contact / join page</a>.
		</p>
	</section>

	<section class="mt-12" aria-label="Where to start">
		<h2 class="text-2xl font-semibold">Where to start</h2>
		<div class="mt-6 grid gap-4 md:grid-cols-3">
			{#each primaryPages as p (p.title)}
				<Card href={p.href} eyebrow={p.eyebrow} title={p.title} body={p.body} headingLevel="h3" />
			{/each}
		</div>
	</section>

	<section class="border-surface-200-800 mt-10 border-t pt-8" aria-label="More about the project">
		<h2 class="text-surface-500 text-xs tracking-widest uppercase">More about the project</h2>
		<nav class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="More pages">
			{#each morePages as p (p.title)}
				<a
					class="text-surface-700-300 hover:text-primary-600 underline-offset-4 hover:underline"
					href={p.href}
					aria-label={`Open ${p.title}`}>{p.title}</a
				>
			{/each}
		</nav>
	</section>

	<footer class="text-surface-500 pt-12 text-sm">
		A community project. The dream is a full shop someday; today it is a bus, and that is the point.
	</footer>
</main>
