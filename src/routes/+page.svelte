<script lang="ts">
	import { base } from '$app/paths';
	// Real-data trust strip (lane B mandate): counts come from $lib/data/cells,
	// the exact module /tools, /cells, and /wants already import from, globbed
	// at build time from the src/content/tools/**/*.svx tree. No invented
	// numbers; if the tree changes, these change with it.
	import { cells, wants } from '$lib/data/cells';
	import Picture from '$lib/components/Picture.svelte';
	import { reveal } from '$lib/motion.svelte';

	// Faint 1922 hand-tools plate reused as a warm hero texture (Wave-3 WOW
	// polish). Same committed public-domain asset the /mission figure credits, so
	// no new bytes and no new credits entry. Rendered as a TRUE full-bleed band:
	// it escapes the content column edge-to-edge and fades out before the first
	// section, so it reads as one intentional textured hero rather than a boxed
	// fill stacked over the TinyVectors background. print:hidden keeps the
	// spec-sheet print ink-on-white. See $lib/data/credits for provenance.
	const heroTexture = '/photos/hand-tools-plate-1922.jpg';

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
			href: `${base}/contact#access`,
		},
	];
</script>

<svelte:head>
	<title>Great Falls Tool Bus: a shared tool library on wheels for Lewiston-Auburn, Maine</title>
	<meta name="description" content={brand.blurb} />
</svelte:head>

<main class="relative isolate mx-auto max-w-5xl px-6 py-16 md:py-24">
	<!-- TRUE full-bleed hero texture: w-screen + centered so it spans the whole
	     viewport (escaping the max-w content column), masked to fade out before
	     the first section. One intentional textured band, not a contained fill. -->
	<div
		class="pointer-events-none absolute top-0 left-1/2 -z-10 h-[34rem] w-screen -translate-x-1/2 overflow-hidden opacity-[0.05] select-none print:hidden dark:opacity-[0.07]"
		style="mask-image: linear-gradient(to bottom, black 0%, transparent 82%); -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 82%);"
		aria-hidden="true"
	>
		<Picture src={heroTexture} alt="" loading="eager" sizes="100vw" class="h-full w-full object-cover object-center" />
	</div>

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
				class="bg-primary-500 hover:bg-primary-600 inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white transition-colors"
				>Donate a tool</a
			>
			<a
				href={`${base}/contact#access`}
				class="border-primary-500 text-primary-600 hover:bg-primary-500/10 inline-flex items-center justify-center border px-6 py-3 text-sm font-semibold transition-colors"
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

	<!-- Uncontained editorial criteria: each is a hairline-divided term/description
	     row (dl), not a boxed card. Reads as one continuous page. -->
	<section class="mt-16" aria-label="Shared-tool criteria">
		<h2 class="text-2xl font-semibold">What makes a good bus tool</h2>
		<dl class="mt-8">
			{#each criteria as item, i (item.title)}
				<div
					class="border-surface-200-800 reveal-armed grid gap-x-8 gap-y-2 border-t py-6 md:grid-cols-[14rem_1fr]"
					use:reveal={{ delay: i * 70 }}
				>
					<dt class="text-lg font-semibold">{item.title}</dt>
					<dd class="text-surface-700-300 leading-relaxed">{item.body}</dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="border-surface-200-800 reveal-armed mt-16 border-y py-8" use:reveal aria-label="How access works">
		<h2 class="text-2xl font-semibold">Getting on the bus</h2>
		<p class="text-surface-700 dark:text-surface-300 mt-4 max-w-3xl leading-relaxed">
			Anyone can ask to borrow: no membership fee, no paperwork wall. Reach out and a keyholder answers. Keyholders
			review each request and share the bus location directly. See
			<a class="underline" href={`${base}/contact#find-the-bus`}>where to find the bus</a>, then start on the
			<a class="underline" href={`${base}/contact`}>contact / join page</a>.
		</p>
	</section>

	<!-- Uncontained editorial index: hairline-divided link rows with a sentence-case
	     kicker (not another tiny-uppercase eyebrow, so cadence varies here), a lead
	     title, and a nudging arrow. No card grid. -->
	<section class="reveal-armed mt-16" use:reveal aria-label="Where to start">
		<h2 class="text-2xl font-semibold">Where to start</h2>
		<ul class="mt-8">
			{#each primaryPages as p (p.title)}
				<li>
					<a href={p.href} class="group border-surface-200-800 flex items-baseline justify-between gap-6 border-t py-6">
						<span class="min-w-0">
							<span class="text-surface-600-400 text-sm">{p.eyebrow}</span>
							<span class="group-hover:text-primary-600 mt-1 block text-xl font-semibold transition-colors"
								>{p.title}</span
							>
							<span class="text-surface-700-300 mt-1 block leading-relaxed">{p.body}</span>
						</span>
						<span class="text-primary-600 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true"
							>&rarr;</span
						>
					</a>
				</li>
			{/each}
		</ul>
	</section>
</main>
